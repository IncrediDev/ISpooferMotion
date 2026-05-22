'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { app, dialog, ipcMain, shell } = require('electron');
const {
  DEVELOPER_MODE,
  buildRobloxCookieHeader,
  clearDownloadsDirectory,
  retryAsync,
  sanitizeFilename,
} = require('./common');
const {
  getCookieFromRobloxStudio,
  getCsrfToken,
  getPlaceIdFromCreator,
  getAuthenticatedUserId,
} = require('./roblox-api');
const {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
} = require('./transfer-handlers');

// Pause / Resume
let isPaused = false;
let isCancelled = false;
const pauseResolvers = new Set();

function pauseSpoofer() {
  isPaused = true;
}

function resumeSpoofer() {
  isPaused = false;
  for (const resolve of pauseResolvers) resolve();
  pauseResolvers.clear();
}

function cancelSpoofer() {
  isCancelled = true;
  resumeSpoofer();
}

function resetRunControls() {
  isCancelled = false;
  resumeSpoofer();
}

function checkCancelled() {
  if (isCancelled) {
    throw new Error('Operation cancelled');
  }
}

async function checkPaused() {
  checkCancelled();
  if (!isPaused) return;
  await new Promise((resolve) => pauseResolvers.add(resolve));
  checkCancelled();
}

// Session (crash recovery)
function getSessionPath() {
  return path.join(app.getPath('userData'), 'ispoofer_session.json');
}

async function saveSession(session) {
  try {
    await fs.writeFile(getSessionPath(), JSON.stringify(session, null, 2), 'utf8');
  } catch (err) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to save session:', err);
  }
}

async function loadSession() {
  try {
    return JSON.parse(await fs.readFile(getSessionPath(), 'utf8'));
  } catch {
    return null;
  }
}

async function clearSession() {
  await fs.rm(getSessionPath(), { force: true }).catch(() => {});
}

function normalizePayload(value) {
  return value && typeof value === 'object' ? value : {};
}

function canOpenExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function resetIpcChannel(channel, mode = 'listener') {
  if (mode === 'handler') {
    try {
      ipcMain.removeHandler(channel);
    } catch {}
    return;
  }
  ipcMain.removeAllListeners(channel);
}

function onIpc(channel, listener) {
  resetIpcChannel(channel);
  ipcMain.on(channel, listener);
}

function handleIpc(channel, handler) {
  resetIpcChannel(channel, 'handler');
  ipcMain.handle(channel, handler);
}

function getReleaseSourceLabel() {
  const owner = 'IncrediDev';
  const repo = 'ISpooferMotion';
  return `${owner}/${repo}`;
}

