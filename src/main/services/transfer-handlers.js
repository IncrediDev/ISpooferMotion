const crypto = require('crypto');
const fs = require('fs').promises;
const { DEVELOPER_MODE, buildRobloxCookieHeader } = require('./common');
const { retryDelayWithJitter } = require('../../core/queue');
const { classifyAssetError } = require('../../core/errors');
const {
  delay,
  downloadFile,
  fetchWithTimeout,
  isAbortLikeError,
  readTextWithTimeout,
} = require('../../core/downloads');

let _rlUntil = 0;
let _dynamicConcurrencyLimit = 50; // High default, constrained mostly by user limits
let _activeTransfers = 0;

function createMachineId() {
  const parts = [];
  for (let i = 0; i < 4; i++)
    parts.push(
      (crypto.randomBytes
        ? crypto.randomBytes(4)
        : crypto.webcrypto.getRandomValues(new Uint8Array(4))
      )
        .toString('hex')
        .toUpperCase(),
    );
  return parts.join('-');
}
const runSessionId = crypto.randomUUID
  ? crypto.randomUUID()
  : crypto.randomBytes(16).toString('hex');
const browserSessionId = crypto.randomUUID
  ? crypto.randomUUID()
  : crypto.randomBytes(16).toString('hex');
const machineId = createMachineId();

// Helper to inject spoofed headers locally per request
function getSpoofedHeaders(robloxCookieHeader) {
  return {
    'User-Agent': 'RobloxStudio/WinInet',
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Requester: 'Client',
    'Sec-CH-UA': '" Not A;Brand";v="99", "Chromium";v="101"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Roblox-Session-Id': runSessionId,
    'Roblox-Browser-Session-Id': browserSessionId,
    'Roblox-Machine-Id': machineId,
    'Roblox-Idempotency-Key': crypto.randomUUID
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex'),
    Cookie: robloxCookieHeader,
  };
}

function setRateLimit(ms, triggerBackoff = false) {
  _rlUntil = Math.max(_rlUntil, Date.now() + ms);
  if (triggerBackoff) {
    _dynamicConcurrencyLimit = Math.max(1, Math.floor(_dynamicConcurrencyLimit / 2));
  }
}

async function waitRateLimit(waitForDelay = delay) {
  while (true) {
    const wait = _rlUntil - Date.now();
    if (wait > 0) {
      await waitForDelay(wait + 50);
      continue;
    }
    if (_activeTransfers >= Math.floor(_dynamicConcurrencyLimit)) {
      await waitForDelay(150);
      continue;
    }
    break;
  }
}

function enterTransferSlot() {
  _activeTransfers++;
}

function leaveTransferSlot(success = false) {
  _activeTransfers = Math.max(0, _activeTransfers - 1);
  if (success && _dynamicConcurrencyLimit < 50) {
    _dynamicConcurrencyLimit += 0.5; // Additive increase
  }
}

async function readRobloxResponseBody(response, timeoutMs, label) {
  let text = '';
  try {
    text = await readTextWithTimeout(response, timeoutMs, label);
  } catch (err) {
    return {
      parseError: err && err.message ? err.message : String(err),
      rawText: '',
    };
  }

  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    return {
      parseError: err && err.message ? err.message : String(err),
      rawText: text.slice(0, 1000),
    };
  }
}

