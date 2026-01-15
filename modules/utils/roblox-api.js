// modules/utils/roblox-api.js
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const keytar = require('keytar');
const fs = require('fs').promises;
const { DEVELOPER_MODE } = require('./common');

/**
 * Retrieves Roblox cookie from Roblox Studio or Windows Credential Manager
 */
async function getCookieFromRobloxStudio(userId = null) {
  if (!['darwin', 'win32'].includes(process.platform)) return undefined;

  if (process.platform === 'darwin') {
    try {
      const homePath = os.homedir();
      const cookieFile = path.join(homePath, 'Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies');
      const binaryCookieData = await fs.readFile(cookieFile, { encoding: 'utf-8' });
      const matchGroups = binaryCookieData.match(
        /_\|WARNING:-DO-NOT-SHARE-THIS\.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\.\|_[A-F\d]+/
      );
      return matchGroups?.[0];
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Could not read Roblox cookie from binarycookies:', err.message);
      return undefined;
    }
  }

  if (process.platform === 'win32') {
    try {
      const stdout = await new Promise((resolve, reject) => {
        exec('cmdkey /list', (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      const lines = stdout.split('\n');
      const robloxTargets = [];
      for (const line of lines) {
        if (line.includes('https://www.roblox.com:RobloxStudioAuth.ROBLOSECURITY')) {
          const match = line.match(/Target:\s*LegacyGeneric:target=(.+)/);
          if (match) robloxTargets.push(match[1]);
        }
      }
      robloxTargets.sort((a, b) => {
        const numA = parseInt(a.split('ROBLOSECURITY')[1]) || 0;
        const numB = parseInt(b.split('ROBLOSECURITY')[1]) || 0;
        return numB - numA;
      });
      for (const target of robloxTargets) {
        try {
          const token = await keytar.findPassword(target);
          if (token) {
            if (DEVELOPER_MODE) {
              console.log(`(Dev) Using Roblox cookie from credential: ${target}`);
              console.log(`(Dev) Cookie value: ${token.substring(0, 50)}...`);
            }
            return token;
          }
        } catch (e) {
          // Continue to next
        }
      }
      return undefined;
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Could not read Roblox cookie from Windows Credential Manager:', err.message);
      return undefined;
    }
  }
  return undefined;
}

/**
 * Fetches CSRF token from Roblox auth endpoint
 */
async function getCsrfToken(cookie) {
  const csrfUrl = 'https://auth.roblox.com/v2/logout';
  const csrfHeaders = { 'Cookie': `.ROBLOSECURITY=${cookie}`, 'Content-Type': 'application/json' };
  let response;
  try {
    response = await fetch(csrfUrl, { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) });
  } catch (networkError) {
    console.error('Network error fetching CSRF token:', networkError);
    throw new Error(`Network error fetching CSRF token: ${networkError.message}`);
  }
  const token = response.headers.get('x-csrf-token');
  if (!token) {
    let errorDetails = `CSRF token endpoint (${csrfUrl}) returned status ${response.status}.`;
    try {
      const textBody = await response.text();
      errorDetails += ` Body: ${textBody.substring(0, 200)}`;
    } catch (e) {
      // ignore
    }
    throw new Error(`No X-CSRF-TOKEN in response header. ${errorDetails}`);
  }
  return token;
}

/**
 * Gets the rootPlace from each game the creator owns
 */
async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  // Clamp maxPlaceIds to valid Roblox API values: 10, 25, 50
  const validLimits = [10, 25, 50];
  let limit = validLimits[0];
  if (maxPlaceIds >= 50) {
    limit = 50;
  } else if (maxPlaceIds >= 25) {
    limit = 25;
  } else {
    limit = 10;
  }

  async function getGamesPage(url) {
    const resp = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Failed to get games (${resp.status}): ${errorText.substring(0, 200)}`);
    }
    const data = await resp.json();
    if (!data || !data.data) {
      throw new Error(`Invalid response format. Response: ${JSON.stringify(data).substring(0, 200)}`);
    }
    return data;
  }

  let allGames = [];
  let cursor = null;
  let pagesRequested = 0;

  // Paginate through results until we have enough place IDs
  while (allGames.length < maxPlaceIds) {
    let url;
    if (creatorType === 'group') {
      url = `https://games.roblox.com/v2/groups/${creatorId}/games?limit=${limit}`;
    } else {
      url = `https://games.roblox.com/v2/users/${creatorId}/games?sortOrder=Asc&limit=${limit}`;
    }

    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    if (DEVELOPER_MODE) console.log(`(Dev) Fetching games page from URL: ${url}`);
    const pageData = await getGamesPage(url);
    
    if (!pageData.data || pageData.data.length === 0) {
      if (DEVELOPER_MODE) console.log(`(Dev) No games found on this page. Total collected: ${allGames.length}`);
      break;
    }

    allGames = allGames.concat(pageData.data);
    pagesRequested++;
    if (DEVELOPER_MODE) {
      console.log(`(Dev) Page ${pagesRequested}: Got ${pageData.data.length} games (total: ${allGames.length})`);
      pageData.data.forEach((game, idx) => {
        if (game.rootPlace) {
          console.log(`  Game ${idx}: "${game.name}" -> rootPlace ID: ${game.rootPlace.id}`);
        } else {
          console.log(`  Game ${idx}: "${game.name}" -> NO rootPlace found (has keys: ${Object.keys(game).join(', ')})`);
        }
      });
    }

    // Check if there's a next page
    if (!pageData.nextPageCursor) {
      if (DEVELOPER_MODE) console.log(`(Dev) No more pages available`);
      break;
    }

    cursor = pageData.nextPageCursor;
  }

  // Extract rootPlace from each game (up to maxPlaceIds)
  const rootPlaces = allGames
    .slice(0, maxPlaceIds)
    .map(game => {
      // Try multiple possible place ID sources
      if (game.rootPlace && game.rootPlace.id) {
        return game.rootPlace.id;
      } else if (game.id) {
        // Some APIs return the place ID directly as 'id'
        return game.id;
      }
      return null;
    })
    .filter(id => id !== null);

  if (rootPlaces.length === 0) {
    if (DEVELOPER_MODE) {
      console.log(`(Dev) No root places found. Game structure samples:`);
      allGames.slice(0, 3).forEach((game, idx) => {
        console.log(`  Game ${idx}:`, JSON.stringify(game, null, 2).substring(0, 200));
      });
    }
    throw new Error('No root places found in games');
  }

  if (DEVELOPER_MODE) console.log(`(Dev) Got ${rootPlaces.length} root places from ${pagesRequested} page(s): ${rootPlaces.join(', ')}`);
  return rootPlaces; // Return array of root place IDs from each game
}

/**
 * Gets multiple place IDs from a creator to use as fallbacks
 */
async function getMultiplePlaceIds(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  try {
    const places = await getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds);
    return Array.isArray(places) ? places : [places];
  } catch (err) {
    if (DEVELOPER_MODE) console.warn(`(Dev) Failed to get place IDs: ${err.message}`);
    return [];
  }
}

module.exports = {
  getCookieFromRobloxStudio,
  getCsrfToken,
  getPlaceIdFromCreator,
  getMultiplePlaceIds,
};
