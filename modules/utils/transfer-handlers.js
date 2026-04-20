// modules/utils/transfer-handlers.js
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { DEVELOPER_MODE, buildRobloxCookieHeader } = require('./common');

/**
 * Downloads an animation asset with progress reporting
 */
async function downloadAnimationAssetWithProgress(url, robloxCookie, filePath, transferId, entryName, originalAssetId, sendTransferUpdate, placeId = null, options = {}) {
  const cookieHeader = buildRobloxCookieHeader(robloxCookie);
  if (!cookieHeader) {
    const errorMsg = 'Missing or invalid ROBLOSECURITY cookie';
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }

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
      const response = await fetch(url, { headers: { Cookie: cookieHeader }, redirect: 'follow', signal: controller.signal });
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
async function publishAnimationRbxmWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate, assetTypeName = 'Animation', apiKey = null, userId = null) {
  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) {
    sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: 'Missing or invalid ROBLOSECURITY cookie' });
    return { success: false, error: 'Missing or invalid ROBLOSECURITY cookie' };
  }

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

  const isAudio = assetTypeName === 'Audio';

  // Both Audio and Animation use Open Cloud Assets API
  if (!apiKey) {
    const assetLabel = isAudio ? 'Sound' : 'Animation';
    const errorMsg = `${assetLabel} uploads require an Open Cloud API key. Go to create.roblox.com → Open Cloud → API Keys and create a key with Assets Read & Write permissions.`;
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }

  const creatorObj = groupId
    ? { groupId: String(groupId) }
    : { userId: String(userId) };

  const assetType = isAudio ? 'Audio' : 'Animation';
  const fileType = isAudio ? 'audio/ogg' : 'model/x-rbxm';
  const fileName = isAudio ? 'audio.ogg' : 'animation.rbxm';

  const requestMetadata = {
    assetType,
    displayName: name,
    description: 'Placeholder',
    creationContext: { creator: creatorObj },
  };

  if (DEVELOPER_MODE) {
    console.log(`[UPLOAD DEBUG] Attempting ${assetType} upload for "${name}" via Open Cloud API`);
    console.log(`[UPLOAD DEBUG] Creator: ${JSON.stringify(creatorObj)}`);
  }

  try {
    const MAX_RATE_LIMIT_RETRIES = 4;
    let response, responseData;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      const formData = new FormData();
      formData.append('request', JSON.stringify(requestMetadata));
      formData.append('fileContent', new Blob([fileBuffer], { type: fileType }), fileName);

      response = await fetch('https://apis.roblox.com/assets/v1/assets', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: formData,
      });

      if (response.status === 429) {
        if (attempt >= MAX_RATE_LIMIT_RETRIES) throw new Error(`Rate limit hit after ${MAX_RATE_LIMIT_RETRIES} retries. Try again later.`);
        const retryAfter = Math.min(parseInt(response.headers.get('retry-after') || '60', 10), 120);
        if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Rate limited (429), waiting ${retryAfter}s before retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}`);
        sendTransferUpdate({ id: transferId, status: 'processing', progress: 0 });
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      responseData = await response.json();
      break;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`API key rejected (${response.status}). Make sure your key has Assets Read & Write permissions. Response: ${JSON.stringify(responseData)}`);
      } else if (response.status >= 500) {
        throw new Error(`Server error (${response.status}). Response: ${JSON.stringify(responseData)}`);
      } else {
        throw new Error(`Upload failed (Status: ${response.status}). Response: ${JSON.stringify(responseData)}`);
      }
    }

    // Synchronous success
    if (responseData.done && responseData.response) {
      const assetId = responseData.response.assetId || responseData.response.Id;
      if (assetId) {
        sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: String(assetId) });
        return { success: true, assetId: String(assetId) };
      }
    }

    // Async operation — poll until done
    if (responseData.path && !responseData.done) {
      const operationPath = responseData.path;
      if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Operation pending, polling: ${operationPath}`);
      const maxPollAttempts = 15;
      const pollIntervalMs = 2000;
      for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        const pollResp = await fetch(`https://apis.roblox.com/assets/v1/${operationPath}`, {
          headers: { 'x-api-key': apiKey },
        });
        const pollData = await pollResp.json();
        if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG] Poll attempt ${attempt}/${maxPollAttempts}: done=${pollData.done}`);
        if (pollData.done && pollData.response) {
          const assetId = pollData.response.assetId || pollData.response.Id;
          if (assetId) {
            sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: String(assetId) });
            return { success: true, assetId: String(assetId) };
          }
        }
      }
      throw new Error(`Upload timed out waiting for Roblox to process the ${assetType.toLowerCase()}.`);
    }

    throw new Error(`Unexpected response from Open Cloud API: ${JSON.stringify(responseData)}`);
  } catch (err) {
    const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
    const isRateLimit = errorMsg.includes('429') || errorMsg.includes('Rate limit');
    console.error(`[UPLOAD ERROR] ${assetType} upload failed${isRateLimit ? ' (RATE LIMIT)' : ''}: ${errorMsg}`);
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

module.exports = {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
};
