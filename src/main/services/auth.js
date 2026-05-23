'use strict';

const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const keytar = require('keytar');
const fs = require('node:fs/promises');
const { DEVELOPER_MODE, buildRobloxCookieHeader } = require('./common');

const execFileAsync = promisify(execFile);
const ROBLOX_COOKIE_PATTERN =
  /_\|WARNING:-DO-NOT-SHARE-THIS\.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\.\|_[A-F\d]+/i;
const ROBLOX_STUDIO_COOKIE_TARGET = 'https://www.roblox.com:RobloxStudioAuth.ROBLOSECURITY';
const ROBLOX_USER_AGENT = 'RobloxStudio/WinInet';
const DEFAULT_TIMEOUT_MS = 15_000;

function debugLog(...args) {
  if (DEVELOPER_MODE) console.log(...args);
}

function debugWarn(...args) {
  if (DEVELOPER_MODE) console.warn(...args);
}

function withTimeout(options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (typeof AbortSignal?.timeout !== 'function') return options;
  return { ...options, signal: options.signal || AbortSignal.timeout(timeoutMs) };
}

async function readResponseText(response, maxLength = 300) {
  try {
    return (await response.text()).slice(0, maxLength);
  } catch {
    return '';
  }
}

async function readJsonResponse(response, context) {
  let data;
  try {
    data = await response.json();
  } catch (err) {
    const body = await readResponseText(response);
    throw new Error(`${context} returned invalid JSON${body ? `: ${body}` : ''}`, { cause: err });
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`${context} returned an invalid response shape`);
  }
  return data;
}

function extractRobloxCookie(rawValue) {
  if (!rawValue) return undefined;
  const text = Buffer.isBuffer(rawValue) ? rawValue.toString('latin1') : String(rawValue);
  return text.match(ROBLOX_COOKIE_PATTERN)?.[0];
}

/**
 * Retrieves Roblox cookie from Roblox Studio or Windows Credential Manager.
 */
async function getCookieFromRobloxStudio(userId = null) {
  if (!['darwin', 'win32'].includes(process.platform)) return undefined;

  if (process.platform === 'darwin') {
    try {
      const cookieFile = path.join(
        os.homedir(),
        'Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies',
      );
      const binaryCookieData = await fs.readFile(cookieFile);
      return extractRobloxCookie(binaryCookieData);
    } catch (err) {
      debugWarn('(Dev) Could not read Roblox cookie from binarycookies:', err.message);
      return undefined;
    }
  }

  try {
    const { stdout } = await execFileAsync('cmdkey', ['/list'], {
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });

    const requestedUserId = userId == null ? '' : String(userId).replace(/\D/g, '');
    const targets = String(stdout)
      .split(/\r?\n/)
      .map((line) => line.match(/Target:\s*LegacyGeneric:target=(.+)/)?.[1]?.trim())
      .filter(Boolean)
      .filter((target) => target.includes(ROBLOX_STUDIO_COOKIE_TARGET))
      .sort((a, b) => {
        const aIncludesUser = requestedUserId && a.includes(requestedUserId) ? 1 : 0;
        const bIncludesUser = requestedUserId && b.includes(requestedUserId) ? 1 : 0;
        if (aIncludesUser !== bIncludesUser) return bIncludesUser - aIncludesUser;

        const numA = Number.parseInt(a.split('ROBLOSECURITY')[1], 10) || 0;
        const numB = Number.parseInt(b.split('ROBLOSECURITY')[1], 10) || 0;
        return numB - numA;
      });

    for (const target of targets) {
      try {
        const token = await keytar.findPassword(target);
        if (token) {
          debugLog(`(Dev) Using Roblox cookie from credential: ${target}`);
          return token;
        }
      } catch (err) {
        debugWarn('(Dev) Could not read credential target:', target, err.message);
      }
    }
  } catch (err) {
    debugWarn('(Dev) Could not read Roblox cookie from Windows Credential Manager:', err.message);
  }

  return undefined;
}

/**
 * Fetches CSRF token from Roblox auth endpoint.
 */
async function getCsrfToken(cookie) {
  const csrfUrl = 'https://auth.roblox.com/v2/logout';
  const cookieHeader = buildRobloxCookieHeader(cookie);

  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');

  let response;
  try {
    response = await fetch(
      csrfUrl,
      withTimeout({
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
          'User-Agent': ROBLOX_USER_AGENT,
        },
        body: '{}',
      }),
    );
  } catch (err) {
    throw new Error(`Network error fetching CSRF token: ${err.message}`, { cause: err });
  }

  const token = response.headers.get('x-csrf-token');
  if (!token) {
    const body = await readResponseText(response, 200);
    throw new Error(
      `No X-CSRF-TOKEN in response header. CSRF endpoint returned ${response.status}${body ? `: ${body}` : ''}`,
    );
  }

  return token;
}

/**
 * Gets the authenticated user's ID from the Roblox API using their cookie.
 */
async function getAuthenticatedUserId(cookie) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');

  const response = await fetch(
    'https://users.roblox.com/v1/users/authenticated',
    withTimeout({
      headers: {
        Cookie: cookieHeader,
        'User-Agent': ROBLOX_USER_AGENT,
      },
    }),
  );

  if (!response.ok) {
    const errorText = await readResponseText(response, 200);
    throw new Error(
      `Failed to get authenticated user ID (${response.status})${errorText ? `: ${errorText}` : ''}`,
    );
  }

  const data = await readJsonResponse(response, 'Authenticated user API');
  if (!data.id) throw new Error('No user ID in authenticated user response');

  return String(data.id);
}

module.exports = {
  getCookieFromRobloxStudio,
  getCsrfToken,
  getAuthenticatedUserId,
  withTimeout,
  readResponseText,
  readJsonResponse,
  ROBLOX_USER_AGENT,
  debugLog,
  debugWarn,
};