function getRuntimeInfo() {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function getRendererSettingsPath() {
  return path.join(app.getPath('userData'), 'renderer-settings.json');
}

function getProfileSecretsPath() {
  return path.join(app.getPath('userData'), 'profile-secrets.json');
}

async function loadProfileSecrets(profileIds) {
  const allSecrets = await readJsonFile(getProfileSecretsPath(), {});
  if (!Array.isArray(profileIds) || profileIds.length === 0) return allSecrets;

  return Object.fromEntries(
    profileIds.map((profileId) => [String(profileId), allSecrets[String(profileId)] || {}]),
  );
}

async function saveProfileSecrets(data) {
  const payload = normalizePayload(data);
  const profileId = String(payload.profileId || 'default');
  const allSecrets = await readJsonFile(getProfileSecretsPath(), {});
  allSecrets[profileId] = {
    ...(allSecrets[profileId] || {}),
    ...normalizePayload(payload.secrets || payload),
  };
  delete allSecrets[profileId].profileId;
  await writeJsonFile(getProfileSecretsPath(), allSecrets);
  return true;
}

async function clearProfileSecrets(profileId) {
  const allSecrets = await readJsonFile(getProfileSecretsPath(), {});
  if (profileId) delete allSecrets[String(profileId)];
  else for (const key of Object.keys(allSecrets)) delete allSecrets[key];
  await writeJsonFile(getProfileSecretsPath(), allSecrets);
  return true;
}

/**
 * Registers all IPC handlers for main process
 */
function registerIpcHandlers(
  getMainWindowFn,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage,
) {
  onIpc('window-minimize', () => getMainWindowFn()?.minimize());
  onIpc('window-close', () => getMainWindowFn()?.close());

  handleIpc('get-app-version', () => {
    try {
      return app.getVersion();
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get app version:', err);
      return '0.0.0';
    }
  });

  handleIpc('get-release-source', () => getReleaseSourceLabel());
  handleIpc('get-runtime-info', () => getRuntimeInfo());
  handleIpc('load-renderer-settings', () => readJsonFile(getRendererSettingsPath(), {}));
  handleIpc('save-renderer-settings', async (_event, settings) => {
    await writeJsonFile(getRendererSettingsPath(), normalizePayload(settings));
    return true;
  });
  handleIpc('load-profile-secrets', (_event, profileIds) => loadProfileSecrets(profileIds));
  handleIpc('save-profile-secrets', (_event, data) => saveProfileSecrets(data));
  handleIpc('clear-profile-secrets', (_event, profileId) => clearProfileSecrets(profileId));
  handleIpc('get-roblox-profile', () => null);
  handleIpc('clear-asset-history', async () => true);
  handleIpc('copy-debug-info', async (_event, context) => {
    const info = JSON.stringify(
      { ...getRuntimeInfo(), context: normalizePayload(context) },
      null,
      2,
    );
    return info;
  });
  handleIpc('export-support-report', async (_event, context) => {
    const reportPath = path.join(app.getPath('userData'), `support-report-${Date.now()}.json`);
    await writeJsonFile(reportPath, {
      ...getRuntimeInfo(),
      context: normalizePayload(context),
      createdAt: new Date().toISOString(),
    });
    return reportPath;
  });

  onIpc('open-external', (event, url) => {
    try {
      if (canOpenExternalUrl(url)) {
        void shell.openExternal(String(url));
      } else if (DEVELOPER_MODE) {
        console.warn('open-external called with invalid url:', url);
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to open external URL:', err);
    }
  });

  handleIpc('open-logs-folder', async () => {
    const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
    try {
      await fs.mkdir(logsDir, { recursive: true });
      return await shell.openPath(logsDir);
    } catch (err) {
      console.error('Failed to open logs folder:', err);
      return false;
    }
  });

  handleIpc('open-plugins-folder', async () => {
    const pluginDir = path.join(app.getPath('userData'), 'plugins');
    try {
      await fs.mkdir(pluginDir, { recursive: true });
      return await shell.openPath(pluginDir);
    } catch (err) {
      console.error('Failed to open plugins folder:', err);
      return false;
    }
  });

  onIpc('run-spoofer-action', async (event, data) => {
    try {
      await handleSpooferAction(
        data,
        getMainWindowFn,
        sendTransferUpdate,
        sendSpooferResultToRenderer,
        sendStatusMessage,
      );
    } catch (err) {
      if (err?.message === 'Operation cancelled') {
        sendSpooferResultToRenderer({ output: 'Operation cancelled.', success: false });
        sendStatusMessage('Cancelled');
        return;
      }
      console.error('Unhandled spoofer action error:', err);
      sendSpooferResultToRenderer({ output: `Unexpected error: ${err.message}`, success: false });
      sendStatusMessage('Error: Unexpected failure');
    }
  });

  onIpc('spoofer-pause', () => {
    pauseSpoofer();
    sendStatusMessage('Paused');
  });
  onIpc('spoofer-resume', () => {
    resumeSpoofer();
    sendStatusMessage('Resuming...');
  });
  onIpc('spoofer-cancel', () => {
    cancelSpoofer();
    sendStatusMessage('Cancelled');
  });
  handleIpc('check-session', () => loadSession());
  onIpc('clear-session', () => {
    void clearSession();
  });

  handleIpc('fetch-audio-quota', async (event, data) => {
    data = normalizePayload(data);
    try {
      if (DEVELOPER_MODE)
        console.log('(Dev) Fetching audio quota with data:', {
          hasCookie: !!data.cookie,
          autoDetect: data.autoDetect,
        });

      let cookie = data.cookie;
      if (data.autoDetect && !cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) Auto-detecting cookie...');
        cookie = await getCookieFromRobloxStudio();
        if (DEVELOPER_MODE)
          console.log('(Dev) Auto-detected cookie:', cookie ? 'Found' : 'Not found');
      }
      if (!cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) No cookie available for quota check');
        return { error: 'No cookie provided' };
      }

      const cookieHeader = buildRobloxCookieHeader(cookie);
      if (!cookieHeader) {
        return { error: 'Invalid ROBLOSECURITY cookie format' };
      }

      if (DEVELOPER_MODE) console.log('(Dev) Fetching from Roblox API...');
      const response = await fetch(
        'https://publish.roblox.com/v1/asset-quotas?resourceType=RateLimitUpload&assetType=Audio',
        {
          headers: {
            Cookie: cookieHeader,
            'User-Agent': 'RobloxStudio/WinInet',
          },
        },
      );

      if (DEVELOPER_MODE) console.log('(Dev) Quota API response status:', response.status);
      if (!response.ok) {
        const errorText = await response.text();
        if (DEVELOPER_MODE) console.log('(Dev) Quota API error:', errorText);
        return { error: `Failed to fetch quota: ${response.status}` };
      }

      const quotaData = await response.json();
      if (DEVELOPER_MODE) console.log('(Dev) Quota data received:', quotaData);
      return quotaData;
    } catch (err) {
      console.error('Error fetching audio quota:', err);
      return { error: err.message };
    }
  });

  handleIpc('select-folder', async (event) => {
    try {
      const result = await dialog.showOpenDialog(getMainWindowFn(), {
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (err) {
      console.error('Error selecting folder:', err);
      return null;
    }
  });
}

/**
 * Main spoofer action handler
 */
async function handleSpooferAction(
  data,
  getMainWindowFn,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage,
) {
  data = normalizePayload(data);

  // Always reset run controls at the start of a new run so a previously-paused
  // or cancelled run can't block the next one.
  resetRunControls();

  if (DEVELOPER_MODE) {
    const sanitizedData = { ...data };
    if (sanitizedData.robloxCookie) sanitizedData.robloxCookie = '{Cookie:Here}';
    console.log('MAIN_PROCESS (Dev): Received run-spoofer-action with data:', sanitizedData);
  } else {
    console.log('MAIN_PROCESS: Received run-spoofer-action.');
  }

  // If this is a resume, restore the original textarea input from the session file
  // BEFORE parsing, so that entries are available even if the textarea is empty after a crash.
  if (data.resumeSession === true) {
    const savedSession = await loadSession();
    if (savedSession && savedSession.animationIdInput) {
      data.animationId = savedSession.animationIdInput;
    }
  }

  const hasCustomDownloadFolder = !!(
    data.downloadOnly &&
    data.downloadFolder &&
    data.downloadFolder.trim()
  );
  const downloadsDir = hasCustomDownloadFolder
    ? data.downloadFolder.trim()
    : path.join(app.getPath('userData'), 'ispoofer_downloads');

  // Validate download-only mode requires folder selection
  if (data.downloadOnly && (!data.downloadFolder || !data.downloadFolder.trim())) {
    sendSpooferResultToRenderer({
      output: 'Please select a download folder for Download-Only mode.',
      success: false,
    });
    sendStatusMessage('Error: No download folder selected');
    return;
  }

  if (!hasCustomDownloadFolder) {
    const cleared = await clearDownloadsDirectory(downloadsDir);
    if (!cleared) {
      if (DEVELOPER_MODE)
        console.warn('(Dev) Failed to fully clear downloads directory, proceeding anyway.');
      sendSpooferResultToRenderer({
        output: 'Warning: Could not fully clear previous downloads.',
        success: false,
      });
    }
  } else if (DEVELOPER_MODE) {
    console.log('(Dev) Skipping auto-clear: using user-selected download folder', downloadsDir);
  }

  if (!data.enableSpoofing && !data.downloadOnly) {
    sendSpooferResultToRenderer({
      output: 'Enable Spoofing toggle is OFF and Download-Only mode is not enabled.',
      success: false,
    });
    return;
  }

  // Validate group ID is numeric if provided
  if (data.groupId && !/^\d+$/.test(String(data.groupId).trim())) {
    sendSpooferResultToRenderer({
      output: `Invalid Group ID "${data.groupId}" — must be a number only, not a URL or text.`,
      success: false,
    });
    return;
  }

  // Both animation and sound uploads require an Open Cloud API key
  if (!data.downloadOnly && !data.apiKey) {
    sendSpooferResultToRenderer({
      output:
        'Uploads now require an Open Cloud API key.\n\nTo fix this:\n1. Go to create.roblox.com → Open Cloud → API Keys\n2. Create a key with Assets Read & Write permissions\n3. Paste the key into the "Open Cloud API Key" field',
      success: false,
    });
    return;
  }

  // Parse animations or sounds
  const isSoundMode = data.spoofSounds === true;
  const assetTypeName = isSoundMode ? 'Audio' : 'Animation';
  const assetEntries = (data.animationId || '')
    .split('\n')
    .map((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return null;
      const match = trimmedLine.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\],?$/);
      if (!match) return null;
      const id = match[1].trim();
      const name = match[2].trim();
      const third = match[3].trim();
      let creatorType, creatorId;
      if (third.startsWith('User')) {
        creatorType = 'user';
        creatorId = third.substring(4).replace(/[^0-9]/g, ''); // Extract only numbers
      } else if (third.startsWith('Group')) {
        creatorType = 'group';
        creatorId = third.substring(5).replace(/[^0-9]/g, ''); // Extract only numbers
      } else {
        return null;
      }
      return { id, name, creatorType, creatorId };
    })
    .filter((entry) => entry && entry.id && entry.creatorId);

  if (assetEntries.length === 0) {
    sendSpooferResultToRenderer({
      output: `No valid ${isSoundMode ? 'sound' : 'animation'} entries.`,
      success: false,
    });
    return;
  }

  // For backwards compatibility with code that expects animationEntries
  const animationEntries = assetEntries;

  // Get cookie
  const firstEntry = animationEntries[0];
  let robloxCookie = data.robloxCookie;
  if (data.autoDetectCookie) {
    try {
      if (firstEntry.creatorType === 'user') {
        robloxCookie = await getCookieFromRobloxStudio(firstEntry.creatorId);
      } else {
        robloxCookie = await getCookieFromRobloxStudio();
      }
      if (!robloxCookie) throw new Error('Auto-detected cookie empty/not found.');
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Error auto-detecting cookie:', err);
      sendSpooferResultToRenderer({
        output: `Failed to auto-detect cookie: ${err.message}`,
        success: false,
      });
      return;
    }
  }
  if (!robloxCookie) {
    sendSpooferResultToRenderer({ output: 'Roblox cookie not provided.', success: false });
    return;
  }

  // Get CSRF token
  let csrfToken;
  try {
    csrfToken = await getCsrfToken(robloxCookie);
  } catch (err) {
    sendSpooferResultToRenderer({
      output: `Failed to get CSRF token: ${err.message}`,
      success: false,
    });
    return;
  }

  // Ensure downloads directory exists
  try {
    if (!(await fs.stat(downloadsDir).catch(() => null))) {
      await fs.mkdir(downloadsDir, { recursive: true });
      if (DEVELOPER_MODE) console.log('(Dev) Downloads directory created:', downloadsDir);
    }
  } catch (dirError) {
    sendSpooferResultToRenderer({
      output: `Failed to ensure downloads directory exists: ${dirError.message}`,
      success: false,
    });
    return;
  }

  // Session setup (crash recovery + resume)
  const isResume = data.resumeSession === true;
  let session = isResume ? await loadSession() : null;
  if (isResume && session) {
    // Filter to only assets not yet completed in the prior session
    const completedIds = new Set((session.completedMappings || []).map((m) => m.originalId));
    animationEntries.splice(
      0,
      animationEntries.length,
      ...animationEntries.filter((e) => !completedIds.has(String(e.id))),
    );

    if (animationEntries.length === 0) {
      // All assets were already completed — just show the saved mappings and finish
      const mappingOutput = (session.completedMappings || [])
        .map((m) => `${m.originalId} = ${m.newId},`)
        .join('\n');
      sendSpooferResultToRenderer({ output: mappingOutput.replace(/,$/, ''), success: true });
      sendStatusMessage('Session already complete');
      await clearSession();
      return;
    }

    sendSpooferResultToRenderer({
      output: `Resuming — ${animationEntries.length} asset(s) remaining from previous session.\n`,
      success: true,
    });
  } else {
    session = {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      mode: isSoundMode ? 'Audio' : 'Animation',
      animationIdInput: data.animationId, // stored so resume works even if textarea is empty after crash
      totalCount: animationEntries.length,
      completedMappings: [],
    };
    await saveSession(session);
  }

  let verboseOutputMessage = `Downloading ${animationEntries.length} ${isSoundMode ? 'sound' : 'animation'}(s)...\n`;
  let successfulUploadCount = 0;
  let downloadedSuccessfullyCount = 0;
  // Seed mappings from prior completed session work
  let uploadMappingOutput = (session.completedMappings || [])
    .map((m) => `${m.originalId} = ${m.newId},`)
    .join('\n');
  if (uploadMappingOutput) uploadMappingOutput += '\n';

  const initialTransferStates = [];
  for (const entry of animationEntries) {
    const downloadTransferId = crypto.randomUUID();
    initialTransferStates.push({
      id: downloadTransferId,
      name: entry.name,
      originalAssetId: entry.id,
      status: 'queued',
      direction: 'download',
      progress: 0,
      size: 0,
    });
  }
  initialTransferStates.forEach((state) => sendTransferUpdate(state));

  const totalAnimations = animationEntries.length;
  try {
    sendStatusMessage(`0/${totalAnimations} spoofed`);
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send initial status message', e);
  }

  let hasAuthError = false;

  // Get the maxPlaceIds and maxPlaceIdRetries from data, defaults to 10 and 3
  const maxPlaceIds = data.maxPlaceIds || 10;
  const maxPlaceIdRetries = data.maxPlaceIdRetries || 3;
  const overridePlaceId = data.overridePlaceId ? parseInt(data.overridePlaceId) : null;

  // Get placeIds for each creator (map creatorId -> array of placeIds)
  const placeIdMap = {};
  if (overridePlaceId) {
    // If override place ID is provided, use it for all creators
    if (DEVELOPER_MODE)
      console.log(
        `(Dev) Override Place ID provided: ${overridePlaceId}. Using this for all creators instead of fetching.`,
      );
    const uniqueCreators = [
      ...new Set(animationEntries.map((e) => `${e.creatorType}:${e.creatorId}`)),
    ];
    for (const creatorKey of uniqueCreators) {
      placeIdMap[creatorKey] = [overridePlaceId];
    }
    if (DEVELOPER_MODE) console.log(`(Dev) Resolved placeIdMap with override:`, placeIdMap);
  } else if (animationEntries.length > 0) {
    if (DEVELOPER_MODE)
      console.log(
        `(Dev) Found ${animationEntries.length > 0 ? [...new Set(animationEntries.map((e) => `${e.creatorType}:${e.creatorId}`))].length : 0} unique creators. Fetching placeIds (max ${maxPlaceIds} per creator, ${maxPlaceIdRetries} retries)...`,
      );

    const uniqueCreators = [
      ...new Set(animationEntries.map((e) => `${e.creatorType}:${e.creatorId}`)),
    ];
    if (DEVELOPER_MODE)
      console.log(`(Dev) Fetching placeIds for ${uniqueCreators.length} creator(s) in parallel...`);

    await Promise.all(
      uniqueCreators.map(async (creatorKey) => {
        const [creatorType, creatorId] = creatorKey.split(':');
        try {
          const placeIds = await retryAsync(
            () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
            maxPlaceIdRetries,
            1000,
            (attempt, max, err) => {
              if (DEVELOPER_MODE)
                console.warn(`(Dev) Attempt ${attempt}/${max} for ${creatorKey}: ${err.message}`);
            },
          );
          placeIdMap[creatorKey] = Array.isArray(placeIds) ? placeIds : [placeIds];
          if (DEVELOPER_MODE)
            console.log(`(Dev) Got ${placeIdMap[creatorKey].length} placeIds for ${creatorKey}`);
        } catch (error) {
          if (DEVELOPER_MODE)
            console.warn(`(Dev) Could not get placeIds for ${creatorKey}: ${error.message}`);
          placeIdMap[creatorKey] = [99840799534728];
        }
      }),
    );

    if (DEVELOPER_MODE) console.log('(Dev) Resolved placeIdMap:', placeIdMap);
  }

  // Batch download locations
  const locationsMap = {};
  const batchItems = animationEntries.map((entry) => ({
    requestId: entry.id,
    assetId: parseInt(entry.id),
    assetType: assetTypeName,
    creatorType: entry.creatorType,
    creatorId: entry.creatorId,
  }));
  // Batch behavior controls (allow overrides via incoming data)
  const BATCH_MAX_RETRIES = parseInt(data.batchRetries, 10) || 3;
  const BATCH_RETRY_DELAY_MS = parseInt(data.batchRetryDelay, 10) || 2000;
  const BATCH_TIMEOUT_MS = parseInt(data.batchTimeoutMs, 10) || 15000; // 15s per batch
  const chunkSize = parseInt(data.batchChunkSize, 10) || 20; // Reduce from 50 to 20 by default to mitigate 504s

  if (DEVELOPER_MODE)
    console.log(
      `(Dev) Fetching batch locations for ${batchItems.length} ${isSoundMode ? 'sounds' : 'animations'} with creator-specific placeIds`,
    );
  for (let i = 0; i < batchItems.length; i += chunkSize) {
    checkCancelled();
    await checkPaused();
    const chunk = batchItems.slice(i, i + chunkSize);
    try {
      // Group items by creator to use the correct placeId
      const creatorGroups = {};
      for (const item of chunk) {
        const creatorKey = `${item.creatorType}:${item.creatorId}`;
        if (!creatorGroups[creatorKey]) creatorGroups[creatorKey] = [];
        creatorGroups[creatorKey].push(item);
      }

      // Process each creator group separately, with a small inter-group delay to avoid rate limits
      let creatorGroupIndex = 0;
      for (const [creatorKey, items] of Object.entries(creatorGroups)) {
        checkCancelled();
        await checkPaused();
        if (creatorGroupIndex > 0) await new Promise((r) => setTimeout(r, 500));
        creatorGroupIndex++;
        let [creatorType, creatorId] = creatorKey.split(':');
        let placeIdArray = placeIdMap[creatorKey] || [99840799534728];
        let placeIdIndex = 0;
        let retryCount = 0;
        const maxRetries = maxPlaceIdRetries;

        while (placeIdIndex < placeIdArray.length) {
          checkCancelled();
          await checkPaused();
          const placeId = placeIdArray[placeIdIndex];
          const itemsWithoutCreator = items.map(({ creatorType, creatorId, ...rest }) => rest);

          if (DEVELOPER_MODE)
            console.log(
              `(Dev) Batch request for ${creatorKey}: ${items.length} items with placeId ${placeId}${placeIdIndex > 0 ? ` (place index ${placeIdIndex}/${placeIdArray.length})` : ''}`,
            );

          // Batch fetch with retry + timeout (retry on 429/5xx/504/timeout)
          let locations;
          for (let attempt = 1; attempt <= BATCH_MAX_RETRIES; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
            let resp;
            let caughtErr = null;
            try {
              resp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
                method: 'POST',
                headers: {
                  'User-Agent': 'RobloxStudio/WinInet',
                  'Content-Type': 'application/json',
                  Cookie: `.ROBLOSECURITY=${robloxCookie}`,
                  'Roblox-Place-Id': String(placeId),
                },
                body: JSON.stringify(itemsWithoutCreator),
                signal: controller.signal,
              });
            } catch (err) {
              caughtErr = err;
            } finally {
              clearTimeout(timeout);
            }

            if (resp && resp.ok) {
              locations = await resp.json();
              break;
            }

            // Decide if retryable
            const status = resp ? resp.status : 0;
            const isTimeout =
              caughtErr &&
              (caughtErr.name === 'AbortError' || /aborted|timeout/i.test(caughtErr.message));
            const retryable =
              isTimeout ||
              status === 429 ||
              status === 502 ||
              status === 503 ||
              status === 504 ||
              status === 500;
            const statusText = resp
              ? `${status}`
              : isTimeout
                ? 'timeout'
                : caughtErr
                  ? caughtErr.message
                  : 'unknown';
            if (DEVELOPER_MODE)
              console.warn(
                `(Dev) Batch attempt ${attempt}/${BATCH_MAX_RETRIES} for ${creatorKey} @ place ${placeId} failed: ${statusText}${retryable && attempt < BATCH_MAX_RETRIES ? ' -> retrying' : ''}`,
              );

            if (!retryable || attempt === BATCH_MAX_RETRIES) {
              throw new Error(`Batch request failed for ${creatorKey}: ${statusText}`);
            }

            // On 429, respect retry-after header; otherwise use configured delay
            let delayMs = BATCH_RETRY_DELAY_MS;
            if (status === 429 && resp) {
              const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
              if (retryAfter > 0) delayMs = Math.min(retryAfter * 1000, 120000);
              else delayMs = Math.max(BATCH_RETRY_DELAY_MS, 15000); // default 15s on 429
            }
            const jitter = Math.floor(Math.random() * 300);
            await new Promise((r) => setTimeout(r, delayMs + jitter));
          }

          if (!locations) throw new Error(`Batch request failed for ${creatorKey}: no response`);
          if (DEVELOPER_MODE) console.log(`(Dev) Batch response for ${creatorKey}:`, locations);

          // Check if response contains batch errors (403s for restricted assets)
          const hasBatchErrors = locations.some(
            (loc) => loc.errors && loc.errors.length > 0 && loc.errors[0].code === 403,
          );

          // Print detailed batch errors for visibility
          const errorItems = locations.filter((loc) => loc.errors && loc.errors.length > 0);
          if (errorItems.length > 0) {
            for (const locErr of errorItems) {
              const firstErr = locErr.errors[0] || {};
              const errMsg = firstErr.Message || firstErr.message || JSON.stringify(firstErr);
              console.warn(`Batch error for ${locErr.requestId} at place ${placeId}:`, firstErr);
              if (DEVELOPER_MODE)
                console.log(
                  '(Dev) Full batch item with error:',
                  JSON.stringify(locErr, null, 2).substring(0, 500),
                );
            }
          }

          if (hasBatchErrors) {
            if (placeIdIndex < placeIdArray.length - 1) {
              // Try next place ID
              if (DEVELOPER_MODE)
                console.log(
                  `(Dev) Batch errors detected for ${creatorKey} with placeId ${placeId}. Trying next place...`,
                );
              placeIdIndex++;
              continue;
            } else {
              // All places exhausted
              // If an override is set, do NOT fetch fresh place IDs; accept errors
              if (overridePlaceId) {
                if (DEVELOPER_MODE)
                  console.log(
                    `(Dev) Override Place ID in use for ${creatorKey}. Skipping fresh placeId fetch and accepting batch errors.`,
                  );
                for (const loc of locations) {
                  locationsMap[loc.requestId] = loc;
                }
                break;
              }
              // Otherwise, try to get fresh place IDs with retries
              if (retryCount < maxRetries) {
                retryCount++;
                if (DEVELOPER_MODE)
                  console.log(
                    `(Dev) All places exhausted for ${creatorKey}. Fetching fresh placeIds (retry ${retryCount}/${maxRetries})...`,
                  );
                try {
                  const freshPlaceIds = await retryAsync(
                    () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
                    1,
                    1000,
                  );
                  placeIdMap[creatorKey] = Array.isArray(freshPlaceIds)
                    ? freshPlaceIds
                    : [freshPlaceIds];
                  placeIdArray = placeIdMap[creatorKey];
                  placeIdIndex = 0;
                  if (DEVELOPER_MODE)
                    console.log(
                      `(Dev) Got fresh placeIds for ${creatorKey}: ${placeIdArray.join(', ')}`,
                    );
                  continue;
                } catch (refreshErr) {
                  if (DEVELOPER_MODE)
                    console.warn(
                      `(Dev) Failed to refresh placeIds for ${creatorKey}: ${refreshErr.message}`,
                    );
                  // Accept the errors and continue
                  for (const loc of locations) {
                    locationsMap[loc.requestId] = loc;
                  }
                  break;
                }
              } else {
                // Max retries reached, accept the errors
                if (DEVELOPER_MODE)
                  console.log(
                    `(Dev) Max retries reached for ${creatorKey}, accepting batch errors`,
                  );
                for (const loc of locations) {
                  locationsMap[loc.requestId] = loc;
                }
                break;
              }
            }
          } else {
            // Success - no errors
            if (DEVELOPER_MODE)
              console.log(
                `(Dev) Batch request successful for ${creatorKey} with placeId ${placeId}`,
              );
            for (const loc of locations) {
              locationsMap[loc.requestId] = loc;
            }
            break;
          }
        }
      }
    } catch (error) {
      console.error('Batch request error:', error);
      // Consider only 401/403 as auth errors; 5xx/504/timeout are not auth
      const msg = error && error.message ? error.message : '';
      if (/\b401\b|\b403\b/.test(msg)) {
        hasAuthError = true;
      }
      sendStatusMessage(`Batch request failed: ${error.message}`);
      for (const item of chunk) {
        const transfer = initialTransferStates.find((t) => t.originalAssetId === item.requestId);
        if (transfer)
          sendTransferUpdate({ id: transfer.id, status: 'error', error: 'Batch request failed' });
      }
    }
  }

  const UPLOAD_RETRIES = parseInt(data.uploadRetries, 10) || 3;
  const UPLOAD_RETRY_DELAY_MS = parseInt(data.uploadRetryDelay, 10) || 5000;
  // Download controls (optional overrides via data)
  const DOWNLOAD_RETRIES = parseInt(data.downloadRetries, 10) || 2;
  const DOWNLOAD_RETRY_DELAY_MS = parseInt(data.downloadRetryDelayMs, 10) || 2000;
  const DOWNLOAD_TIMEOUT_MS = parseInt(data.downloadTimeoutMs, 10) || 15000;

  // Parallel downloads
  sendStatusMessage(`Downloading ${isSoundMode ? 'sounds' : 'animations'}...`);
  let downloadCompleted = 0;
  const downloadStartTime = Date.now();
  const downloadPromises = animationEntries.map(async (entry) => {
    checkCancelled();
    await checkPaused();
    const loc = locationsMap[entry.id];
    if (!loc) return { entry, success: false, error: 'No location in batch response' };
    if (loc.errors && loc.errors.length > 0) {
      const errorObj = loc.errors[0];
      const errorMsg =
        errorObj.Message || errorObj.message || JSON.stringify(errorObj) || 'Unknown';
      if (DEVELOPER_MODE) console.log('Batch error for', entry.id, ':', errorObj);
      return { entry, success: false, error: `Batch error: ${errorMsg}` };
    }
    if (!loc.locations || loc.locations.length === 0)
      return { entry, success: false, error: 'No locations in batch response' };
    const url = loc.locations[0].location;
    const sanitizedName = sanitizeFilename(entry.name);
    const fileExtension = isSoundMode ? '.ogg' : '.rbxm';
    const fileName = `${sanitizedName}_${entry.id}${fileExtension}`;
    const filePath = path.join(downloadsDir, fileName);
    const downloadTransfer = initialTransferStates.find((t) => t.originalAssetId === entry.id);
    const downloadTransferId = downloadTransfer.id;
    sendTransferUpdate({ id: downloadTransferId, status: 'processing' });
    const creatorKey = `${entry.creatorType}:${entry.creatorId}`;
    const entryPlaceIds = placeIdMap[creatorKey] || [99840799534728];
    const entryPlaceId = Array.isArray(entryPlaceIds) ? entryPlaceIds[0] : entryPlaceIds;
    const result = await downloadAnimationAssetWithProgress(
      url,
      robloxCookie,
      filePath,
      downloadTransferId,
      entry.name,
      entry.id,
      sendTransferUpdate,
      entryPlaceId,
      {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        retries: DOWNLOAD_RETRIES,
        retryDelayMs: DOWNLOAD_RETRY_DELAY_MS,
      },
    );
    downloadCompleted++;
    const elapsed = (Date.now() - downloadStartTime) / 1000;
    const avgTimePerItem = elapsed / downloadCompleted;
    const remaining = animationEntries.length - downloadCompleted;
    const etaSeconds = Math.ceil(avgTimePerItem * remaining);
    const etaMin = Math.floor(etaSeconds / 60);
    const etaSec = etaSeconds % 60;
    const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
    sendStatusMessage(
      `Downloaded ${downloadCompleted}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`,
    );
    return {
      entry,
      filePath: result.success ? filePath : null,
      success: result.success,
      error: result.error,
    };
  });
  const downloadResults = await Promise.all(downloadPromises);

  // Resolve the authenticated user ID once before the upload loop (needed for user-owned uploads)
  let authenticatedUserId = null;
  if (!data.downloadOnly && data.apiKey && !data.groupId) {
    try {
      authenticatedUserId = await getAuthenticatedUserId(robloxCookie);
      if (DEVELOPER_MODE)
        console.log(`(Dev) Resolved authenticated user ID for upload: ${authenticatedUserId}`);
    } catch (err) {
      if (DEVELOPER_MODE)
        console.warn(`(Dev) Could not resolve authenticated user ID: ${err.message}`);
      sendSpooferResultToRenderer({
        output: `Failed to resolve your Roblox user ID: ${err.message}\n\nMake sure your cookie is valid.`,
        success: false,
      });
      return;
    }
  }

  // Parallel uploads (skip if download-only mode)
  let uploadResults = [];
  if (data.downloadOnly) {
    sendStatusMessage('Download-only mode: Skipping uploads');
    if (DEVELOPER_MODE) console.log('(Dev) Download-only mode enabled, skipping all uploads');
  } else {
    sendStatusMessage(`Uploading ${isSoundMode ? 'sounds' : 'animations'}...`);
    let uploadCompleted = 0;
    const uploadStartTime = Date.now();
    const successfulDownloads = downloadResults.filter((r) => r.success);
    // Open Cloud API rate limit is 60 req/min. With ~10s average async processing,
    // 10 concurrent slots stays safely under the limit.
    const UPLOAD_CONCURRENCY = Math.min(10, successfulDownloads.length);

    // Worker pool: as soon as a slot finishes it picks up the next item immediately,
    // instead of waiting for a whole batch to finish before starting the next.
    const runWithConcurrency = async (items, limit, worker) => {
      const results = new Array(items.length);
      let index = 0;
      const workers = Array.from(
        { length: Math.max(1, Math.min(limit, items.length)) },
        async () => {
          while (true) {
            checkCancelled();
            await checkPaused();
            const current = index++;
            if (current >= items.length) break;
            results[current] = await worker(items[current]);
          }
        },
      );
      await Promise.all(workers);
      return results;
    };

    const uploadOne = async (downloadResult) => {
      const entry = downloadResult.entry;
      const filePath = downloadResult.filePath;
      const uploadTransferId = crypto.randomUUID();
      const fileSize = (await fs.stat(filePath).catch(() => ({ size: 0 }))).size;
      sendTransferUpdate({
        id: uploadTransferId,
        name: entry.name,
        originalAssetId: entry.id,
        status: 'queued',
        direction: 'upload',
        progress: 0,
        size: fileSize,
      });
      const onRetryAttempt = (attempt, maxAttempts, err) => {
        const errMsg = err.message || '';
        const isRateLimit = errMsg.includes('429') || errMsg.includes('Rate limit');
        const isFinal = attempt >= maxAttempts;
        const logMsg = isRateLimit
          ? `Upload attempt ${attempt}/${maxAttempts} for ${entry.name} rate-limited (429).${isFinal ? ' No more retries.' : ' Retrying with delay...'}`
          : `Upload attempt ${attempt}/${maxAttempts} for ${entry.name} failed.${isFinal ? ' No more retries.' : ' Retrying...'}`;
        if (DEVELOPER_MODE && isRateLimit) {
          console.warn(`(Dev) [RATE LIMIT DETECTED] ${entry.name}: ${errMsg}`);
        }
        sendTransferUpdate({
          id: uploadTransferId,
          status: 'processing',
          message: logMsg,
          error: errMsg.substring(0, 120),
        });
      };
      const uploadFn = async () => {
        await checkPaused();
        const result = await publishAnimationRbxmWithProgress(
          filePath,
          entry.name,
          robloxCookie,
          csrfToken,
          data.groupId && String(data.groupId).trim() ? data.groupId : null,
          uploadTransferId,
          sendTransferUpdate,
          assetTypeName,
          data.apiKey || null,
          authenticatedUserId || null,
        );
        if (!result.success) throw new Error(result.error || 'Upload failed');
        return result;
      };
      try {
        const uploadResult = await retryAsync(
          uploadFn,
          UPLOAD_RETRIES,
          UPLOAD_RETRY_DELAY_MS,
          onRetryAttempt,
        );
        // Save progress after each successful upload
        if (uploadResult.success && uploadResult.assetId) {
          session.completedMappings.push({
            originalId: String(entry.id),
            newId: uploadResult.assetId,
          });
          await saveSession(session);
        }
        uploadCompleted++;
        const elapsed = (Date.now() - uploadStartTime) / 1000;
        const avgTimePerItem = elapsed / uploadCompleted;
        const remaining = successfulDownloads.length - uploadCompleted;
        const etaSeconds = Math.ceil(avgTimePerItem * remaining);
        const etaMin = Math.floor(etaSeconds / 60);
        const etaSec = etaSeconds % 60;
        const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
        sendStatusMessage(
          `Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`,
        );
        return {
          entry,
          success: uploadResult.success,
          assetId: uploadResult.assetId,
          error: uploadResult.error,
        };
      } catch (finalRetryError) {
        sendTransferUpdate({
          id: uploadTransferId,
          status: 'error',
          error: `All upload attempts failed: ${finalRetryError.message}`,
        });
        uploadCompleted++;
        const elapsed = (Date.now() - uploadStartTime) / 1000;
        const avgTimePerItem = elapsed / uploadCompleted;
        const remaining = successfulDownloads.length - uploadCompleted;
        const etaSeconds = Math.ceil(avgTimePerItem * remaining);
        const etaMin = Math.floor(etaSeconds / 60);
        const etaSec = etaSeconds % 60;
        const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
        sendStatusMessage(
          `Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`,
        );
        return { entry, success: false, error: finalRetryError.message };
      }
    };
    uploadResults = await runWithConcurrency(successfulDownloads, UPLOAD_CONCURRENCY, uploadOne);
  }

  // Process results
  for (const downloadResult of downloadResults) {
    const entry = downloadResult.entry;
    verboseOutputMessage += `\n--- Asset: ${entry.name} (ID: ${entry.id}) ---\n`;
    if (downloadResult.success) {
      downloadedSuccessfullyCount++;
      verboseOutputMessage += `✓ Downloaded: ${entry.name} (ID: ${entry.id}) to ${downloadResult.filePath}\n`;

      // Only process upload results if not in download-only mode
      if (!data.downloadOnly) {
        const uploadResult = uploadResults.find((u) => u.entry.id === entry.id);
        if (uploadResult) {
          if (uploadResult.success) {
            successfulUploadCount++;
            uploadMappingOutput += `${entry.id} = ${uploadResult.assetId},\n`;
            verboseOutputMessage += `✓ Uploaded ${isSoundMode ? 'Sound' : 'Animation'}: ${entry.name} (Original ID: ${entry.id}) -> New Asset ID: ${uploadResult.assetId}\n`;
          } else {
            console.error(
              `[${isSoundMode ? 'SOUND' : 'ANIMATION'} UPLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}`,
            );
            verboseOutputMessage += `✗ ${isSoundMode ? 'Sound' : 'Animation'} Upload Failed: ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}\n`;
          }
        } else {
          console.error(`[UPLOAD SKIPPED] ${entry.name} (ID: ${entry.id}): Download failed.`);
          verboseOutputMessage += `! Skipped Upload for ${entry.name}: Download failed.\n`;
        }
      }
    } else {
      console.error(`[DOWNLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${downloadResult.error}`);
      verboseOutputMessage += `✗ Download Failed: ${entry.name} (ID: ${entry.id}) — ${downloadResult.error}\n`;
    }
  }

  verboseOutputMessage += `\n--- Summary ---\nTotal ${isSoundMode ? 'sounds' : 'animations'}: ${animationEntries.length}\nDownloaded: ${downloadedSuccessfullyCount}\n`;
  if (!data.downloadOnly) {
    verboseOutputMessage += `Uploaded: ${successfulUploadCount}\n\n--- Output Mapping ---\n${uploadMappingOutput}`;
  } else {
    verboseOutputMessage += `Uploads: Skipped (Download-Only Mode)\n`;
  }

  try {
    if (data.downloadOnly) {
      sendStatusMessage(
        `Download Complete: ${downloadedSuccessfullyCount}/${animationEntries.length} files saved to ${downloadsDir}`,
      );
    } else {
      sendStatusMessage(
        `Operation Successful: ${successfulUploadCount}/${animationEntries.length}`,
      );
    }
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send final status message', e);
  }

  // Build concise run summary (counts, failures)
  const downloadFailures = downloadResults
    .filter((r) => !r.success)
    .map((r) => ({ id: r.entry.id, name: r.entry.name, reason: r.error || 'Unknown error' }));
  const uploadFailures = data.downloadOnly
    ? []
    : (uploadResults || [])
        .filter((u) => !u.success)
        .map((u) => ({ id: u.entry.id, name: u.entry.name, reason: u.error || 'Unknown error' }));

  // Detect rate-limit failures
  const rateLimitFailures = uploadFailures.filter(
    (f) => (f.reason || '').includes('429') || (f.reason || '').includes('Rate limit'),
  );

  const skippedUploadsCount = data.downloadOnly ? 0 : downloadFailures.length;

  const listFailures = (label, items) => {
    if (!items || items.length === 0) return '';
    const maxItems = 5;
    const lines = items
      .slice(0, maxItems)
      .map((it) => `- ${it.name} (ID: ${it.id}) — ${it.reason}`);
    const remaining = items.length - maxItems;
    return `${label}:\n${lines.join('\n')}${remaining > 0 ? `\n(+${remaining} more…)` : ''}\n`;
  };

  let runSummary =
    `\n--- Summary ---\n` +
    `Mode: ${data.downloadOnly ? 'Download-Only' : 'Download + Upload'}\n` +
    `Total ${isSoundMode ? 'sounds' : 'animations'}: ${animationEntries.length}\n` +
    `Downloaded: ${downloadedSuccessfullyCount}/${animationEntries.length}${downloadFailures.length ? ` (Failed: ${downloadFailures.length})` : ''}\n` +
    (!data.downloadOnly
      ? `Uploaded: ${successfulUploadCount}/${downloadResults.filter((r) => r.success).length}${uploadFailures.length ? ` (Failed: ${uploadFailures.length}, Skipped: ${skippedUploadsCount})` : skippedUploadsCount ? ` (Skipped: ${skippedUploadsCount})` : ''}\n`
      : '');

  // Add top failure details (bounded) for quick inspection
  if (downloadFailures.length) {
    runSummary += `\n` + listFailures('Download failures', downloadFailures);
  }
  if (!data.downloadOnly && uploadFailures.length) {
    runSummary += `\n` + listFailures('Upload failures', uploadFailures);
  }

  // Add rate-limit guidance if detected
  if (rateLimitFailures.length > 0) {
    const suggestedDelay = Math.min(Math.max(UPLOAD_RETRY_DELAY_MS * 2, 10000), 60000);
    runSummary += `\n⚠️ RATE LIMIT DETECTED (429): ${rateLimitFailures.length} upload(s) hit rate limits.\n`;
    runSummary += `   Recommendation: Try again with higher "Retry Delay" (current: ${UPLOAD_RETRY_DELAY_MS}ms, suggested: ${suggestedDelay}ms)\n`;
    runSummary += `   Or increase "Upload Retries" for more attempts.\n`;
  }

  // Output with mappings only (or download summary for download-only mode)
  let finalOutput = '';
  if (data.downloadOnly) {
    // Download-only mode: show list of downloaded files
    const successfulDownloadsList = downloadResults
      .filter((r) => r.success)
      .map((r) => `${r.entry.name} (ID: ${r.entry.id})`)
      .join('\n');

    if (successfulDownloadsList) {
      finalOutput = `Downloaded ${downloadedSuccessfullyCount}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'} to:\n${downloadsDir}\n\nFiles:\n${successfulDownloadsList}`;
    } else {
      finalOutput = `No ${isSoundMode ? 'sounds' : 'animations'} were successfully downloaded.`;
    }
  } else if (uploadMappingOutput.trim()) {
    finalOutput = uploadMappingOutput.trim().replace(/,$/, '');
  } else {
    if (downloadedSuccessfullyCount > 0 && csrfToken && successfulUploadCount === 0) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}), but no ${isSoundMode ? 'sounds' : 'animations'} were successfully uploaded.`;
    } else if (downloadedSuccessfullyCount > 0 && !csrfToken) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}). Uploads skipped (CSRF token missing).`;
    } else if (animationEntries.length > 0) {
      finalOutput = hasAuthError
        ? 'Authentication failed. Please check your Roblox cookie.'
        : `No ${isSoundMode ? 'sounds' : 'animations'} were successfully processed to provide mappings.`;
    } else {
      finalOutput = 'No operations performed.';
    }
  }

  // Print final summary to console for quick inspection
  try {
    if (DEVELOPER_MODE) {
      console.log('(Dev) Run Summary:\n' + runSummary);
    } else {
      console.log('Run Summary:\n' + runSummary);
    }
  } catch {}

  sendSpooferResultToRenderer({
    output: finalOutput,
    success: downloadedSuccessfullyCount > 0 || successfulUploadCount > 0,
  });

  // Clear session on completion (all done or all failed — no point resuming)
  await clearSession();

  // Clear downloads directory after operation completes (only if using temp directory, not user-selected folder)
  if (!data.downloadOnly) {
    try {
      await clearDownloadsDirectory(downloadsDir, false);
      if (DEVELOPER_MODE) console.log('(Dev) Downloads directory cleared after operation');
    } catch (err) {
      if (DEVELOPER_MODE)
        console.warn('(Dev) Failed to clear downloads directory after operation:', err.message);
    }
  } else {
    if (DEVELOPER_MODE) console.log('(Dev) Download-only mode: keeping files in', downloadsDir);
  }
}

module.exports = {
  registerIpcHandlers,
};
