// modules/utils/ipc-handlers.js
const path = require('path');
const { ipcMain, app } = require('electron');
const crypto = require('crypto');
const { DEVELOPER_MODE, buildRobloxCookieHeader } = require('./common');
const { getCookieFromRobloxStudio, getPlaceIdFromCreator, getAuthenticatedUserId } = require('./roblox-api');
const { clearDownloadsDirectory, retryAsync, sanitizeFilename } = require('./common');
const { downloadAnimationAssetWithProgress, publishAnimationRbxmWithProgress } = require('./transfer-handlers');
const fs = require('fs').promises;

// ── Pause / Resume ────────────────────────────────────────────────────────────
let _isPaused = false;
let _pauseResolvers = [];
function pauseSpoofer() { _isPaused = true; }
function resumeSpoofer() { _isPaused = false; _pauseResolvers.splice(0).forEach(r => r()); }
async function checkPaused() {
  if (_isPaused) await new Promise(resolve => _pauseResolvers.push(resolve));
}

// ── Session (crash recovery) ──────────────────────────────────────────────────
function getSessionPath() { return path.join(app.getPath('userData'), 'ispoofer_session.json'); }
async function saveSession(session) {
  try { await fs.writeFile(getSessionPath(), JSON.stringify(session)); } catch {}
}
async function loadSession() {
  try { return JSON.parse(await fs.readFile(getSessionPath(), 'utf8')); } catch { return null; }
}
async function clearSession() { await fs.unlink(getSessionPath()).catch(() => {}); }

// ── Asset history cache ──────────────────────────────────────────────────────
// Keeps successful old ID -> new ID mappings so duplicate runs can skip work.
function getAssetHistoryPath() { return path.join(app.getPath('userData'), 'ispoofer_asset_history.json'); }
async function loadAssetHistory() {
  try {
    const parsed = JSON.parse(await fs.readFile(getAssetHistoryPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
async function saveAssetHistory(history) {
  try {
    await fs.writeFile(getAssetHistoryPath(), JSON.stringify(history || {}, null, 2));
  } catch (err) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to save asset history:', err.message);
  }
}
function buildHistoryKey(assetTypeName, targetKey, originalId) {
  return `${assetTypeName || 'Asset'}:${targetKey || 'default'}:${String(originalId)}`;
}
async function rememberAssetMapping(assetTypeName, targetKey, originalId, newId, name) {
  if (!originalId || !newId) return;
  const history = await loadAssetHistory();
  history[buildHistoryKey(assetTypeName, targetKey, originalId)] = {
    originalId: String(originalId),
    newId: String(newId),
    name: name || '',
    assetType: assetTypeName || 'Asset',
    target: targetKey || 'default',
    savedAt: new Date().toISOString(),
  };
  await saveAssetHistory(history);
}
async function clearAssetHistory() { await fs.unlink(getAssetHistoryPath()).catch(() => {}); }

function formatAssetEntry(entry) {
  const creatorPrefix = entry.creatorType === 'group' ? 'Group' : 'User';
  return `[${entry.id}][${entry.name}][${creatorPrefix}${entry.creatorId}]`;
}


function classifyError(error) {
  const raw = typeof error === 'string' ? error : (error && (error.message || error.error)) || 'Unknown error';
  const text = String(raw);
  const lower = text.toLowerCase();

  if (/\b401\b/.test(text) || lower.includes('invalid roblox cookie') || lower.includes('cookie') && lower.includes('invalid') || lower.includes('authentication failed') || lower.includes('failed to resolve your roblox user id')) {
    return { category: 'Invalid cookie', message: 'The Roblox cookie appears to be invalid or expired. Re-enter the cookie or use auto-detect again.', raw: text };
  }
  if (lower.includes('api key') || lower.includes('x-api-key') || /\b403\b/.test(text) && lower.includes('open cloud')) {
    return { category: 'Invalid API key', message: 'The Open Cloud API key is missing, invalid, expired, or lacks Assets read/write permissions.', raw: text };
  }
  if (/\b404\b/.test(text) || lower.includes('asset unavailable') || lower.includes('no location') || lower.includes('no locations') || lower.includes('not found') || lower.includes('moderated')) {
    return { category: 'Asset unavailable', message: 'Roblox did not return a downloadable location for this asset. It may be private, moderated, deleted, or unavailable to the authenticated user.', raw: text };
  }
  if (/\b403\b/.test(text) || lower.includes('permission') || lower.includes('not authorized') || lower.includes('not allowed')) {
    const looksLikeDownloadAccess = lower.includes('access asset') || lower.includes('asset') || lower.includes('download');
    if (looksLikeDownloadAccess && !lower.includes('open cloud') && !lower.includes('group')) {
      return { category: 'Asset access denied', message: 'Roblox says this asset is private or the current cookie/place context is not allowed to download it. Use an account/place that owns or can access the source asset.', raw: text };
    }
    return { category: 'No group permission', message: 'The account or API key does not appear to have permission for the selected group/upload target.', raw: text };
  }
  if (/\b429\b/.test(text) || lower.includes('rate limit') || lower.includes('too many request')) {
    return { category: 'Rate limited', message: 'Roblox rate-limited the request. The queue will wait before retrying when retries remain.', raw: text };
  }
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('timed out') || lower.includes('econn') || lower.includes('enotfound') || lower.includes('socket') || /\b5\d\d\b/.test(text)) {
    return { category: 'Network failure', message: 'The request failed because of a network/server timeout or temporary Roblox service error.', raw: text };
  }
  if (lower.includes('rbxm') || lower.includes('conversion') || lower.includes('convert') || lower.includes('file system') || lower.includes('fs') || lower.includes('enoent') || lower.includes('readfile')) {
    return { category: 'File conversion failed', message: 'The downloaded file could not be read, converted, or prepared for upload.', raw: text };
  }
  return { category: 'Unknown error', message: text, raw: text };
}

async function cooldownWithCountdown(ms, label, onTick) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  for (let remaining = totalSeconds; remaining > 0; remaining--) {
    if (onTick) onTick(remaining, totalSeconds);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function retryWithCooldown(fn, retries, delayMs, onAttemptFailure, onCooldownTick) {
  let lastError;
  const attempts = Math.max(1, retries);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt, attempts);
    } catch (err) {
      lastError = err;
      if (onAttemptFailure) onAttemptFailure(attempt, attempts, err);
      if (attempt < attempts) {
        await cooldownWithCountdown(delayMs, `Retry ${attempt + 1}/${attempts}`, (remaining, total) => {
          if (onCooldownTick) onCooldownTick(remaining, total, attempt + 1, attempts, err);
        });
      }
    }
  }
  const enrichedError = new Error(`After ${attempts} attempts: ${lastError && lastError.message ? lastError.message : 'Unknown error'}`);
  enrichedError.cause = lastError;
  throw enrichedError;
}

