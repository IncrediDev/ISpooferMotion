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

  ipcMain.on('run-spoofer-action', async (event, data) => {
    await handleSpooferAction(data, getMainWindowFn, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage);
  });
}

/**
 * Main spoofer action handler
 */
async function handleSpooferAction(data, getMainWindowFn, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage) {
  if (DEVELOPER_MODE) console.log('MAIN_PROCESS (Dev): Received run-spoofer-action with data:', data);
  else console.log('MAIN_PROCESS: Received run-spoofer-action.');

  const downloadsDir = path.join(app.getPath('userData'), 'ispoofer_downloads');

  const cleared = await clearDownloadsDirectory(downloadsDir);
  if (!cleared) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to fully clear downloads directory, proceeding anyway.');
    sendSpooferResultToRenderer({ output: 'Warning: Could not fully clear previous downloads.', success: false });
  }

  if (!data.enableSpoofing) {
    sendSpooferResultToRenderer({ output: 'Enable Spoofing toggle is OFF.', success: false });
    return;
  }

  // Parse animations
  const animationEntries = (data.animationId || '')
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

  if (animationEntries.length === 0) {
    sendSpooferResultToRenderer({ output: 'No valid animation entries.', success: false });
    return;
  }

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

  let verboseOutputMessage = `Processing ${animationEntries.length} animation(s)...\n`;
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

  // Get placeIds for each creator (map creatorId -> placeId)
  const placeIdMap = {};
  if (animationEntries.length > 0) {
    const uniqueCreators = [...new Set(animationEntries.map(e => `${e.creatorType}:${e.creatorId}`))];
    if (DEVELOPER_MODE) console.log(`(Dev) Found ${uniqueCreators.length} unique creators. Fetching placeIds...`);
    
    for (const creatorKey of uniqueCreators) {
      const [creatorType, creatorId] = creatorKey.split(':');
      try {
        if (DEVELOPER_MODE) console.log(`(Dev) Attempting to get placeId for ${creatorType} ${creatorId}...`);
        const placeId = await retryAsync(
          () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie),
          creatorType === 'group' ? 2 : 3,
          1000,
          (attempt, max, err) => {
            if (DEVELOPER_MODE) console.warn(`(Dev) Attempt ${attempt}/${max} to get placeId for ${creatorKey} failed: ${err.message}`);
          }
        );
        placeIdMap[creatorKey] = placeId;
        if (DEVELOPER_MODE) console.log(`(Dev) Successfully got placeId for ${creatorKey}: ${placeId}`);
      } catch (error) {
        if (DEVELOPER_MODE) console.warn(`(Dev) Could not get placeId for ${creatorKey} (will use fallback): ${error.message}`);
        placeIdMap[creatorKey] = 99840799534728; // Temporary hardcoded fallback
      }
    }
  }

  // Batch download locations
  const locationsMap = {};
  const batchItems = animationEntries.map((entry) => ({
    requestId: entry.id,
    assetId: parseInt(entry.id),
    assetType: 'Animation',
    creatorType: entry.creatorType,
    creatorId: entry.creatorId,
  }));
  const chunkSize = 50;

  if (DEVELOPER_MODE) console.log(`(Dev) Fetching batch locations for ${batchItems.length} animations with creator-specific placeIds`);
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
        let placeId = placeIdMap[creatorKey] || 99840799534728;
        let retryCount = 0;
        const maxRetries = 5;
        
        while (retryCount <= maxRetries) {
          const itemsWithoutCreator = items.map(({ creatorType, creatorId, ...rest }) => rest);
          
          if (DEVELOPER_MODE) console.log(`(Dev) Batch request for ${creatorKey}: ${items.length} items with placeId ${placeId}${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);
          
          const batchResp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
            method: 'POST',
            headers: {
              'User-Agent': 'RobloxStudio/WinInet',
              'Content-Type': 'application/json',
              'Cookie': `.ROBLOSECURITY=${robloxCookie}`,
              'Roblox-Place-Id': placeId.toString(),
            },
            body: JSON.stringify(itemsWithoutCreator),
          });
          if (!batchResp.ok) throw new Error(`Batch request failed for ${creatorKey}: ${batchResp.status}`);
          const locations = await batchResp.json();
          if (DEVELOPER_MODE) console.log(`(Dev) Batch response for ${creatorKey}:`, locations);
          
          // Check if response contains batch errors (403s for restricted assets)
          const hasBatchErrors = locations.some(loc => loc.errors && loc.errors.length > 0 && loc.errors[0].code === 403);
          
          if (hasBatchErrors && retryCount < maxRetries) {
            if (DEVELOPER_MODE) console.log(`(Dev) Batch errors detected for ${creatorKey}. Fetching new placeId and retrying...`);
            try {
              placeId = await retryAsync(
                () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie),
                1,
                1000
              );
              placeIdMap[creatorKey] = placeId;
              if (DEVELOPER_MODE) console.log(`(Dev) Got new placeId for ${creatorKey}: ${placeId}`);
              retryCount++;
              continue;
            } catch (refreshErr) {
              if (DEVELOPER_MODE) console.warn(`(Dev) Failed to refresh placeId for ${creatorKey}: ${refreshErr.message}`);
              break;
            }
          }
          
          for (const loc of locations) {
            locationsMap[loc.requestId] = loc;
          }
          break;
        }
      }
    } catch (error) {
      console.error('Batch request error:', error);
      hasAuthError = true;
      sendStatusMessage(`Batch request failed: ${error.message}`);
      for (const item of chunk) {
        const transfer = initialTransferStates.find((t) => t.originalAssetId === item.requestId);
        if (transfer) sendTransferUpdate({ id: transfer.id, status: 'error', error: 'Batch request failed' });
      }
    }
  }

  const UPLOAD_RETRIES = parseInt(data.uploadRetries, 10) || 3;
  const UPLOAD_RETRY_DELAY_MS = parseInt(data.uploadRetryDelay, 10) || 5000;

  // Parallel downloads
  sendStatusMessage('Downloading animations...');
  let downloadCompleted = 0;
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
    const fileName = `${sanitizedName}_${entry.id}.rbxm`;
    const filePath = path.join(downloadsDir, fileName);
    const downloadTransfer = initialTransferStates.find((t) => t.originalAssetId === entry.id);
    const downloadTransferId = downloadTransfer.id;
    sendTransferUpdate({ id: downloadTransferId, status: 'processing' });
    const creatorKey = `${entry.creatorType}:${entry.creatorId}`;
    const entryPlaceId = placeIdMap[creatorKey] || 99840799534728;
    const result = await downloadAnimationAssetWithProgress(url, robloxCookie, filePath, downloadTransferId, entry.name, entry.id, sendTransferUpdate, entryPlaceId);
    downloadCompleted++;
    sendStatusMessage(`Downloaded ${downloadCompleted}/${animationEntries.length} animations`);
    return { entry, filePath: result.success ? filePath : null, success: result.success, error: result.error };
  });
  const downloadResults = await Promise.all(downloadPromises);

  // Parallel uploads
  sendStatusMessage('Uploading animations...');
  let uploadCompleted = 0;
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
      sendTransferUpdate({
        id: uploadTransferId,
        status: 'processing',
        message: `Upload attempt ${attempt}/${maxAttempts} for ${entry.name} failed. Retrying...`,
        error: err.message.substring(0, 120),
      });
    };
    const uploadFn = () => publishAnimationRbxmWithProgress(filePath, entry.name, robloxCookie, csrfToken, data.groupId && String(data.groupId).trim() ? data.groupId : null, uploadTransferId, sendTransferUpdate);
    try {
      const uploadResult = await retryAsync(uploadFn, UPLOAD_RETRIES, UPLOAD_RETRY_DELAY_MS, onRetryAttempt);
      uploadCompleted++;
      sendStatusMessage(`Uploaded ${uploadCompleted}/${successfulDownloads.length} animations`);
      return { entry, success: uploadResult.success, assetId: uploadResult.assetId, error: uploadResult.error };
    } catch (finalRetryError) {
      sendTransferUpdate({ id: uploadTransferId, status: 'error', error: `All upload attempts failed: ${finalRetryError.message}` });
      uploadCompleted++;
      sendStatusMessage(`Uploaded ${uploadCompleted}/${successfulDownloads.length} animations`);
      return { entry, success: false, error: finalRetryError.message };
    }
  });
  const uploadResults = await Promise.all(uploadPromises);

  // Process results
  for (const downloadResult of downloadResults) {
    const entry = downloadResult.entry;
    verboseOutputMessage += `\n--- Processing: ${entry.name} (ID: ${entry.id}) ---\n`;
    if (downloadResult.success) {
      downloadedSuccessfullyCount++;
      verboseOutputMessage += `✓ Downloaded: ${entry.name} (ID: ${entry.id}) to ${downloadResult.filePath}\n`;
      const uploadResult = uploadResults.find((u) => u.entry.id === entry.id);
      if (uploadResult) {
        if (uploadResult.success) {
          successfulUploadCount++;
          uploadMappingOutput += `${entry.id} = ${uploadResult.assetId},\n`;
          verboseOutputMessage += `✓ Uploaded: ${entry.name} (Old ID: ${entry.id}) -> New ID: ${uploadResult.assetId}\n`;
        } else {
          console.error(`[UPLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}`);
          verboseOutputMessage += `✗ Upload Failed: ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}\n`;
        }
      } else {
        console.error(`[UPLOAD SKIPPED] ${entry.name} (ID: ${entry.id}): Download failed.`);
        verboseOutputMessage += `! Skipped Upload for ${entry.name}: Download failed.\n`;
      }
    } else {
      console.error(`[DOWNLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${downloadResult.error}`);
      verboseOutputMessage += `✗ Download Failed: ${entry.name} (ID: ${entry.id}) — ${downloadResult.error}\n`;
    }
  }

  try {
    sendStatusMessage(`Operation Successful: ${successfulUploadCount}/${animationEntries.length}`);
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send final status message', e);
  }

  // Output with mappings only
  let finalOutput = '';
  if (uploadMappingOutput.trim()) {
    finalOutput = uploadMappingOutput.trim().replace(/,$/, '');
  } else {
    if (downloadedSuccessfullyCount > 0 && csrfToken && successfulUploadCount === 0) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}), but no animations were successfully uploaded.`;
    } else if (downloadedSuccessfullyCount > 0 && !csrfToken) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}). Uploads skipped (CSRF token missing).`;
    } else if (animationEntries.length > 0) {
      finalOutput = hasAuthError ? 'Authentication failed. Please check your Roblox cookie.' : 'No animations were successfully processed to provide mappings.';
    } else {
      finalOutput = 'No operations performed.';
    }
  }

  sendSpooferResultToRenderer({ output: finalOutput, success: downloadedSuccessfullyCount > 0 || successfulUploadCount > 0 });
}

module.exports = {
  registerIpcHandlers,
};