async function downloadAnimationAssetWithProgress(
  url,
  robloxCookie,
  filePath,
  transferId,
  entryName,
  originalAssetId,
  sendTransferUpdate,
  placeId = null,
  options = {},
) {
  const cookieHeader = buildRobloxCookieHeader(robloxCookie);
  if (!cookieHeader) {
    const errorMsg = 'Missing or invalid ROBLOSECURITY cookie';
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }

  sendTransferUpdate({
    id: transferId,
    name: entryName,
    originalAssetId,
    status: 'processing',
    direction: 'download',
    progress: 0,
    error: null,
    size: 0,
  });
  if (DEVELOPER_MODE) {
    console.log(
      `[DOWNLOAD DEBUG] Starting download for "${entryName}" (Asset ID: ${originalAssetId})`,
    );
    console.log(`[DOWNLOAD DEBUG] URL: ${url}`);
    console.log(`[DOWNLOAD DEBUG] PlaceId: ${placeId || 'not provided'}`);
    console.log(`[DOWNLOAD DEBUG] Target file: ${filePath}`);
  }

  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  const retries = typeof options.retries === 'number' && options.retries >= 0 ? options.retries : 2;
  const retryDelayMs =
    typeof options.retryDelayMs === 'number' && options.retryDelayMs > 0
      ? options.retryDelayMs
      : 2000;
  const bodyReadTimeoutMs =
    typeof options.bodyReadTimeoutMs === 'number' && options.bodyReadTimeoutMs > 0
      ? options.bodyReadTimeoutMs
      : Math.max(timeoutMs, 20000);
  const overallTimeoutMs =
    typeof options.overallTimeoutMs === 'number' && options.overallTimeoutMs > 0
      ? options.overallTimeoutMs
      : Math.max(timeoutMs * 4, 60000);
  const waitForRetry = typeof options.waitForRetry === 'function' ? options.waitForRetry : delay;
  const isCancelError = typeof options.isCancelError === 'function' ? options.isCancelError : null;
  let lastReportedProgress = 0;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const result = await downloadFile(url, filePath, {
        headers: getSpoofedHeaders(cookieHeader),
        requestTimeoutMs: timeoutMs,
        bodyStallTimeoutMs: bodyReadTimeoutMs,
        overallTimeoutMs,
        signal: options.signal || null,
        waitForRetry,
        retries: 0,
        label: `Download for ${entryName}`,
        onStart: ({ totalSize }) => {
          if (DEVELOPER_MODE)
            console.log(`[DOWNLOAD DEBUG] Content-Length: ${totalSize || 0} bytes`);
          sendTransferUpdate({ id: transferId, size: totalSize || 0 });
        },
        onProgress: ({ progress }) => {
          if (typeof progress === 'number' && progress > lastReportedProgress) {
            sendTransferUpdate({ id: transferId, progress });
            lastReportedProgress = progress;
          }
        },
      });

      sendTransferUpdate({ id: transferId, progress: 100, status: 'completed' });
      if (DEVELOPER_MODE)
        console.log(
          `[DOWNLOAD DEBUG] Successfully downloaded "${entryName}" (${result.bytesWritten} bytes)`,
        );
      return {
        success: true,
        filePath,
        bytesWritten: result.bytesWritten || 0,
        totalSize: result.totalSize || 0,
      };
    } catch (error) {
      if (
        (isCancelError && isCancelError(error)) ||
        (options.signal && options.signal.aborted && isAbortLikeError(error))
      ) {
        throw error;
      }
      const msg = error && error.message ? error.message : 'unknown error';
      const classified = classifyAssetError(error, { stage: 'download' });
      const shouldRetry = classified.retryable === true;
      if (DEVELOPER_MODE) {
        console.warn(
          `[DOWNLOAD DEBUG] Attempt ${attempt}/${retries + 1} for "${entryName}" failed: ${msg}${shouldRetry && attempt <= retries ? ' -> retrying' : ''}`,
        );
      }
      if (!shouldRetry || attempt > retries) {
        const errorMsg = DEVELOPER_MODE
          ? `[DOWNLOAD ERROR] "${entryName}" (Asset ID: ${originalAssetId}, PlaceId: ${placeId || 'N/A'}): ${msg}`
          : `Download error for ${entryName}: ${classified.message}`;
        console.error(errorMsg);
        sendTransferUpdate({
          id: transferId,
          status: 'error',
          error: classified.message,
          errorCategory: classified.category,
          progress: lastReportedProgress || 0,
        });
        return {
          success: false,
          error: classified.message,
          rawError: classified.raw,
          errorCategory: classified.category,
          retryable: classified.retryable,
        };
      }
      sendTransferUpdate({
        id: transferId,
        status: 'cooldown',
        message: `Download failed. Retrying ${attempt + 1}/${retries + 1}...`,
        error: classified.message,
        errorCategory: classified.category,
        progress: lastReportedProgress || 0,
      });
      await waitForRetry(retryDelayWithJitter(retryDelayMs, attempt, { maxDelayMs: 30000 }));
    }
  }

  return { success: false, error: 'Download failed without a final result.', retryable: true };
}