function dedupeAssetEntries(entries) {
  const seen = new Set();
  return (entries || []).filter((entry) => {
    const key = String(entry.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Registers all IPC handlers for main process
 */
function registerIpcHandlers(getMainWindowFn, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage) {
  ipcMain.on('window-minimize', () => getMainWindowFn()?.minimize());
  ipcMain.on('window-close', () => getMainWindowFn()?.close());

  ipcMain.handle('get-app-version', () => {
    try {
      return app.getVersion();
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get app version:', err);
      return '0.0.0';
    }
  });

  ipcMain.on('open-external', (event, url) => {
    const { shell } = require('electron');

    const isAllowedExternalHost = (hostname) => {
      const host = String(hostname || '').toLowerCase();
      return (
        host === 'github.com' ||
        host.endsWith('.github.com') ||
        host === 'discord.gg' ||
        host.endsWith('.discord.gg') ||
        host === 'discord.com' ||
        host.endsWith('.discord.com') ||
        host === 'roblox.com' ||
        host.endsWith('.roblox.com')
      );
    };

    try {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.protocol !== 'https:' || !isAllowedExternalHost(parsedUrl.hostname)) {
        if (DEVELOPER_MODE) console.warn('Blocked external URL:', url);
        return;
      }

      shell.openExternal(parsedUrl.href);
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to open external URL:', err);
    }
  });

  ipcMain.on('open-logs-folder', () => {
    const { shell } = require('electron');
    const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
    try {
      require('fs').mkdirSync(logsDir, { recursive: true });
      shell.openPath(logsDir);
      if (DEVELOPER_MODE) console.log('(Dev) Opened logs folder:', logsDir);
    } catch (err) {
      console.error('Failed to open logs folder:', err);
    }
  });

  ipcMain.on('run-spoofer-action', async (event, data) => {
    await handleSpooferAction(data, getMainWindowFn, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage);
  });

  ipcMain.on('spoofer-pause', () => { pauseSpoofer(); sendStatusMessage('Paused'); });
  ipcMain.on('spoofer-resume', () => { resumeSpoofer(); sendStatusMessage('Resuming...'); });
  ipcMain.handle('check-session', () => loadSession());
  ipcMain.on('clear-session', () => clearSession());
  ipcMain.handle('clear-app-history', async () => {
    await clearSession();
    await clearAssetHistory();
    return { success: true };
  });

  ipcMain.handle('fetch-audio-quota', async (event, data) => {
    try {
      if (DEVELOPER_MODE) console.log('(Dev) Fetching audio quota with data:', { hasCookie: !!data.cookie, autoDetect: data.autoDetect });
      
      let cookie = data.cookie;
      if (data.autoDetect && !cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) Auto-detecting cookie...');
        cookie = await getCookieFromRobloxStudio();
        if (DEVELOPER_MODE) console.log('(Dev) Auto-detected cookie:', cookie ? 'Found' : 'Not found');
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
      const response = await fetch('https://publish.roblox.com/v1/asset-quotas?resourceType=RateLimitUpload&assetType=Audio', {
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': 'RobloxStudio/WinInet',
        }
      });

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

  ipcMain.handle('select-folder', async (event) => {
    const { dialog } = require('electron');
    try {
      const result = await dialog.showOpenDialog(getMainWindowFn(), {
        properties: ['openDirectory', 'createDirectory']
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
async function handleSpooferAction(data, getMainWindowFn, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage) {
  // Always reset pause state at the start of a new run so a previously-paused
  // run that was interrupted can't block the next one.
  resumeSpoofer();

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
    const resumeInput = savedSession && (savedSession.retryAnimationIdInput || savedSession.animationIdInput);
    if (resumeInput) {
      data.animationId = resumeInput;
    }
  }

  const hasCustomDownloadFolder = !!(data.downloadOnly && data.downloadFolder && data.downloadFolder.trim());
  const downloadsDir = hasCustomDownloadFolder
    ? data.downloadFolder.trim()
    : path.join(app.getPath('userData'), 'ispoofer_downloads');

  // Validate download-only mode requires folder selection
  if (data.downloadOnly && (!data.downloadFolder || !data.downloadFolder.trim())) {
    sendSpooferResultToRenderer({ output: 'Please select a download folder for Download-Only mode.', success: false });
    sendStatusMessage('Error: No download folder selected');
    return;
  }

  if (!hasCustomDownloadFolder) {
    const cleared = await clearDownloadsDirectory(downloadsDir);
    if (!cleared) {
      if (DEVELOPER_MODE) console.warn('(Dev) Failed to fully clear downloads directory, proceeding anyway.');
      sendSpooferResultToRenderer({ output: 'Warning: Could not fully clear previous downloads.', success: false });
    }
  } else if (DEVELOPER_MODE) {
    console.log('(Dev) Skipping auto-clear: using user-selected download folder', downloadsDir);
  }

  if (!data.enableSpoofing && !data.downloadOnly) {
    sendSpooferResultToRenderer({ output: 'Enable Spoofing toggle is OFF and Download-Only mode is not enabled.', success: false });
    return;
  }

  // Validate group ID is numeric if provided
  if (data.groupId && !/^\d+$/.test(String(data.groupId).trim())) {
    sendSpooferResultToRenderer({ output: `Invalid Group ID "${data.groupId}" — must be a number only, not a URL or text.`, success: false });
    return;
  }

  // Both animation and sound uploads require an Open Cloud API key
  if (!data.downloadOnly && !data.apiKey) {
    sendSpooferResultToRenderer({
      output: 'Uploads now require an Open Cloud API key.\n\nTo fix this:\n1. Go to create.roblox.com → Open Cloud → API Keys\n2. Create a key with Assets Read & Write permissions\n3. Paste the key into the "Open Cloud API Key" field',
      success: false
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
    sendSpooferResultToRenderer({ output: `No valid ${isSoundMode ? 'sound' : 'animation'} entries.`, success: false });
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
      sendSpooferResultToRenderer({ output: `Failed to auto-detect cookie: ${err.message}`, success: false });
      return;
    }
  }
  if (!robloxCookie) {
    sendSpooferResultToRenderer({ output: 'Roblox cookie not provided.', success: false });
    return;
  }

  const robloxCookieHeader = buildRobloxCookieHeader(robloxCookie);
  if (!robloxCookieHeader) {
    sendSpooferResultToRenderer({ output: 'Invalid ROBLOSECURITY cookie format.', success: false });
    return;
  }

  // Open Cloud uploads and download-only mode do not require an X-CSRF token.
  // Keep the positional argument for publishAnimationRbxmWithProgress as null
  // for compatibility with the existing transfer-handler signature.
  const csrfToken = null;

  // Ensure downloads directory exists
  try {
    if (!(await fs.stat(downloadsDir).catch(() => null))) {
      await fs.mkdir(downloadsDir, { recursive: true });
      if (DEVELOPER_MODE) console.log('(Dev) Downloads directory created:', downloadsDir);
    }
  } catch (dirError) {
    sendSpooferResultToRenderer({ output: `Failed to ensure downloads directory exists: ${dirError.message}`, success: false });
    return;
  }

  // ── Session setup (crash recovery + resume) ──────────────────────────────
  const autoSaveSession = data.autoSaveSession !== false;
  const persistSession = async () => { if (autoSaveSession && session) await saveSession(session); };
  const isResume = data.resumeSession === true;
  let session = isResume ? await loadSession() : null;
  if (isResume && session) {
    // Filter to only assets not yet completed in the prior session
    const completedIds = new Set((session.completedMappings || []).map(m => m.originalId));
    animationEntries.splice(0, animationEntries.length,
      ...animationEntries.filter(e => !completedIds.has(String(e.id))));

    if (animationEntries.length === 0) {
      // All assets were already completed — just show the saved mappings and finish
      const mappingOutput = (session.completedMappings || []).map(m => `${m.originalId} = ${m.newId},`).join('\n');
      sendSpooferResultToRenderer({ output: mappingOutput.replace(/,$/, ''), success: true });
      sendStatusMessage('Session already complete');
      await clearSession();
      return;
    }

    sendSpooferResultToRenderer({ output: `Resuming — ${animationEntries.length} asset(s) remaining from previous session.\n`, success: true });
  } else {
    session = {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      mode: isSoundMode ? 'Audio' : 'Animation',
      animationIdInput: data.animationId, // stored so resume works even if textarea is empty after crash
      totalCount: animationEntries.length,
      completedMappings: [],
      failedEntries: [],
      retryAnimationIdInput: '',
      status: 'running',
    };
    await persistSession();
  }

  let verboseOutputMessage = `Processing ${animationEntries.length} ${isSoundMode ? 'sound' : 'animation'}(s)...\n`;
  let successfulUploadCount = 0;
  let downloadedSuccessfullyCount = 0;
  // Seed mappings from prior completed session work
  let uploadMappingOutput = (session.completedMappings || []).map(m => `${m.originalId} = ${m.newId},`).join('\n');
  if (uploadMappingOutput) uploadMappingOutput += '\n';

  const uploadTargetKey = data.groupId && String(data.groupId).trim()
    ? `group:${String(data.groupId).trim()}`
    : 'user';
  let cachedHistoryMappings = [];
  if (!data.downloadOnly && !isResume) {
    const history = await loadAssetHistory();
    const uncachedEntries = [];
    for (const entry of animationEntries) {
      const cached = history[buildHistoryKey(assetTypeName, uploadTargetKey, entry.id)];
      if (cached && cached.newId) {
        cachedHistoryMappings.push({ entry, newId: String(cached.newId) });
        uploadMappingOutput += `${entry.id} = ${cached.newId},\n`;
      } else {
        uncachedEntries.push(entry);
      }
    }
    if (cachedHistoryMappings.length > 0) {
      animationEntries.splice(0, animationEntries.length, ...uncachedEntries);
      sendStatusMessage(`Skipped ${cachedHistoryMappings.length} cached asset mapping(s)`);
    }
    if (animationEntries.length === 0) {
      sendSpooferResultToRenderer({
        output: uploadMappingOutput.trim().replace(/,$/, ''),
        success: true,
        failedAnimationIdInput: '',
        failedCount: 0,
        summary: {
          total: cachedHistoryMappings.length,
          downloaded: 0,
          uploaded: 0,
          cached: cachedHistoryMappings.length,
          downloadFailures: 0,
          uploadFailures: 0,
          skippedUploads: cachedHistoryMappings.length,
          downloadOnly: false,
          mode: 'Cached mappings',
          durationSeconds: 0,
          failureCategories: {},
          failures: [],
          mappings: (uploadMappingOutput || '').split('\n').map(line => line.trim()).filter(Boolean),
        },
      });
      sendStatusMessage('Run complete — cached mappings reused');
      return;
    }
  }

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
    if (DEVELOPER_MODE) console.log(`(Dev) Override Place ID provided: ${overridePlaceId}. Using this for all creators instead of fetching.`);
    const uniqueCreators = [...new Set(animationEntries.map(e => `${e.creatorType}:${e.creatorId}`))];
    for (const creatorKey of uniqueCreators) {
      placeIdMap[creatorKey] = [overridePlaceId];
    }
    if (DEVELOPER_MODE) console.log(`(Dev) Resolved placeIdMap with override:`, placeIdMap);
  } else if (animationEntries.length > 0) {
    if (DEVELOPER_MODE) console.log(`(Dev) Found ${animationEntries.length > 0 ? [...new Set(animationEntries.map(e => `${e.creatorType}:${e.creatorId}`))].length : 0} unique creators. Fetching placeIds (max ${maxPlaceIds} per creator, ${maxPlaceIdRetries} retries)...`);
    
    const uniqueCreators = [...new Set(animationEntries.map(e => `${e.creatorType}:${e.creatorId}`))];
    if (DEVELOPER_MODE) console.log(`(Dev) Fetching placeIds for ${uniqueCreators.length} creator(s) in parallel...`);

    await Promise.all(uniqueCreators.map(async (creatorKey) => {
      const [creatorType, creatorId] = creatorKey.split(':');
      try {
        const placeIds = await retryAsync(
          () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
          maxPlaceIdRetries,
          1000,
          (attempt, max, err) => {
            if (DEVELOPER_MODE) console.warn(`(Dev) Attempt ${attempt}/${max} for ${creatorKey}: ${err.message}`);
          }
        );
        placeIdMap[creatorKey] = Array.isArray(placeIds) ? placeIds : [placeIds];
        if (DEVELOPER_MODE) console.log(`(Dev) Got ${placeIdMap[creatorKey].length} placeIds for ${creatorKey}`);
      } catch (error) {
        if (DEVELOPER_MODE) console.warn(`(Dev) Could not get placeIds for ${creatorKey}: ${error.message}`);
        placeIdMap[creatorKey] = [99840799534728];
      }
    }));

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
  let chunkSize = parseInt(data.batchChunkSize, 10) || (batchItems.length > 50 ? 10 : 20);
  chunkSize = Math.max(1, Math.min(chunkSize, 25));

  async function fetchSingleBatchLocation(item) {
    const creatorKey = `${item.creatorType}:${item.creatorId}`;
    const placeIds = placeIdMap[creatorKey] || [99840799534728];
    const placeIdArray = Array.isArray(placeIds) ? placeIds : [placeIds];
    const itemWithoutCreator = (({ creatorType, creatorId, ...rest }) => rest)(item);
    let lastError = null;
    for (const placeId of placeIdArray) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(BATCH_TIMEOUT_MS, 20000));
        const resp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
          method: 'POST',
          headers: {
            'User-Agent': 'RobloxStudio/WinInet',
            'Content-Type': 'application/json',
            'Cookie': robloxCookieHeader,
            'Roblox-Place-Id': String(placeId),
          },
          body: JSON.stringify([itemWithoutCreator]),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        if (resp.ok) {
          const singleLocations = await resp.json();
          if (singleLocations && singleLocations[0]) return singleLocations[0];
        }
        lastError = new Error(`single batch status ${resp.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    return {
      requestId: item.requestId,
      errors: [{ code: 0, message: `Single-asset batch fallback failed: ${lastError && lastError.message ? lastError.message : 'unknown error'}` }],
    };
  }

  if (DEVELOPER_MODE) console.log(`(Dev) Fetching batch locations for ${batchItems.length} ${isSoundMode ? 'sounds' : 'animations'} with creator-specific placeIds`);
  for (let i = 0; i < batchItems.length; i += chunkSize) {
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
        if (creatorGroupIndex > 0) await new Promise(r => setTimeout(r, 500));
        creatorGroupIndex++;
        let [creatorType, creatorId] = creatorKey.split(':');
        let placeIdArray = placeIdMap[creatorKey] || [99840799534728];
        let placeIdIndex = 0;
        let retryCount = 0;
        const maxRetries = maxPlaceIdRetries;
        
        while (placeIdIndex < placeIdArray.length) {
          const placeId = placeIdArray[placeIdIndex];
          const itemsWithoutCreator = items.map(({ creatorType, creatorId, ...rest }) => rest);
          
          if (DEVELOPER_MODE) console.log(`(Dev) Batch request for ${creatorKey}: ${items.length} items with placeId ${placeId}${placeIdIndex > 0 ? ` (place index ${placeIdIndex}/${placeIdArray.length})` : ''}`);
          
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
                  'Cookie': robloxCookieHeader,
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
            const isTimeout = caughtErr && (caughtErr.name === 'AbortError' || /aborted|timeout/i.test(caughtErr.message));
            const retryable = isTimeout || status === 429 || status === 502 || status === 503 || status === 504 || status === 500;
            const statusText = resp ? `${status}` : (isTimeout ? 'timeout' : (caughtErr ? caughtErr.message : 'unknown'));
            if (DEVELOPER_MODE) console.warn(`(Dev) Batch attempt ${attempt}/${BATCH_MAX_RETRIES} for ${creatorKey} @ place ${placeId} failed: ${statusText}${retryable && attempt < BATCH_MAX_RETRIES ? ' -> retrying' : ''}`);

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
            await new Promise(r => setTimeout(r, delayMs + jitter));
          }

          if (!locations) throw new Error(`Batch request failed for ${creatorKey}: no response`);
          if (DEVELOPER_MODE) console.log(`(Dev) Batch response for ${creatorKey}:`, locations);
          
          // Check if response contains batch errors (403s for restricted assets)
          const hasBatchErrors = locations.some(loc => loc.errors && loc.errors.length > 0 && loc.errors[0].code === 403);

          // Print detailed batch errors for visibility
          const errorItems = locations.filter(loc => loc.errors && loc.errors.length > 0);
          if (errorItems.length > 0) {
            for (const locErr of errorItems) {
              const firstErr = locErr.errors[0] || {};
              const errMsg = firstErr.Message || firstErr.message || JSON.stringify(firstErr);
              console.warn(`Batch error for ${locErr.requestId} at place ${placeId}:`, firstErr);
              if (DEVELOPER_MODE) console.log('(Dev) Full batch item with error:', JSON.stringify(locErr, null, 2).substring(0, 500));
            }
          }
          
          if (hasBatchErrors) {
            if (placeIdIndex < placeIdArray.length - 1) {
              // Try next place ID
              if (DEVELOPER_MODE) console.log(`(Dev) Batch errors detected for ${creatorKey} with placeId ${placeId}. Trying next place...`);
              placeIdIndex++;
              continue;
            } else {
              // All places exhausted
              // If an override is set, do NOT fetch fresh place IDs; accept errors
              if (overridePlaceId) {
                if (DEVELOPER_MODE) console.log(`(Dev) Override Place ID in use for ${creatorKey}. Skipping fresh placeId fetch and accepting batch errors.`);
                for (const loc of locations) {
                  locationsMap[loc.requestId] = loc;
                }
                break;
              }
              // Otherwise, try to get fresh place IDs with retries
              if (retryCount < maxRetries) {
                retryCount++;
                if (DEVELOPER_MODE) console.log(`(Dev) All places exhausted for ${creatorKey}. Fetching fresh placeIds (retry ${retryCount}/${maxRetries})...`);
                try {
                  const freshPlaceIds = await retryAsync(
                    () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
                    1,
                    1000
                  );
                  placeIdMap[creatorKey] = Array.isArray(freshPlaceIds) ? freshPlaceIds : [freshPlaceIds];
                  placeIdArray = placeIdMap[creatorKey];
                  placeIdIndex = 0;
                  if (DEVELOPER_MODE) console.log(`(Dev) Got fresh placeIds for ${creatorKey}: ${placeIdArray.join(', ')}`);
                  continue;
                } catch (refreshErr) {
                  if (DEVELOPER_MODE) console.warn(`(Dev) Failed to refresh placeIds for ${creatorKey}: ${refreshErr.message}`);
                  // Accept the errors and continue
                  for (const loc of locations) {
                    locationsMap[loc.requestId] = loc;
                  }
                  break;
                }
              } else {
                // Max retries reached, accept the errors
                if (DEVELOPER_MODE) console.log(`(Dev) Max retries reached for ${creatorKey}, accepting batch errors`);
                for (const loc of locations) {
                  locationsMap[loc.requestId] = loc;
                }
                break;
              }
            }
          } else {
            // Success - no errors
            if (DEVELOPER_MODE) console.log(`(Dev) Batch request successful for ${creatorKey} with placeId ${placeId}`);
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
      const msg = (error && error.message) ? error.message : '';
      if (/\b401\b|\b403\b/.test(msg)) {
        hasAuthError = true;
      }
      sendStatusMessage(`Batch request failed; splitting ${chunk.length} item(s) into single-asset lookups...`);
      for (const item of chunk) {
        const transfer = initialTransferStates.find((t) => t.originalAssetId === item.requestId);
        if (transfer) sendTransferUpdate({ id: transfer.id, status: 'processing', message: 'Retrying as single-asset lookup' });
        const singleLoc = await fetchSingleBatchLocation(item);
        locationsMap[item.requestId] = singleLoc;
        if (transfer && singleLoc.errors && singleLoc.errors.length) {
          const errMsg = singleLoc.errors[0].message || singleLoc.errors[0].Message || 'Single-asset lookup failed';
          sendTransferUpdate({ id: transfer.id, status: 'queued', error: errMsg, message: 'Will try direct download fallback' });
        }
      }
      chunkSize = Math.max(1, Math.floor(chunkSize / 2));
    }
  }

  const UPLOAD_RETRIES = parseInt(data.uploadRetries, 10) || 3;
  const UPLOAD_RETRY_DELAY_MS = parseInt(data.uploadRetryDelay, 10) || 5000;
  // Download controls (optional overrides via data)
  const DOWNLOAD_RETRIES = parseInt(data.downloadRetries, 10) || 2;
  const DOWNLOAD_RETRY_DELAY_MS = parseInt(data.downloadRetryDelayMs, 10) || 2000;
  const DOWNLOAD_TIMEOUT_MS = parseInt(data.downloadTimeoutMs, 10) || 15000;

  // Worker pool shared by downloads and uploads. It prevents large input lists
  // from launching every network request/file write at once.
  const runWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) break;
        results[current] = await worker(items[current]);
      }
    });
    await Promise.all(workers);
    return results;
  };

  // Parallel downloads with bounded concurrency
  sendStatusMessage(`Downloading ${isSoundMode ? 'sounds' : 'animations'}...`);
  let downloadCompleted = 0;
  const downloadStartTime = Date.now();
  const batchProblemCount = animationEntries.reduce((count, entry) => {
    const loc = locationsMap[entry.id];
    return count + (!loc || (loc.errors && loc.errors.length > 0) || !loc.locations || loc.locations.length === 0 ? 1 : 0);
  }, 0);
  const baseDownloadConcurrency = Math.min(parseInt(data.downloadConcurrency, 10) || 10, animationEntries.length);
  const DOWNLOAD_CONCURRENCY = batchProblemCount > 0
    ? Math.max(2, Math.min(baseDownloadConcurrency, Math.ceil(animationEntries.length / 12) || 2))
    : baseDownloadConcurrency;
  if (batchProblemCount > 0 && DOWNLOAD_CONCURRENCY < baseDownloadConcurrency) {
    sendStatusMessage(`Adaptive mode: ${batchProblemCount} asset(s) need fallback checks; download concurrency lowered to ${DOWNLOAD_CONCURRENCY}`);
  }

  const downloadOne = async (entry) => {
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

    const tryDownloadUrl = async (url, reason) => {
      if (reason) {
        sendTransferUpdate({ id: downloadTransferId, status: 'processing', message: reason });
      }
      return downloadAnimationAssetWithProgress(
        url,
        robloxCookie,
        filePath,
        downloadTransferId,
        entry.name,
        entry.id,
        sendTransferUpdate,
        entryPlaceId,
        { timeoutMs: DOWNLOAD_TIMEOUT_MS, retries: DOWNLOAD_RETRIES, retryDelayMs: DOWNLOAD_RETRY_DELAY_MS }
      );
    };

    const loc = locationsMap[entry.id];
    let batchErrorMessage = '';
    let result = null;
    if (loc && loc.locations && loc.locations.length > 0 && loc.locations[0].location) {
      result = await tryDownloadUrl(loc.locations[0].location);
    } else {
      if (loc && loc.errors && loc.errors.length > 0) {
        const errorObj = loc.errors[0];
        batchErrorMessage = errorObj.Message || errorObj.message || JSON.stringify(errorObj) || 'Unknown batch error';
        if (DEVELOPER_MODE) console.log('Batch error for', entry.id, ':', errorObj);
      } else {
        batchErrorMessage = 'No location in batch response';
      }
      const directUrls = [
        `https://assetdelivery.roblox.com/v1/asset?id=${encodeURIComponent(entry.id)}&placeId=${encodeURIComponent(String(entryPlaceId || ''))}`,
        `https://assetdelivery.roblox.com/v1/asset/?id=${encodeURIComponent(entry.id)}`,
      ];
      for (const directUrl of directUrls) {
        result = await tryDownloadUrl(directUrl, 'Batch lookup failed; trying direct asset download fallback');
        if (result && result.success) break;
      }
      if (!result || !result.success) {
        return {
          entry,
          success: false,
          error: `Batch error: ${batchErrorMessage}. Direct fallback: ${result && result.error ? result.error : 'failed'}`,
          rawBatchError: batchErrorMessage,
        };
      }
    }
    downloadCompleted++;
    const elapsed = (Date.now() - downloadStartTime) / 1000;
    const avgTimePerItem = elapsed / downloadCompleted;
    const remaining = animationEntries.length - downloadCompleted;
    const etaSeconds = Math.ceil(avgTimePerItem * remaining);
    const etaMin = Math.floor(etaSeconds / 60);
    const etaSec = etaSeconds % 60;
    const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
    sendStatusMessage(`Downloaded ${downloadCompleted}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`);
    return { entry, filePath: result.success ? filePath : null, success: result.success, error: result.error };
  };
  const downloadResults = await runWithConcurrency(animationEntries, DOWNLOAD_CONCURRENCY, downloadOne);

  // Resolve the authenticated user ID once before the upload loop (needed for user-owned uploads)
  let authenticatedUserId = null;
  if (!data.downloadOnly && data.apiKey && !data.groupId) {
    try {
      authenticatedUserId = await getAuthenticatedUserId(robloxCookie);
      if (DEVELOPER_MODE) console.log(`(Dev) Resolved authenticated user ID for upload: ${authenticatedUserId}`);
    } catch (err) {
      if (DEVELOPER_MODE) console.warn(`(Dev) Could not resolve authenticated user ID: ${err.message}`);
      sendSpooferResultToRenderer({ output: `Failed to resolve your Roblox user ID: ${err.message}\n\nMake sure your cookie is valid.`, success: false });
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
    const UPLOAD_CONCURRENCY = Math.min(parseInt(data.uploadConcurrency, 10) || 10, successfulDownloads.length);

    // Worker pool: as soon as a slot finishes it picks up the next item immediately,
    // instead of waiting for a whole batch to finish before starting the next.

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

      const uploadFn = async () => {
        await checkPaused();
        const result = await publishAnimationRbxmWithProgress(filePath, entry.name, robloxCookie, csrfToken, data.groupId && String(data.groupId).trim() ? data.groupId : null, uploadTransferId, sendTransferUpdate, assetTypeName, data.apiKey || null, authenticatedUserId || null);
        if (!result.success) throw new Error(result.error || 'Upload failed');
        return result;
      };

      const onAttemptFailure = (attempt, maxAttempts, err) => {
        const classified = classifyError(err);
        const isFinal = attempt >= maxAttempts;
        if (DEVELOPER_MODE && classified.category === 'Rate limited') {
          console.warn(`(Dev) [RATE LIMIT DETECTED] ${entry.name}: ${classified.raw}`);
        }
        sendTransferUpdate({
          id: uploadTransferId,
          status: isFinal ? 'error' : 'cooldown',
          message: `${classified.category}: ${isFinal ? 'No more retries.' : 'Waiting before retry...'}`,
          error: classified.message,
          errorCategory: classified.category,
        });
      };

      const onCooldownTick = (remainingSeconds, totalSeconds, nextAttempt, maxAttempts, err) => {
        const classified = classifyError(err);
        sendTransferUpdate({
          id: uploadTransferId,
          status: 'cooldown',
          progress: Math.max(0, Math.min(99, Math.round(((totalSeconds - remainingSeconds) / totalSeconds) * 100))),
          message: `${classified.category}: retrying in ${remainingSeconds}s (${nextAttempt}/${maxAttempts})`,
          error: classified.message,
          errorCategory: classified.category,
          cooldownRemaining: remainingSeconds,
        });
        sendStatusMessage(`Paused for cooldown: retrying ${entry.name} in ${remainingSeconds}s`);
      };

      try {
        const uploadResult = await retryWithCooldown(uploadFn, UPLOAD_RETRIES, UPLOAD_RETRY_DELAY_MS, onAttemptFailure, onCooldownTick);
        // Save progress after each successful upload
        if (uploadResult.success && uploadResult.assetId) {
          if (!session.completedMappings.some(m => String(m.originalId) === String(entry.id))) {
            session.completedMappings.push({ originalId: String(entry.id), newId: uploadResult.assetId });
          }
          await rememberAssetMapping(assetTypeName, uploadTargetKey, entry.id, uploadResult.assetId, entry.name);
          session.lastUpdatedAt = new Date().toISOString();
          await persistSession();
        }
        uploadCompleted++;
        const elapsed = (Date.now() - uploadStartTime) / 1000;
        const avgTimePerItem = elapsed / uploadCompleted;
        const remaining = successfulDownloads.length - uploadCompleted;
        const etaSeconds = Math.ceil(avgTimePerItem * remaining);
        const etaMin = Math.floor(etaSeconds / 60);
        const etaSec = etaSeconds % 60;
        const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
        sendStatusMessage(`Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`);
        return { entry, success: uploadResult.success, assetId: uploadResult.assetId, error: uploadResult.error };
      } catch (finalRetryError) {
        const classified = classifyError(finalRetryError);
        sendTransferUpdate({ id: uploadTransferId, status: 'error', error: classified.message, errorCategory: classified.category, message: `All upload attempts failed: ${classified.category}` });
        uploadCompleted++;
        const elapsed = (Date.now() - uploadStartTime) / 1000;
        const avgTimePerItem = elapsed / uploadCompleted;
        const remaining = successfulDownloads.length - uploadCompleted;
        const etaSeconds = Math.ceil(avgTimePerItem * remaining);
        const etaMin = Math.floor(etaSeconds / 60);
        const etaSec = etaSeconds % 60;
        const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
        sendStatusMessage(`Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`);
        return { entry, success: false, error: classified.message, errorCategory: classified.category, rawError: classified.raw };
      }
    };
    uploadResults = await runWithConcurrency(successfulDownloads, UPLOAD_CONCURRENCY, uploadOne);
  }

  // Process results
  for (const downloadResult of downloadResults) {
    const entry = downloadResult.entry;
    verboseOutputMessage += `\n--- Processing: ${entry.name} (ID: ${entry.id}) ---\n`;
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
            console.error(`[${isSoundMode ? 'SOUND' : 'ANIMATION'} UPLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}`);
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
      sendStatusMessage('Run complete — see Run Report');
    } else {
      sendStatusMessage('Run complete — see Run Report');
    }
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send final status message', e);
  }

  const finishedAt = new Date().toISOString();
  const durationSeconds = Math.max(0, Math.round((Date.now() - new Date(session.startedAt || Date.now()).getTime()) / 1000));

  // Build concise run summary (counts, failures)
  const downloadFailures = downloadResults
    .filter(r => !r.success)
    .map(r => {
      const classified = classifyError(r.error || 'Unknown error');
      return { id: r.entry.id, name: r.entry.name, creator: `${r.entry.creatorType}:${r.entry.creatorId}`, reason: classified.message, category: classified.category, raw: classified.raw };
    });
  const uploadFailures = data.downloadOnly
    ? []
    : (uploadResults || [])
        .filter(u => !u.success)
        .map(u => {
          const classified = classifyError(u.rawError || u.error || 'Unknown error');
          return { id: u.entry.id, name: u.entry.name, creator: `${u.entry.creatorType}:${u.entry.creatorId}`, reason: u.error || classified.message, category: u.errorCategory || classified.category, raw: u.rawError || classified.raw };
        });
  
  // Detect rate-limit failures
  const rateLimitFailures = uploadFailures.filter(f => 
    f.category === 'Rate limited' || (f.reason || '').includes('429') || (f.reason || '').includes('Rate limit')
  );
  
  const skippedUploadsCount = data.downloadOnly ? 0 : downloadFailures.length;

  const listFailures = (label, items) => {
    if (!items || items.length === 0) return '';
    const maxItems = 5;
    const lines = items.slice(0, maxItems).map(it => `- ${it.name} (ID: ${it.id}) — ${it.category ? `[${it.category}] ` : ''}${it.reason}`);
    const remaining = items.length - maxItems;
    return `${label}:\n${lines.join('\n')}${remaining > 0 ? `\n(+${remaining} more…)` : ''}\n`;
  };

  let runSummary = `\n--- Summary ---\n` +
    `Mode: ${data.downloadOnly ? 'Download-Only' : 'Download + Upload'}\n` +
    `Total ${isSoundMode ? 'sounds' : 'animations'}: ${animationEntries.length}\n` +
    `Downloaded: ${downloadedSuccessfullyCount}/${animationEntries.length}${downloadFailures.length ? ` (Failed: ${downloadFailures.length})` : ''}\n` +
    (!data.downloadOnly ? `Uploaded: ${successfulUploadCount}/${downloadResults.filter(r=>r.success).length}${uploadFailures.length ? ` (Failed: ${uploadFailures.length}, Skipped: ${skippedUploadsCount})` : (skippedUploadsCount ? ` (Skipped: ${skippedUploadsCount})` : '')}\n` : '');

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
      .filter(r => r.success)
      .map(r => `${r.entry.name} (ID: ${r.entry.id})`)
      .join('\n');
    
    if (successfulDownloadsList) {
      finalOutput = `Downloaded ${downloadedSuccessfullyCount}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'} to:\n${downloadsDir}\n\nFiles:\n${successfulDownloadsList}`;
    } else {
      finalOutput = `No ${isSoundMode ? 'sounds' : 'animations'} were successfully downloaded.`;
    }
  } else if (uploadMappingOutput.trim()) {
    finalOutput = uploadMappingOutput.trim().replace(/,$/, '');
  } else {
    if (downloadedSuccessfullyCount > 0 && successfulUploadCount === 0) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}), but no ${isSoundMode ? 'sounds' : 'animations'} were successfully uploaded.`;
    } else if (animationEntries.length > 0) {
      finalOutput = (hasAuthError ? 'Authentication failed. Please check your Roblox cookie.' : `No ${isSoundMode ? 'sounds' : 'animations'} were successfully processed to provide mappings.`);
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

  const failedEntriesForRetry = dedupeAssetEntries([
    ...downloadFailures.map((failure) => animationEntries.find((entry) => String(entry.id) === String(failure.id))).filter(Boolean),
    ...uploadFailures.map((failure) => animationEntries.find((entry) => String(entry.id) === String(failure.id))).filter(Boolean),
  ]);
  const failedAnimationIdInput = failedEntriesForRetry.map(formatAssetEntry).join('\n');

  if (failedEntriesForRetry.length > 0) {
    session.status = 'incomplete';
    session.lastUpdatedAt = new Date().toISOString();
    session.failedEntries = failedEntriesForRetry.map((entry) => ({
      id: String(entry.id),
      name: entry.name,
      creatorType: entry.creatorType,
      creatorId: String(entry.creatorId),
    }));
    session.retryAnimationIdInput = failedAnimationIdInput;
    session.totalCount = animationEntries.length;
    await persistSession();
  } else {
    session.status = 'complete';
    await clearSession();
  }

  sendSpooferResultToRenderer({
    output: finalOutput,
    success: downloadedSuccessfullyCount > 0 || successfulUploadCount > 0,
    failedAnimationIdInput,
    failedCount: failedEntriesForRetry.length,
    summary: {
      total: animationEntries.length + cachedHistoryMappings.length,
      downloaded: downloadedSuccessfullyCount,
      uploaded: successfulUploadCount,
      downloadFailures: downloadFailures.length,
      uploadFailures: uploadFailures.length,
      cached: cachedHistoryMappings.length,
      skippedUploads: skippedUploadsCount,
      downloadOnly: !!data.downloadOnly,
      mode: data.downloadOnly ? 'Download-Only' : 'Download + Upload',
      startedAt: session.startedAt,
      finishedAt,
      durationSeconds,
      failureCategories: [...downloadFailures, ...uploadFailures].reduce((acc, f) => {
        acc[f.category || 'Unknown error'] = (acc[f.category || 'Unknown error'] || 0) + 1;
        return acc;
      }, {}),
      failures: [...downloadFailures.map(f => ({ ...f, stage: 'Download' })), ...uploadFailures.map(f => ({ ...f, stage: 'Upload' }))],
      mappings: (uploadMappingOutput || '').split('\n').map(line => line.trim()).filter(Boolean),
    },
  });

  // Clear downloads directory after operation completes (only if using temp directory, not user-selected folder)
  if (!data.downloadOnly) {
    try {
      await clearDownloadsDirectory(downloadsDir, false);
      if (DEVELOPER_MODE) console.log('(Dev) Downloads directory cleared after operation');
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Failed to clear downloads directory after operation:', err.message);
    }
  } else {
    if (DEVELOPER_MODE) console.log('(Dev) Download-only mode: keeping files in', downloadsDir);
  }
}

module.exports = {
  registerIpcHandlers,
};
