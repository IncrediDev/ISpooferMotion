'use strict';

// Launcher download helper. Same idea as the app download helper: temp file first, then rename only when the file is complete.

const fs = require('fs');
const path = require('path');
const https = require('https');

function defaultFormatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function createTempDownloadPath(destination) {
  const dir = path.dirname(destination);
  const ext = path.extname(destination) || '.tmp';
  const base = path.basename(destination, path.extname(destination));
  return path.join(
    dir,
    `${base}.part-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
}

function closeStream(stream) {
  return new Promise((resolve) => {
    if (!stream) return resolve();
    try {
      stream.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function downloadFile(options = {}) {
  const {
    url,
    destination,
    expectedSize = 0,
    redirectCount = 0,
    maxRedirects = 5,
    maxBytes = 1024 * 1024 * 1024,
    requestTimeoutMs = 30000,
    bodyStallTimeoutMs = 90000,
    agent = new https.Agent({ keepAlive: true }),
    headers = {},
    label = 'download',
    validateUrl = (value, baseUrl = null) => (baseUrl ? new URL(value, baseUrl) : new URL(value)),
    formatBytes = defaultFormatBytes,
    onProgress = null,
  } = options;

  if (!url) return Promise.reject(new Error('Download URL is missing.'));
  if (!destination) return Promise.reject(new Error('Download destination is missing.'));

  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const tempPath = createTempDownloadPath(destination);
    let settled = false;
    let request = null;
    let file = null;
    let stallTimer = null;
    let downloaded = 0;
    let total = 0;

    const cleanupStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
    };

    const resetStallTimer = (response) => {
      cleanupStallTimer();
      stallTimer = setTimeout(
        () => {
          const err = new Error(`${label} download stalled while reading the response body.`);
          try {
            if (response) response.destroy(err);
          } catch {}
          try {
            if (request) request.destroy(err);
          } catch {}
        },
        Math.max(1000, Number(bodyStallTimeoutMs) || 90000),
      );
    };

    const finishFailure = async (err) => {
      if (settled) return;
      settled = true;
      cleanupStallTimer();
      try {
        if (request) request.destroy();
      } catch {}
      try {
        if (file) file.destroy();
      } catch {}
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {}
      reject(err);
    };

    const finishSuccess = async () => {
      if (settled) return;
      settled = true;
      cleanupStallTimer();
      try {
        if (expectedSize && downloaded !== Number(expectedSize)) {
          throw new Error(
            `${label} size mismatch. Expected ${formatBytes(expectedSize)}, got ${formatBytes(downloaded)}.`,
          );
        }
        if (total && downloaded < total) {
          throw new Error(
            `${label} was incomplete. Expected ${formatBytes(total)}, got ${formatBytes(downloaded)}.`,
          );
        }
        if (downloaded <= 0) {
          throw new Error(`${label} download was empty.`);
        }
        fs.renameSync(tempPath, destination);
        resolve({
          filePath: destination,
          bytesWritten: downloaded,
          totalSize: total || Number(expectedSize) || 0,
        });
      } catch (err) {
        try {
          fs.rmSync(tempPath, { force: true });
        } catch {}
        reject(err);
      }
    };

    let parsed;
    try {
      parsed = validateUrl(url);
    } catch (err) {
      finishFailure(err);
      return;
    }

    file = fs.createWriteStream(tempPath, { highWaterMark: 16 * 1024 * 1024, flags: 'wx' });
    file.on('error', finishFailure);

    request = https.get(parsed, { agent, headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectCount >= maxRedirects) {
          finishFailure(new Error('Download redirected too many times.'));
          return;
        }
        let nextUrl;
        try {
          nextUrl = validateUrl(response.headers.location, parsed.href).href;
        } catch (err) {
          finishFailure(err);
          return;
        }
        closeStream(file).then(() => {
          try {
            fs.rmSync(tempPath, { force: true });
          } catch {}
          downloadFile({ ...options, url: nextUrl, redirectCount: redirectCount + 1 }).then(
            resolve,
            reject,
          );
        });
        settled = true;
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        finishFailure(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }

      total = Number(response.headers['content-length'] || 0);
      if (total > maxBytes) {
        response.resume();
        finishFailure(new Error(`Download is unexpectedly large: ${formatBytes(total)}.`));
        return;
      }
      if (expectedSize && total && total !== Number(expectedSize)) {
        response.resume();
        finishFailure(
          new Error(
            `Download size mismatch. Expected ${formatBytes(expectedSize)}, server reported ${formatBytes(total)}.`,
          ),
        );
        return;
      }

      if (typeof onProgress === 'function') onProgress({ downloaded, total, force: true });
      resetStallTimer(response);

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        resetStallTimer(response);
        if (downloaded > maxBytes) {
          response.destroy(new Error(`Download exceeded ${formatBytes(maxBytes)}.`));
          return;
        }
        if (expectedSize && downloaded > Number(expectedSize)) {
          response.destroy(
            new Error(`Download exceeded expected size ${formatBytes(expectedSize)}.`),
          );
          return;
        }
        if (typeof onProgress === 'function') onProgress({ downloaded, total, force: false });
      });
      response.on('error', finishFailure);
      response.pipe(file);
      file.on('finish', () => closeStream(file).then(finishSuccess, finishFailure));
    });

    request.setTimeout(Math.max(1000, Number(requestTimeoutMs) || 30000), () => {
      request.destroy(new Error(`${label} download request timed out.`));
    });
    request.on('error', finishFailure);
  });
}

module.exports = {
  downloadFile,
};
