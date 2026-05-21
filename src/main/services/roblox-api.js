const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const keytar = require('keytar');
const fs = require('fs').promises;
const { DEVELOPER_MODE, buildRobloxCookieHeader } = require('./common');

function isAbortLikeError(error) {
  return !!(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, label = 'request') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (isAbortLikeError(err))
      throw new Error(`${label} timed out after ${Math.max(1000, timeoutMs)}ms`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonWithTimeout(response, timeoutMs = 10000, label = 'response') {
  let timeout;
  try {
    return await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`${label} JSON read timed out after ${Math.max(1000, timeoutMs)}ms`)),
          Math.max(1000, timeoutMs),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readTextWithTimeout(response, timeoutMs = 10000, label = 'response') {
  let timeout;
  try {
    return await Promise.race([
      response.text(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`${label} text read timed out after ${Math.max(1000, timeoutMs)}ms`)),
          Math.max(1000, timeoutMs),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
async function getCookieFromRobloxStudio(userId = null) {
  if (!['darwin', 'win32'].includes(process.platform)) return undefined;

  if (process.platform === 'darwin') {
    try {
      const homePath = os.homedir();
      const cookieFile = path.join(
        homePath,
        'Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies',
      );
      const binaryCookieData = await fs.readFile(cookieFile, { encoding: 'utf-8' });
      const matchGroups = binaryCookieData.match(
        /_\|WARNING:-DO-NOT-SHARE-THIS\.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\.\|_[A-F\d]+/,
      );
      return matchGroups?.[0];
    } catch (err) {
      if (DEVELOPER_MODE)
        console.warn('(Dev) Could not read Roblox cookie from binarycookies:', err.message);
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
            }
            return token;
          }
        } catch (e) {}
      }
      return undefined;
    } catch (err) {
      if (DEVELOPER_MODE)
        console.warn(
          '(Dev) Could not read Roblox cookie from Windows Credential Manager:',
          err.message,
        );
      return undefined;
    }
  }
  return undefined;
}
async function getCsrfToken(cookie) {
  const csrfUrl = 'https://auth.roblox.com/v2/logout';
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) {
    throw new Error('Missing or invalid ROBLOSECURITY cookie');
  }
  const csrfHeaders = { Cookie: cookieHeader, 'Content-Type': 'application/json' };
  let response;
  try {
    response = await fetchWithTimeout(
      csrfUrl,
      { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) },
      12000,
      'CSRF token request',
    );
  } catch (networkError) {
    console.error('Network error fetching CSRF token:', networkError);
    throw new Error(`Network error fetching CSRF token: ${networkError.message}`);
  }
  const token = response.headers.get('x-csrf-token');
  if (!token) {
    let errorDetails = `CSRF token endpoint (${csrfUrl}) returned status ${response.status}.`;
    try {
      const textBody = await readTextWithTimeout(response, 8000, 'CSRF token error response');
      errorDetails += ` Body: ${textBody.substring(0, 200)}`;
    } catch (e) {}
    throw new Error(`No X-CSRF-TOKEN in response header. ${errorDetails}`);
  }
  return token;
}
async function getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  const limit = 50;

  async function getGamesPage(url) {
    const cookieHeader = buildRobloxCookieHeader(cookie);
    if (!cookieHeader) {
      throw new Error('Missing or invalid ROBLOSECURITY cookie');
    }
    const resp = await fetchWithTimeout(
      url,
      {
        headers: {
          Cookie: cookieHeader,
          'User-Agent': 'RobloxStudio/WinInet',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
      },
      12000,
      'Creator games request',
    );
    if (!resp.ok) {
      const errorText = await readTextWithTimeout(resp, 8000, 'Creator games error response');
      throw new Error(`Failed to get games (${resp.status}): ${errorText.substring(0, 200)}`);
    }
    const data = await readJsonWithTimeout(resp, 10000, 'Creator games response');
    if (!data || !data.data) {
      throw new Error(
        `Invalid response format. Response: ${JSON.stringify(data).substring(0, 200)}`,
      );
    }
    return data;
  }

  let allGames = [];
  let cursor = null;
  let pagesRequested = 0;
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
      if (DEVELOPER_MODE)
        console.log(`(Dev) No games found on this page. Total collected: ${allGames.length}`);
      break;
    }

    allGames = allGames.concat(pageData.data);
    pagesRequested++;
    if (DEVELOPER_MODE) {
      console.log(
        `(Dev) Page ${pagesRequested}: Got ${pageData.data.length} games (total: ${allGames.length})`,
      );
      pageData.data.forEach((game, idx) => {
        if (game.rootPlace) {
          console.log(`  Game ${idx}: "${game.name}" -> rootPlace ID: ${game.rootPlace.id}`);
        } else {
          console.log(
            `  Game ${idx}: "${game.name}" -> NO rootPlace found (has keys: ${Object.keys(game).join(', ')})`,
          );
        }
      });
    }
    if (!pageData.nextPageCursor) {
      if (DEVELOPER_MODE) console.log(`(Dev) No more pages available`);
      break;
    }

    cursor = pageData.nextPageCursor;
  }
  const rootPlaces = allGames
    .slice(0, maxPlaceIds)
    .map((game) => {
      if (game.rootPlace && game.rootPlace.id) {
        return game.rootPlace.id;
      } else if (game.id) {
        return game.id;
      }
      return null;
    })
    .filter((id) => id !== null);

  if (rootPlaces.length === 0) {
    if (DEVELOPER_MODE) {
      console.log(`(Dev) No root places found. Game structure samples:`);
      allGames.slice(0, 3).forEach((game, idx) => {
        console.log(`  Game ${idx}:`, JSON.stringify(game, null, 2).substring(0, 200));
      });
    }
    throw new Error('No root places found in games');
  }

  if (DEVELOPER_MODE)
    console.log(
      `(Dev) Got ${rootPlaces.length} root places from ${pagesRequested} page(s): ${rootPlaces.join(', ')}`,
    );
  return rootPlaces; // Return array of root place IDs from each game
}
async function getMultiplePlaceIds(creatorType, creatorId, cookie, maxPlaceIds = 10) {
  try {
    const places = await getPlaceIdFromCreator(creatorType, creatorId, cookie, maxPlaceIds);
    return Array.isArray(places) ? places : [places];
  } catch (err) {
    if (DEVELOPER_MODE) console.warn(`(Dev) Failed to get place IDs: ${err.message}`);
    return [];
  }
}
async function getAuthenticatedUserId(cookie) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');
  const response = await fetchWithTimeout(
    'https://users.roblox.com/v1/users/authenticated',
    {
      headers: { Cookie: cookieHeader, 'User-Agent': 'RobloxStudio/WinInet' },
    },
    10000,
    'Authenticated user request',
  );
  if (!response.ok) {
    let errorText = '';
    try {
      errorText = (await readTextWithTimeout(response, 8000, 'Authenticated user error response'))
        .replace(/\s+/g, ' ')
        .slice(0, 300);
    } catch {}
    throw new Error(
      `Failed to get authenticated user ID (${response.status})${errorText ? `: ${errorText}` : ''}`,
    );
  }
  const data = await readJsonWithTimeout(response, 8000, 'Authenticated user response');
  if (!data.id) throw new Error('No user ID in authenticated user response');
  return String(data.id);
}

module.exports = {
  getCookieFromRobloxStudio,
  getCsrfToken,
  getPlaceIdFromCreator,
  getMultiplePlaceIds,
  getAuthenticatedUserId,
};
