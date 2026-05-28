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

function buildCreatorGamesUrl(creatorType, creatorId, cursor, limit, accessFilter) {
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
  url.searchParams.set('sortOrder', 'Asc');
  if (accessFilter) url.searchParams.set('accessFilter', accessFilter);
  if (cursor) url.searchParams.set('cursor', String(cursor));

  return url;
}

function getRootPlaceId(game) {
  if (!game || typeof game !== 'object') return null;
  const candidate = game.rootPlace?.id ?? game.rootPlaceId ?? game.placeId ?? game.id;
  return candidate == null ? null : String(candidate);
}

function normalizeCreatorType(value) {
  return String(value || '').toLowerCase() === 'group' ? 'group' : 'user';
}

function makePlaceSuggestion(game, creatorType, creatorId) {
  const placeId = getRootPlaceId(game);
  if (!placeId) return null;

  return {
    placeId,
    name: game.name || game.rootPlace?.name || 'Untitled Experience',
    universeId: game.id == null ? null : String(game.id),
    creatorType: normalizeCreatorType(creatorType),
    creatorId: String(creatorId),
  };
}

async function fetchCreatorGamesPage(url, cookieHeader) {
  const headers = { 'User-Agent': ROBLOX_USER_AGENT };
  if (cookieHeader) headers.Cookie = cookieHeader;

  const response = await fetch(url, withTimeout({ headers }));
  if (!response.ok) {
    const errorText = await readResponseText(response, 300);
    throw new Error(`HTTP ${response.status}${errorText ? `: ${errorText}` : ''}`);
  }

  const data = await readJsonResponse(response, 'Games API');
  if (!Array.isArray(data.data)) {
    throw new Error(`Invalid games response format: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data;
}

async function collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const limit = 50;
  const maxResults = Math.min(asPositiveInteger(maxPlaceIds, 10), 100);
  const cookieHeader = buildRobloxCookieHeader(cookie);
  const suggestions = [];
  const seenPlaceIds = new Set();
  const errors = [];
  let pagesRequested = 0;
  const accessFilters = cookieHeader ? ['All', 'Public', ''] : ['Public', ''];

  for (const accessFilter of accessFilters) {
    if (suggestions.length >= maxResults) break;

    let cursor = null;
    let pageCount = 0;
    while (suggestions.length < maxResults) {
      const url = buildCreatorGamesUrl(creatorType, creatorId, cursor, limit, accessFilter);
      debugLog(`(Dev) Fetching games page from URL: ${url.toString()}`);

      let pageData;
      try {
        pageData = await fetchCreatorGamesPage(url, cookieHeader);
      } catch (err) {
        errors.push(`${accessFilter || 'default'}: ${err.message}`);
        break;
      }

      pagesRequested += 1;
      pageCount += 1;

      if (pageData.data.length === 0) {
        debugLog(`(Dev) No games found on this page. Total collected: ${suggestions.length}`);
        break;
      }

      for (const game of pageData.data) {
        const suggestion = makePlaceSuggestion(game, creatorType, creatorId);
        if (!suggestion || seenPlaceIds.has(suggestion.placeId)) continue;

        seenPlaceIds.add(suggestion.placeId);
        suggestions.push(suggestion);
        debugLog(`(Dev) Game "${suggestion.name}" -> rootPlace ID: ${suggestion.placeId}`);

        if (suggestions.length >= maxResults) break;
      }

      if (!pageData.nextPageCursor) {
        debugLog('(Dev) No more pages available');
        break;
      }

      cursor = pageData.nextPageCursor;
    }

    if (pageCount > 0 && suggestions.length > 0) break;
  }

  return {
    places: suggestions,
    errors,
    pagesRequested,
  };
}

/**
 * Gets the rootPlace from each game the creator owns.
 */
async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const result = await collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds);
  const rootPlaces = result.places.map((place) => place.placeId);

  if (rootPlaces.length === 0) throw new Error('No root places found in games');

  debugLog(
    `(Dev) Got ${rootPlaces.length} root places from ${result.pagesRequested} page(s): ${rootPlaces.join(', ')}`,
  );
  return rootPlaces;
}

/**
 * Gets root place suggestions with display metadata for a creator.
 */
async function getPlaceSuggestionsFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  return collectPlaceSuggestionsForCreator(creatorType, creatorId, cookie, maxPlaceIds);
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
  getPlaceSuggestionsFromCreator,
  getMultiplePlaceIds,
  findAssetByName,
};
