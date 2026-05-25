'use strict';

const { buildRobloxCookieHeader } = require('./common');
const {
  withTimeout,
  readResponseText,
  readJsonResponse,
  ROBLOX_USER_AGENT,
  debugLog,
  debugWarn,
} = require('./auth');

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildCreatorGamesUrl(creatorType, creatorId, cursor, limit) {
  const normalizedCreatorType = String(creatorType || '').toLowerCase();
  const normalizedCreatorId = String(creatorId || '').trim();

  if (!/^\d+$/.test(normalizedCreatorId)) {
    throw new Error('Creator ID must be numeric');
  }

  const url =
    normalizedCreatorType === 'group'
      ? new URL(`https://games.roblox.com/v2/groups/${normalizedCreatorId}/games`)
      : new URL(`https://games.roblox.com/v2/users/${normalizedCreatorId}/games`);

  url.searchParams.set('limit', String(limit));
  if (normalizedCreatorType !== 'group') url.searchParams.set('sortOrder', 'Asc');
  if (cursor) url.searchParams.set('cursor', String(cursor));

  return url;
}

function getRootPlaceId(game) {
  if (!game || typeof game !== 'object') return null;
  const candidate = game.rootPlace?.id ?? game.rootPlaceId ?? game.placeId ?? game.id;
  return candidate == null ? null : String(candidate);
}

/**
 * Gets the rootPlace from each game the creator owns.
 */
async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const limit = 50;
  const maxResults = Math.min(asPositiveInteger(maxPlaceIds, 10), 100);
  const cookieHeader = buildRobloxCookieHeader(cookie);

  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');

  async function getGamesPage(url) {
    const response = await fetch(
      url,
      withTimeout({
        headers: {
          Cookie: cookieHeader,
          'User-Agent': ROBLOX_USER_AGENT,
        },
      }),
    );

    if (!response.ok) {
      const errorText = await readResponseText(response, 300);
      throw new Error(
        `Failed to get games (${response.status})${errorText ? `: ${errorText}` : ''}`,
      );
    }

    const data = await readJsonResponse(response, 'Games API');
    if (!Array.isArray(data.data)) {
      throw new Error(`Invalid games response format: ${JSON.stringify(data).slice(0, 200)}`);
    }

    return data;
  }

  const rootPlaces = [];
  const seenPlaceIds = new Set();
  let cursor = null;
  let pagesRequested = 0;

  while (rootPlaces.length < maxResults) {
    const url = buildCreatorGamesUrl(creatorType, creatorId, cursor, limit);
    debugLog(`(Dev) Fetching games page from URL: ${url.toString()}`);

    const pageData = await getGamesPage(url);
    pagesRequested += 1;

    if (pageData.data.length === 0) {
      debugLog(`(Dev) No games found on this page. Total collected: ${rootPlaces.length}`);
      break;
    }

    for (const game of pageData.data) {
      const placeId = getRootPlaceId(game);
      if (!placeId || seenPlaceIds.has(placeId)) continue;

      seenPlaceIds.add(placeId);
      rootPlaces.push(placeId);
      debugLog(`(Dev) Game "${game.name || 'Untitled'}" -> rootPlace ID: ${placeId}`);

      if (rootPlaces.length >= maxResults) break;
    }

    if (!pageData.nextPageCursor) {
      debugLog('(Dev) No more pages available');
      break;
    }

    cursor = pageData.nextPageCursor;
  }

  if (rootPlaces.length === 0) {
    throw new Error('No root places found in games');
  }

  debugLog(
    `(Dev) Got ${rootPlaces.length} root places from ${pagesRequested} page(s): ${rootPlaces.join(', ')}`,
  );
  return rootPlaces;
}

/**
 * Gets multiple place IDs from a creator to use as fallbacks.
 */
async function getMultiplePlaceIds(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  try {
    const places = await getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds);
    return Array.isArray(places) ? places : [places];
  } catch (err) {
    debugWarn('(Dev) Failed to get place IDs:', err.message);
    return [];
  }
}

const assetCache = new Map();

async function findAssetByName(cookie, assetType, name, groupId = null) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) return null;

  const cacheKey = `${assetType}_${groupId || 'user'}`;
  if (!assetCache.has(cacheKey)) {
    assetCache.set(cacheKey, { items: new Map(), fullyLoaded: false, cursor: '', fetchPromise: null });
  }
  
  const cache = assetCache.get(cacheKey);

  if (cache.items.has(name)) {
    return cache.items.get(name);
  }

  // If already fully loaded and not found, it doesn't exist
  if (cache.fullyLoaded) return null;

  // Wait if another worker is currently fetching
  if (cache.fetchPromise) {
    await cache.fetchPromise;
    if (cache.items.has(name)) return cache.items.get(name);
    if (cache.fullyLoaded) return null;
  }

  // Create a new fetch promise
  cache.fetchPromise = (async () => {
    let baseUrl = `https://itemconfiguration.roblox.com/v1/creations/get-assets?assetType=${assetType}&isArchived=false&limit=100`;
    if (groupId) baseUrl += `&groupId=${groupId}`;

    try {
      while (!cache.fullyLoaded) {
        let url = baseUrl;
        if (cache.cursor) url += `&cursor=${cache.cursor}`;
        
        const response = await fetch(url, {
          headers: { Cookie: cookieHeader, 'User-Agent': ROBLOX_USER_AGENT },
        });
        
        if (response.status === 429) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        if (!response.ok) break;

        const data = await response.json();
        if (!data || !data.data) break;

        for (const item of data.data) {
          if (!cache.items.has(item.name)) {
             cache.items.set(item.name, item.assetId);
          }
        }

        // If we found the specific item, we can return early but we must clear the promise
        if (cache.items.has(name)) {
          cache.cursor = data.nextPageCursor || '';
          if (!cache.cursor) cache.fullyLoaded = true;
          return;
        }

        if (!data.nextPageCursor) {
          cache.fullyLoaded = true;
          break;
        }
        cache.cursor = data.nextPageCursor;
      }
    } catch (err) {
      debugWarn('(Dev) Error in findAssetByName pagination:', err);
    }
  })();

  await cache.fetchPromise;
  cache.fetchPromise = null;

  return cache.items.get(name) || null;
}

module.exports = {
  getPlaceIdFromCreator,
  getMultiplePlaceIds,
  findAssetByName,
};
