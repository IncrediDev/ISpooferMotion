// modules/utils/transfer-handlers.js
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { DEVELOPER_MODE } = require('./common');

/**
 * Downloads an animation asset with progress reporting
 */
async function downloadAnimationAssetWithProgress(url, robloxCookie, filePath, transferId, entryName, originalAssetId, sendTransferUpdate) {
  sendTransferUpdate({ id: transferId, name: entryName, originalAssetId: originalAssetId, status: 'processing', direction: 'download', progress: 0, error: null, size: 0 });
  try {
    const response = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }, redirect: 'follow' });
    if (!response.ok) throw new Error(`Failed to download asset: ${response.status} ${response.statusText}`);
    if (!response.body) throw new Error(`No response body for asset`);
    const totalSize = Number(response.headers.get('content-length'));
    sendTransferUpdate({ id: transferId, size: isNaN(totalSize) ? 0 : totalSize });
    const reader = response.body.getReader();
    const fileStream = fsSync.createWriteStream(filePath);
    let receivedLength = 0;
    let lastReportedProgress = -1;
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
    return { success: true, filePath };
  } catch (error) {
    console.error(`Download error for ${entryName}:`, error);
    sendTransferUpdate({ id: transferId, status: 'error', error: error.message, progress: lastReportedProgress >= 0 ? lastReportedProgress : 0 });
    return { success: false, error: error.message };
  }
}

/**
 * Publishes an animation RBXM file to Roblox
 */
async function publishAnimationRbxmWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId, sendTransferUpdate) {
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

  const uploadUrl = new URL('https://www.roblox.com/ide/publish/uploadnewanimation');
  uploadUrl.searchParams.set('assetTypeName', 'Animation');
  uploadUrl.searchParams.set('name', name);
  uploadUrl.searchParams.set('description', 'Placeholder');
  uploadUrl.searchParams.set('AllID', '1');
  uploadUrl.searchParams.set('ispublic', 'False');
  uploadUrl.searchParams.set('allowComments', 'True');
  uploadUrl.searchParams.set('isGamesAsset', 'False');
  if (groupId) uploadUrl.searchParams.set('groupId', groupId);

  const headers = {
    'Content-Type': 'application/octet-stream',
    'Cookie': `.ROBLOSECURITY=${cookie}`,
    'X-CSRF-TOKEN': csrfToken,
    'User-Agent': 'RobloxStudio/WinInet',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  };

  if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG - FETCH] Attempting upload for "${name}" to: ${uploadUrl.toString()}`);

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
    console.error(`[UPLOAD ERROR - FETCH] ${errorMsg}`, err.cause || err);
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

module.exports = {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
};