async function publishAnimationRbxmWithProgress(
  filePath,
  name,
  cookie,
  csrfToken,
  groupId = null,
  transferId,
  sendTransferUpdate,
  assetTypeName = 'Animation',
  apiKey = null,
  userId = null,
  options = {},
) {
  let fileBuffer;
  let fileSize = 0;
  try {
    fileBuffer = await fs.readFile(filePath);
    fileSize = fileBuffer.length;
  } catch (fileError) {
    sendTransferUpdate({
      id: transferId,
      name,
      status: 'error',
      direction: 'upload',
      error: `File system error: ${fileError.message}`,
    });
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

  if (!apiKey) {
    const assetLabel = isAudio ? 'Sound' : 'Animation';
    const errorMsg = `${assetLabel} uploads require an Open Cloud API key. Go to create.roblox.com → Open Cloud → API Keys and create a key with Assets Read & Write permissions.`;
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }

  const creatorObj = groupId
    ? { groupId: String(groupId) }
    : userId
      ? { userId: String(userId) }
      : null;
  if (!creatorObj) {
    const errorMsg = 'User uploads need a resolved Roblox user ID before calling Open Cloud.';
    sendTransferUpdate({
      id: transferId,
      status: 'error',
      error: errorMsg,
      errorCategory: 'upload_permission',
      progress: 0,
    });
    return {
      success: false,
      error: errorMsg,
      errorCategory: 'upload_permission',
      retryable: false,
    };
  }

  const assetType = isAudio ? 'Audio' : 'Animation';
  const fileType = isAudio ? 'audio/ogg' : 'model/x-rbxm';
  const safeNameBase = (name || 'asset').replace(/[<>:"/\\|?*\r\n]/g, '_').substring(0, 100);
  const fileName = isAudio ? `${safeNameBase}.ogg` : `${safeNameBase}.rbxm`;

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
    const waitForDelay = typeof options.waitForDelay === 'function' ? options.waitForDelay : delay;
    const beforeNetwork =
      typeof options.beforeNetwork === 'function' ? options.beforeNetwork : async () => {};
    const MAX_RATE_LIMIT_RETRIES = 4;
    let response, responseData;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      await beforeNetwork();
      const formData = new FormData();
      formData.append('request', JSON.stringify(requestMetadata));
      formData.append('fileContent', new Blob([fileBuffer], { type: fileType }), fileName);
      await waitRateLimit(waitForDelay);
      enterTransferSlot();
      let fetchErr = null;
      try {
        await beforeNetwork();
        const formData = new FormData();
        formData.append('request', JSON.stringify(requestMetadata));
        formData.append('fileContent', new Blob([fileBuffer], { type: fileType }), fileName);

        response = await fetchWithTimeout(
          'https://apis.roblox.com/assets/v1/assets',
          {
            method: 'POST',
            headers: { 'x-api-key': apiKey },
            body: formData,
            signal: options.signal || null,
          },
          30000,
          `${assetType} upload request`,
        );
      } catch (err) {
        fetchErr = err;
      }

      if (!fetchErr && response && response.status === 429) {
        leaveTransferSlot(false);
        if (attempt >= MAX_RATE_LIMIT_RETRIES)
          throw new Error(
            `Rate limit hit after ${MAX_RATE_LIMIT_RETRIES} retries. Try again later.`,
          );
        const retryAfter = Math.min(parseInt(response.headers.get('retry-after') || '30', 10), 60);
        const jitter = Math.floor(Math.random() * 8000);
        if (DEVELOPER_MODE)
          console.log(
            `[UPLOAD DEBUG] Rate limited (429), pausing all slots for ${retryAfter}s + ${jitter}ms jitter`,
          );
        sendTransferUpdate({ id: transferId, status: 'processing', progress: 0 });
        setRateLimit(retryAfter * 1000 + jitter, true);
        continue;
      }

      leaveTransferSlot(fetchErr ? false : response && response.ok);
      if (fetchErr) throw fetchErr;

      responseData = await readRobloxResponseBody(response, 10000, `${assetType} upload response`);
      break;
    }

    if (!response.ok) {
      const responseSummary = JSON.stringify(responseData || {});
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `API key rejected (${response.status}). Make sure your key has Assets Read & Write permissions. Response: ${responseSummary}`,
        );
      } else if (response.status === 400) {
        throw new Error(`Upload validation failed (400). Response: ${responseSummary}`);
      } else if (response.status === 429) {
        throw new Error(`Rate limit hit while uploading. Response: ${responseSummary}`);
      } else if (response.status >= 500) {
        throw new Error(`Server error (${response.status}). Response: ${responseSummary}`);
      } else {
        throw new Error(`Upload failed (Status: ${response.status}). Response: ${responseSummary}`);
      }
    }

    if (responseData.done && responseData.response) {
      const assetId = responseData.response.assetId || responseData.response.Id;
      if (assetId) {
        sendTransferUpdate({
          id: transferId,
          progress: 100,
          status: 'completed',
          newAssetId: String(assetId),
        });
        return { success: true, assetId: String(assetId) };
      }
    }

    if (responseData.path && !responseData.done) {
      const operationPath = responseData.path;
      const normalizedPath = operationPath.startsWith('assets/')
        ? operationPath
        : `assets/v1/${operationPath}`;
      const pollUrl = `https://apis.roblox.com/${normalizedPath}`;
      if (DEVELOPER_MODE)
        console.log(
          `[UPLOAD DEBUG] Operation pending, polling: ${pollUrl} (raw: ${operationPath})`,
        );
      const maxPollAttempts = 30;
      const pollIntervalMs = 1000;
      for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
        await waitForDelay(pollIntervalMs);
        await beforeNetwork();
        const pollResp = await fetchWithTimeout(
          pollUrl,
          {
            headers: { 'x-api-key': apiKey },
            signal: options.signal || null,
          },
          15000,
          `${assetType} upload poll`,
        );
        if (pollResp.status === 429 || pollResp.status >= 500) {
          const retryAfter = Math.min(parseInt(pollResp.headers.get('retry-after') || '3', 10), 30);
          if (DEVELOPER_MODE)
            console.log(
              `[UPLOAD DEBUG] Poll ${pollResp.status}, waiting ${retryAfter}s before continuing`,
            );
          await waitForDelay(retryAfter * 1000);
          continue;
        }
        const pollData = await readRobloxResponseBody(
          pollResp,
          10000,
          `${assetType} upload poll response`,
        );
        if (!pollResp.ok) {
          throw new Error(
            `Upload poll failed (${pollResp.status}). Response: ${JSON.stringify(pollData)}`,
          );
        }
        if (DEVELOPER_MODE)
          console.log(
            `[UPLOAD DEBUG] Poll attempt ${attempt}/${maxPollAttempts}: done=${pollData.done}`,
          );
        if (pollData.done) {
          if (pollData.error) {
            throw new Error(
              `Roblox rejected the upload: ${pollData.error.message || JSON.stringify(pollData.error)}`,
            );
          }
          if (pollData.response) {
            const assetId = pollData.response.assetId || pollData.response.Id;
            if (assetId) {
              sendTransferUpdate({
                id: transferId,
                progress: 100,
                status: 'completed',
                newAssetId: String(assetId),
              });
              return { success: true, assetId: String(assetId) };
            }
          }
        }
      }
      throw new Error(
        `Upload timed out waiting for Roblox to process the ${assetType.toLowerCase()}.`,
      );
    }

    throw new Error(`Unexpected response from Open Cloud API: ${JSON.stringify(responseData)}`);
  } catch (err) {
    if (
      (options.isCancelError && options.isCancelError(err)) ||
      (options.signal && options.signal.aborted && isAbortLikeError(err))
    ) {
      throw err;
    }
    const classified = classifyAssetError(err, { stage: 'upload' });
    const isRateLimit = classified.category === 'rate_limited';
    console.error(
      `[UPLOAD ERROR] ${assetType} upload failed${isRateLimit ? ' (RATE LIMIT)' : ''}: ${classified.raw}`,
    );
    sendTransferUpdate({
      id: transferId,
      status: 'error',
      error: classified.message,
      errorCategory: classified.category,
      progress: 0,
    });
    return {
      success: false,
      error: classified.message,
      rawError: classified.raw,
      errorCategory: classified.category,
      retryable: classified.retryable,
    };
  }
}

module.exports = {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
  setRateLimit,
  waitRateLimit,
  enterTransferSlot,
  leaveTransferSlot,
};
