// modules/utils/transfer-handlers.js
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { DEVELOPER_MODE } = require('./common');

/**
 * Downloads an animation asset with progress reporting
 */
async function downloadAnimationAssetWithProgress(url, robloxCookie, filePath, transferId, entryName, originalAssetId, sendTransferUpdate, placeId = null, options = {}) {
  sendTransferUpdate({ id: transferId, name: entryName, originalAssetId: originalAssetId, status: 'processing', direction: 'download', progress: 0, error: null, size: 0 });
  if (DEVELOPER_MODE) {
    console.log(`[DOWNLOAD DEBUG] Starting download for "${entryName}" (Asset ID: ${originalAssetId})`);
    console.log(`[DOWNLOAD DEBUG] URL: ${url}`);
    console.log(`[DOWNLOAD DEBUG] PlaceId: ${placeId || 'not provided'}`);
    console.log(`[DOWNLOAD DEBUG] Target file: ${filePath}`);
  }
  // Track progress across try/catch to avoid ReferenceError
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  const retries = typeof options.retries === 'number' && options.retries > 0 ? options.retries : 2;
  const retryDelayMs = typeof options.retryDelayMs === 'number' && options.retryDelayMs > 0 ? options.retryDelayMs : 2000;
  let lastReportedProgress = 0;
  let fileStream = null;
  let attemptError = null;

  for (let attempt = 1; attempt <= (retries + 1); attempt++) {
    attemptError = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }, redirect: 'follow', signal: controller.signal });
      clearTimeout(timer);
    if (!response.ok) {
      const errorDetail = DEVELOPER_MODE 
        ? `Failed to download asset: ${response.status} ${response.statusText} | Asset ID: ${originalAssetId} | PlaceId: ${placeId || 'N/A'} | URL: ${url}` 
        : `Failed to download asset: ${response.status} ${response.statusText}`;
        throw new Error(errorDetail);
    }
    if (!response.body) throw new Error(`No response body for asset (ID: ${originalAssetId})`);
    const totalSize = Number(response.headers.get('content-length'));
    if (DEVELOPER_MODE) console.log(`[DOWNLOAD DEBUG] Content-Length: ${totalSize} bytes`);
    sendTransferUpdate({ id: transferId, size: isNaN(totalSize) ? 0 : totalSize });
    const reader = response.body.getReader();
    fileStream = fsSync.createWriteStream(filePath);
    let receivedLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
      receivedLength += value.length;
      if (totalSize > 0) {
        const currentProgress = Math.round((receivedLength / totalSize) * 100);
        if (currentProgress > lastReportedProgress) {
          sendTransferUpdate({ id: transferId, progress: currentProgress });
          lastReportedProgress = currentProgress;
        }
      }
    }
    fileStream.end();
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', (err) => reject(new Error(`File stream error: ${err.message}`)));
    });
    if (lastReportedProgress < 100 && totalSize > 0) sendTransferUpdate({ id: transferId, progress: 100 });
    sendTransferUpdate({ id: transferId, status: 'completed', progress: 100 });
    if (DEVELOPER_MODE) console.log(`[DOWNLOAD DEBUG] Successfully downloaded "${entryName}" (${receivedLength} bytes)`);
    return { success: true, filePath };
    } catch (error) {
      attemptError = error;
      const msg = error && error.message ? error.message : 'unknown error';
      const isTimeout = error && (error.name === 'AbortError' || /aborted|timeout/i.test(msg));
      const shouldRetry = isTimeout || /\b5\d\d\b/.test(msg) || /Failed to download asset: (500|502|503|504)/.test(msg);
      // Ensure stream is closed on error
      try { if (fileStream) fileStream.end(); } catch {}
      // Remove partial file if exists
      try { if (fsSync.existsSync(filePath)) fsSync.unlinkSync(filePath); } catch {}
      if (DEVELOPER_MODE) console.warn(`[DOWNLOAD DEBUG] Attempt ${attempt}/${retries + 1} for "${entryName}" failed (${isTimeout ? 'timeout' : 'error'}): ${msg}${shouldRetry && attempt <= retries ? ' -> retrying' : ''}`);
      if (!shouldRetry || attempt > retries) {
        const errorMsg = DEVELOPER_MODE 
          ? `[DOWNLOAD ERROR] "${entryName}" (Asset ID: ${originalAssetId}, PlaceId: ${placeId || 'N/A'}): ${msg}`
          : `Download error for ${entryName}: ${msg}`;
        console.error(errorMsg);
        sendTransferUpdate({ id: transferId, status: 'error', error: msg, progress: lastReportedProgress || 0 });
        return { success: false, error: msg };
      }
      // Backoff with jitter
      const jitter = Math.floor(Math.random() * 300);
      await new Promise(r => setTimeout(r, retryDelayMs + jitter));
      continue;
    }
  }
}

/**
 * Publishes an animation or sound RBXM file to Roblox
 */
