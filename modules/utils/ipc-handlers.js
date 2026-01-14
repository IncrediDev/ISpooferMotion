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

  const downloadsDir = data.downloadOnly && data.downloadFolder && data.downloadFolder.trim()
    ? data.downloadFolder.trim()
    : path.join(app.getPath('userData'), 'ispoofer_downloads');

  // Validate download-only mode requires folder selection
  if (data.downloadOnly && (!data.downloadFolder || !data.downloadFolder.trim())) {
    sendSpooferResultToRenderer({ output: 'Please select a download folder for Download-Only mode.', success: false });
    sendStatusMessage('Error: No download folder selected');
    return;
  }

  const cleared = await clearDownloadsDirectory(downloadsDir);
  if (!cleared) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to fully clear downloads directory, proceeding anyway.');
    sendSpooferResultToRenderer({ output: 'Warning: Could not fully clear previous downloads.', success: false });
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

  // Get placeIds for each creator (map creatorId -> array of placeIds)
  const placeIdMap = {};
  if (animationEntries.length > 0) {
    const uniqueCreators = [...new Set(animationEntries.map(e => `${e.creatorType}:${e.creatorId}`))];
    if (DEVELOPER_MODE) console.log(`(Dev) Found ${uniqueCreators.length} unique creators. Fetching placeIds...`);
    
    for (const creatorKey of uniqueCreators) {
      const [creatorType, creatorId] = creatorKey.split(':');
      try {
        if (DEVELOPER_MODE) console.log(`(Dev) Attempting to get placeIds for ${creatorType} ${creatorId}...`);
        const placeIds = await retryAsync(
          () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie),
          creatorType === 'group' ? 2 : 3,
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
  const chunkSize = 50;

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
        const maxRetries = 5;
        
        while (retryCount <= maxRetries && placeIdIndex < placeIdArray.length) {
          const placeId = placeIdArray[placeIdIndex];
          const itemsWithoutCreator = items.map(({ creatorType, creatorId, ...rest }) => rest);
          
          if (DEVELOPER_MODE) console.log(`(Dev) Batch request for ${creatorKey}: ${items.length} items with placeId ${placeId}${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}${placeIdIndex > 0 ? ` (place index ${placeIdIndex}/${placeIdArray.length})` : ''}`);
          
          const batchResp = await fetch('https://assetdelivery.roblox.com/v2/assets/batch', {
            method: 'POST',
            headers: {
              'User-Agent': 'RobloxStudio/WinInet',
              'Content-Type': 'application/json',
              'Cookie': `.ROBLOSECURITY=${robloxCookie}`,
            },
            body: JSON.stringify(itemsWithoutCreator),
          });
          if (!batchResp.ok) throw new Error(`Batch request failed for ${creatorKey}: ${batchResp.status}`);
          const locations = await batchResp.json();
          if (DEVELOPER_MODE) console.log(`(Dev) Batch response for ${creatorKey}:`, locations);
          
          // Check if response contains batch errors (403s for restricted assets)
          const hasBatchErrors = locations.some(loc => loc.errors && loc.errors.length > 0 && loc.errors[0].code === 403);
          
          if (hasBatchErrors) {
            if (placeIdIndex < placeIdArray.length - 1) {
              // Try next place ID
              if (DEVELOPER_MODE) console.log(`(Dev) Batch errors detected for ${creatorKey} with placeId ${placeId}. Trying next place...`);
              placeIdIndex++;
              retryCount++;
              continue;
            } else if (retryCount < maxRetries) {
              // Try to get fresh place IDs
              if (DEVELOPER_MODE) console.log(`(Dev) All places exhausted for ${creatorKey}. Fetching fresh placeIds and retrying...`);
              try {
                const freshPlaceIds = await retryAsync(
                  () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie),
                  1,
                  1000
                );
                placeIdMap[creatorKey] = Array.isArray(freshPlaceIds) ? freshPlaceIds : [freshPlaceIds];
                placeIdArray = placeIdMap[creatorKey];
                placeIdIndex = 0;
                if (DEVELOPER_MODE) console.log(`(Dev) Got fresh placeIds for ${creatorKey}: ${placeIdArray.join(', ')}`);
                retryCount++;
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
    const fileExtension = isSoundMode ? '.ogg' : '.rbxm';
    const fileName = `${sanitizedName}_${entry.id}${fileExtension}`;
    const filePath = path.join(downloadsDir, fileName);
    const downloadTransfer = initialTransferStates.find((t) => t.originalAssetId === entry.id);
    const downloadTransferId = downloadTransfer.id;
    sendTransferUpdate({ id: downloadTransferId, status: 'processing' });
    const creatorKey = `${entry.creatorType}:${entry.creatorId}`;
    const entryPlaceIds = placeIdMap[creatorKey] || [99840799534728];
    const entryPlaceId = Array.isArray(entryPlaceIds) ? entryPlaceIds[0] : entryPlaceIds;
    const result = await downloadAnimationAssetWithProgress(url, robloxCookie, filePath, downloadTransferId, entry.name, entry.id, sendTransferUpdate, entryPlaceId);
    downloadCompleted++;
    sendStatusMessage(`Downloaded ${downloadCompleted}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'}`);
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
    const uploadFn = () => publishAnimationRbxmWithProgress(filePath, entry.name, robloxCookie, csrfToken, data.groupId && String(data.groupId).trim() ? data.groupId : null, uploadTransferId, sendTransferUpdate, assetTypeName);
    try {
      const uploadResult = await retryAsync(uploadFn, UPLOAD_RETRIES, UPLOAD_RETRY_DELAY_MS, onRetryAttempt);
      uploadCompleted++;
      sendStatusMessage(`Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}`);
      return { entry, success: uploadResult.success, assetId: uploadResult.assetId, error: uploadResult.error };
    } catch (finalRetryError) {
      sendTransferUpdate({ id: uploadTransferId, status: 'error', error: `All upload attempts failed: ${finalRetryError.message}` });
      uploadCompleted++;
      sendStatusMessage(`Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}`);
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
      finalOutput = hasAuthError ? 'Authentication failed. Please check your Roblox cookie.' : `No ${isSoundMode ? 'sounds' : 'animations'} were successfully processed to provide mappings.`;
    } else {
      finalOutput = 'No operations performed.';
    }
  }

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
