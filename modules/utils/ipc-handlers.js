// modules/utils/ipc-handlers.js
const path = require('path');
const { ipcMain, app } = require('electron');
const crypto = require('crypto');
const { DEVELOPER_MODE } = require('./common');
const { getCookieFromRobloxStudio, getCsrfToken, getPlaceIdFromCreator } = require('./roblox-api');
const { clearDownloadsDirectory, retryAsync, sanitizeFilename } = require('./common');
const { downloadAnimationAssetWithProgress, publishAnimationRbxmWithProgress } = require('./transfer-handlers');
const fs = require('fs').promises;

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
    try {
      if (typeof url === 'string' && url.trim()) {
        shell.openExternal(url);
      } else if (DEVELOPER_MODE) {
        console.warn('open-external called with invalid url:', url);
      }
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to open external URL:', err);
    }
  });

  ipcMain.on('open-logs-folder', () => {
    const { shell } = require('electron');
    const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
    try {
      shell.openPath(logsDir);
      if (DEVELOPER_MODE) console.log('(Dev) Opened logs folder:', logsDir);
    } catch (err) {
      console.error('Failed to open logs folder:', err);
    }
  });

  ipcMain.on('run-spoofer-action', async (event, data) => {
    await handleSpooferAction(data, getMainWindowFn, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage);
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

      if (DEVELOPER_MODE) console.log('(Dev) Fetching from Roblox API...');
      const response = await fetch('https://publish.roblox.com/v1/asset-quotas?resourceType=RateLimitUpload&assetType=Audio', {
        headers: {
          'Cookie': `.ROBLOSECURITY=${cookie}`,
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
  if (DEVELOPER_MODE) {
    // Sanitize sensitive data before logging
    const sanitizedData = { ...data };
    if (sanitizedData.robloxCookie) {
      sanitizedData.robloxCookie = '{Cookie:Here}';
    }
    console.log('MAIN_PROCESS (Dev): Received run-spoofer-action with data:', sanitizedData);
  } else {
    console.log('MAIN_PROCESS: Received run-spoofer-action.');
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

  // Get CSRF token
  let csrfToken;
  try {
    csrfToken = await getCsrfToken(robloxCookie);
  } catch (err) {
    sendSpooferResultToRenderer({ output: `Failed to get CSRF token: ${err.message}`, success: false });
    return;
  }

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

  let verboseOutputMessage = `Processing ${animationEntries.length} ${isSoundMode ? 'sound' : 'animation'}(s)...\n`;
  let successfulUploadCount = 0;
  let downloadedSuccessfullyCount = 0;
  let uploadMappingOutput = '';

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
  let processedCount = 0;
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
    for (const creatorKey of uniqueCreators) {
      const [creatorType, creatorId] = creatorKey.split(':');
      try {
        if (DEVELOPER_MODE) console.log(`(Dev) Attempting to get placeIds for ${creatorType} ${creatorId}...`);
        const placeIds = await retryAsync(
          () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
          maxPlaceIdRetries,
          1000,
          (attempt, max, err) => {
            if (DEVELOPER_MODE) console.warn(`(Dev) Attempt ${attempt}/${max} to get placeIds for ${creatorKey} failed: ${err.message}`);
          }
        );
        // Ensure it's an array
        placeIdMap[creatorKey] = Array.isArray(placeIds) ? placeIds : [placeIds];
        if (DEVELOPER_MODE) console.log(`(Dev) Successfully got ${placeIdMap[creatorKey].length} placeIds for ${creatorKey}: ${placeIdMap[creatorKey].join(', ')}`);
      } catch (error) {
        if (DEVELOPER_MODE) console.warn(`(Dev) Could not get placeIds for ${creatorKey} (will use fallback): ${error.message}`);
        console.log(`[ERROR] Failed to fetch real place IDs for ${creatorKey}. Using fallback: 99840799534728`);
        placeIdMap[creatorKey] = [99840799534728]; // Temporary hardcoded fallback as array
      }
    }

    // Debug: show the resolved placeId map once fetched
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
      
      // Process each creator group separately
      for (const [creatorKey, items] of Object.entries(creatorGroups)) {
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
                  'Cookie': `.ROBLOSECURITY=${robloxCookie}`,
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

            // Backoff with basic jitter
            const jitter = Math.floor(Math.random() * 300);
            await new Promise(r => setTimeout(r, BATCH_RETRY_DELAY_MS + jitter));
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
      sendStatusMessage(`Batch request failed: ${error.message}`);
      for (const item of chunk) {
        const transfer = initialTransferStates.find((t) => t.originalAssetId === item.requestId);
        if (transfer) sendTransferUpdate({ id: transfer.id, status: 'error', error: 'Batch request failed' });
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
  sendStatusMessage('Downloading animations...');
  let downloadCompleted = 0;
  const downloadStartTime = Date.now();
  const downloadPromises = animationEntries.map(async (entry) => {
    const loc = locationsMap[entry.id];
    if (!loc) return { entry, success: false, error: 'No location in batch response' };
    if (loc.errors && loc.errors.length > 0) {
      const errorObj = loc.errors[0];
      const errorMsg = errorObj.Message || errorObj.message || JSON.stringify(errorObj) || 'Unknown';
      if (DEVELOPER_MODE) console.log('Batch error for', entry.id, ':', errorObj);
      return { entry, success: false, error: `Batch error: ${errorMsg}` };
    }
    if (!loc.locations || loc.locations.length === 0) return { entry, success: false, error: 'No locations in batch response' };
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
      { timeoutMs: DOWNLOAD_TIMEOUT_MS, retries: DOWNLOAD_RETRIES, retryDelayMs: DOWNLOAD_RETRY_DELAY_MS }
    );
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
  });
  const downloadResults = await Promise.all(downloadPromises);

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
    const uploadPromises = successfulDownloads.map(async (downloadResult) => {
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
      const logMsg = isRateLimit 
        ? `Upload attempt ${attempt}/${maxAttempts} for ${entry.name} rate-limited (429). Retrying with delay...`
        : `Upload attempt ${attempt}/${maxAttempts} for ${entry.name} failed. Retrying...`;
      if (DEVELOPER_MODE && isRateLimit) {
        console.warn(`(Dev) [RATE LIMIT DETECTED] ${entry.name}: ${errMsg}`);
      }
      sendTransferUpdate({
        id: uploadTransferId,
        status: 'processing',
        message: logMsg,
        error: err.message.substring(0, 120),
      });
    };
    const uploadFn = () => publishAnimationRbxmWithProgress(filePath, entry.name, robloxCookie, csrfToken, data.groupId && String(data.groupId).trim() ? data.groupId : null, uploadTransferId, sendTransferUpdate, assetTypeName);
    try {
      const uploadResult = await retryAsync(uploadFn, UPLOAD_RETRIES, UPLOAD_RETRY_DELAY_MS, onRetryAttempt);
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
      sendTransferUpdate({ id: uploadTransferId, status: 'error', error: `All upload attempts failed: ${finalRetryError.message}` });
      uploadCompleted++;
      const elapsed = (Date.now() - uploadStartTime) / 1000;
      const avgTimePerItem = elapsed / uploadCompleted;
      const remaining = successfulDownloads.length - uploadCompleted;
      const etaSeconds = Math.ceil(avgTimePerItem * remaining);
      const etaMin = Math.floor(etaSeconds / 60);
      const etaSec = etaSeconds % 60;
      const etaStr = remaining > 0 ? ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})` : '';
      sendStatusMessage(`Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`);
      return { entry, success: false, error: finalRetryError.message };
    }
  });
    uploadResults = await Promise.all(uploadPromises);
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
      sendStatusMessage(`Download Complete: ${downloadedSuccessfullyCount}/${animationEntries.length} files saved to ${downloadsDir}`);
    } else {
      sendStatusMessage(`Operation Successful: ${successfulUploadCount}/${animationEntries.length}`);
    }
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send final status message', e);
  }

  // Build concise run summary (counts, failures)
  const downloadFailures = downloadResults
    .filter(r => !r.success)
    .map(r => ({ id: r.entry.id, name: r.entry.name, reason: r.error || 'Unknown error' }));
  const uploadFailures = data.downloadOnly
    ? []
    : (uploadResults || [])
        .filter(u => !u.success)
        .map(u => ({ id: u.entry.id, name: u.entry.name, reason: u.error || 'Unknown error' }));
  
  // Detect rate-limit failures
  const rateLimitFailures = uploadFailures.filter(f => 
    (f.reason || '').includes('429') || (f.reason || '').includes('Rate limit')
  );
  
  const skippedUploadsCount = data.downloadOnly ? 0 : downloadFailures.length;

  const listFailures = (label, items) => {
    if (!items || items.length === 0) return '';
    const maxItems = 5;
    const lines = items.slice(0, maxItems).map(it => `- ${it.name} (ID: ${it.id}) — ${it.reason}`);
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
    if (downloadedSuccessfullyCount > 0 && csrfToken && successfulUploadCount === 0) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}), but no ${isSoundMode ? 'sounds' : 'animations'} were successfully uploaded.`;
    } else if (downloadedSuccessfullyCount > 0 && !csrfToken) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}). Uploads skipped (CSRF token missing).`;
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

  sendSpooferResultToRenderer({ output: finalOutput, success: downloadedSuccessfullyCount > 0 || successfulUploadCount > 0 });

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