async function publishAnimationRbxmWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate, assetTypeName = 'Animation') {
  let fileBuffer;
  let fileSize = 0;
  try {
    fileBuffer = await fs.readFile(filePath);
    fileSize = fileBuffer.length;
  } catch (fileError) {
    sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: `File system error: ${fileError.message}` });
    return { success: false, error: `File system error: ${fileError.message}` };
  }

  sendTransferUpdate({
    id: transferId,
    name,
    size: fileSize,
    status: 'processing',
    direction: 'upload',
    progress: 0,
    error: null,
  });

  // Use different endpoint for Audio vs Animation
  const isAudio = assetTypeName === 'Audio';
  
  if (isAudio) {
    // Use modern API for audio uploads - need to get CSRF token for publish.roblox.com domain
    let publishCsrfToken = csrfToken;
    
    // Get a fresh CSRF token specifically for publish.roblox.com
    try {
      const csrfResponse = await fetch('https://publish.roblox.com/v1/audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `.ROBLOSECURITY=${cookie}`,
        },
        body: JSON.stringify({}),
      });
      const newToken = csrfResponse.headers.get('x-csrf-token');
      if (newToken) {
        publishCsrfToken = newToken;
        if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Got fresh CSRF token for publish.roblox.com`);
      }
    } catch (csrfError) {
      if (DEVELOPER_MODE) console.warn(`[UPLOAD DEBUG] Failed to get fresh CSRF token, using existing one:`, csrfError.message);
    }

    const uploadUrl = 'https://publish.roblox.com/v1/audio';
    
    // Create JSON payload for audio upload
    const payload = {
      name: name,
      file: fileBuffer.toString('base64'),
      assetPrivacy: 1,
      estimatedFileSize: fileSize,
      estimatedDuration: 0,
      paymentSource: 'User'
    };
    if (groupId) payload.groupId = parseInt(groupId);

    const headers = {
      'Content-Type': 'application/json',
      'Cookie': `.ROBLOSECURITY=${cookie}`,
      'x-csrf-token': publishCsrfToken,
      'User-Agent': 'RobloxStudio/WinInet',
    };

    if (DEVELOPER_MODE) {
      console.log(`[UPLOAD DEBUG - FETCH] Attempting ${assetTypeName} upload for "${name}" to: ${uploadUrl}`);
      console.log(`[UPLOAD DEBUG] Payload size: ${fileSize} bytes (base64: ${payload.file.length} chars)`);
    }

    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const responseData = await response.json();
      if (!response.ok) {
        // Detect rate limit (429) or server errors for clearer messaging
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after') || 'unknown';
          throw new Error(`Rate limit exceeded (429). Retry-After: ${retryAfter}s. Response: ${JSON.stringify(responseData)}`);
        } else if (response.status >= 500) {
          throw new Error(`Server error (${response.status}). Response: ${JSON.stringify(responseData)}`);
        } else {
          throw new Error(`Upload failed (Status: ${response.status}). Response: ${JSON.stringify(responseData)}`);
        }
      }
      const newAssetId = responseData.Id || responseData.id || responseData.assetId;
      if (newAssetId) {
        sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: newAssetId.toString() });
        return { success: true, assetId: newAssetId.toString() };
      } else {
        throw new Error(`Upload successful (Status ${response.status}) but the response did not contain an asset ID. Response: ${JSON.stringify(responseData)}`);
      }
    } catch (err) {
      const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
      const isRateLimit = errorMsg.includes('429') || errorMsg.includes('Rate limit');
      if (DEVELOPER_MODE || isRateLimit) {
        console.error(`[UPLOAD ERROR - FETCH] ${assetTypeName} upload failed${isRateLimit ? ' (RATE LIMIT)' : ''}: ${errorMsg}`, err.cause || err);
      }
      sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
      return { success: false, error: errorMsg };
    }
  } else {
    // Use legacy endpoint for animation uploads
    const uploadUrl = new URL('https://www.roblox.com/ide/publish/uploadnewanimation');
    uploadUrl.searchParams.set('assetTypeName', assetTypeName);
    uploadUrl.searchParams.set('name', name);
    uploadUrl.searchParams.set('description', 'Placeholder');
    uploadUrl.searchParams.set('ispublic', 'false');
    uploadUrl.searchParams.set('allowComments', 'true');
    uploadUrl.searchParams.set('isGamesAsset', 'false');
    if (groupId) uploadUrl.searchParams.set('groupId', groupId);

    const headers = {
      'Content-Type': 'application/octet-stream',
      'Cookie': `.ROBLOSECURITY=${cookie}`,
      'X-CSRF-TOKEN': csrfToken,
      'User-Agent': 'RobloxStudio/WinInet',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    };

    if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG - FETCH] Attempting ${assetTypeName} upload for "${name}" to: ${uploadUrl.toString()}`);

    try {
      const response = await fetch(uploadUrl.toString(), {
        method: 'POST',
        headers,
        body: fileBuffer,
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`Upload failed (Status: ${response.status}). Response: ${bodyText.substring(0, 350)}`);
      }
      const newAssetId = bodyText.trim();
      if (newAssetId && /^\d+$/.test(newAssetId)) {
        sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: newAssetId });
        return { success: true, assetId: newAssetId };
      } else {
        throw new Error(`Upload successful (Status ${response.status}) but the response was not a valid Asset ID. Response: "${bodyText.substring(0, 350)}"`);
      }
    } catch (err) {
      const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
      console.error(`[UPLOAD ERROR - FETCH] ${assetTypeName} upload failed: ${errorMsg}`, err.cause || err);
      sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
      return { success: false, error: errorMsg };
    }
  }
}

module.exports = {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
};
