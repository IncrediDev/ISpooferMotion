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
 * Gets the first placeId from a creator (user or group)
 */
async function getPlaceIdFromCreator(creatorType, creatorId, cookie) {
  async function getGames(url) {
    const resp = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Failed to get games (${resp.status}): ${errorText.substring(0, 200)}`);
    }
    const data = await resp.json();
    if (!data || !data.data || data.data.length === 0) {
      throw new Error(`No games found in response. Response: ${JSON.stringify(data).substring(0, 200)}`);
    }
    if (DEVELOPER_MODE) console.log(`Found games for ${creatorType} ${creatorId}:`, data.data[0].id);
    return data.data[0].id; // universeId
  }

  async function getPlace(universeId) {
    const placesUrl = `https://develop.roblox.com/v1/universes/${universeId}/places?sortOrder=Asc&limit=10`;
    const resp = await fetch(placesUrl, { headers: { Cookie: `.ROBLOSECURITY=${cookie}` } });
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Failed to get places (${resp.status}): ${errorText.substring(0, 200)}`);
    }
    const data = await resp.json();
    if (!data || !data.data || data.data.length === 0) {
      throw new Error(`No places found in response. Response: ${JSON.stringify(data).substring(0, 200)}`);
    }
    if (DEVELOPER_MODE) console.log(`Found places for universe ${universeId}:`, data.data[0].id);
    return data.data[0].id; // placeId
  }

  let url;
  if (creatorType === 'group') {
    // Try without accessFilter first, then with accessFilter=2
    url = `https://games.roblox.com/v2/groups/${creatorId}/games?limit=10`;
  } else {
    url = `https://games.roblox.com/v2/users/${creatorId}/games?sortOrder=Asc&limit=10`;
  }
  
  if (DEVELOPER_MODE) console.log(`(Dev) Fetching games from URL: ${url}`);
  const universeId = await getGames(url);
  return await getPlace(universeId);
}

module.exports = {
  getCookieFromRobloxStudio,
  getCsrfToken,
  getPlaceIdFromCreator,
};
