'use strict';

const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
}

function isAbortLikeError(error) {
  return !!(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'));
}

function createAbortError(message = 'Operation canceled.') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function attachAbortSignal(controller, signal) {
  if (!signal) return () => {};
  const abort = () => {
    try {
      controller.abort();
    } catch {}
  };
  if (signal.aborted) {
    abort();
    return () => {};
  }
  signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

function toPositiveMs(value, fallback, minimum = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(minimum, fallback);
  return Math.max(minimum, parsed);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, label = 'request') {
  const controller = new AbortController();
  const detachAbortSignal = attachAbortSignal(controller, options.signal);
  const timeout = setTimeout(() => controller.abort(), toPositiveMs(timeoutMs, 15000));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (isAbortLikeError(err)) {
      if (options.signal && options.signal.aborted) throw createAbortError();
      throw new Error(`${label} timed out after ${toPositiveMs(timeoutMs, 15000)}ms`);
    }
    throw err;
  } finally {
    detachAbortSignal();
    clearTimeout(timeout);
  }
}

async function readJsonWithTimeout(response, timeoutMs = 10000, label = 'response') {
  let timeout;
  try {
    return await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(`${label} JSON read timed out after ${toPositiveMs(timeoutMs, 10000)}ms`),
            ),
          toPositiveMs(timeoutMs, 10000),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readTextWithTimeout(response, timeoutMs = 5000, label = 'response') {
  let timeout;
  try {
    return await Promise.race([
      response.text(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(`${label} text read timed out after ${toPositiveMs(timeoutMs, 5000)}ms`),
            ),
          toPositiveMs(timeoutMs, 5000),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readStreamChunkWithTimeout(reader, controller, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => {
            try {
              controller.abort();
            } catch {}
            reject(new Error(`${label} stalled for ${toPositiveMs(timeoutMs, 20000)}ms`));
          },
          toPositiveMs(timeoutMs, 20000),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('error', onError);
      stream.off('drain', onDrain);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };

    stream.once('error', onError);
    const canContinue = stream.write(chunk);
    if (canContinue) {
      cleanup();
      resolve();
    } else {
      stream.once('drain', onDrain);
    }
  });
}

async function finishWriteStream(stream) {
  await new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', (err) => reject(new Error(`File stream error: ${err.message}`)));
    stream.end();
  });
}

class DownloadHttpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DownloadHttpError';
    this.status = details.status;
    this.statusText = details.statusText;
    this.responseText = details.responseText;
  }
}

function makeTempFilePath(filePath, attempt = 1) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return path.join(dir, `${base}.part-${process.pid}-${Date.now()}-${attempt}${ext || '.tmp'}`);
}

async function downloadFileOnce(url, filePath, options = {}) {
  const requestTimeoutMs = toPositiveMs(options.requestTimeoutMs ?? options.timeoutMs, 15000);
  const bodyStallTimeoutMs = toPositiveMs(
    options.bodyStallTimeoutMs ?? options.bodyReadTimeoutMs,
    Math.max(requestTimeoutMs, 20000),
  );
  const overallTimeoutMs = toPositiveMs(
    options.overallTimeoutMs,
    Math.max(requestTimeoutMs * 4, 60000),
  );
  const label = options.label || 'Download';
  const tempFilePath = options.tempFilePath || makeTempFilePath(filePath, options.attempt || 1);
  const startedAt = Date.now();

  let controller = null;
  let reader = null;
  let fileStream = null;
  let detachAbortSignal = () => {};

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.unlink(tempFilePath).catch(() => {});

    controller = new AbortController();
    detachAbortSignal = attachAbortSignal(controller, options.signal);
    const responseTimer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        redirect: options.redirect || 'follow',
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortLikeError(err)) {
        if (options.signal && options.signal.aborted) throw createAbortError();
        throw new Error(`${label} request timed out after ${requestTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(responseTimer);
    }

    if (!response.ok) {
      let responseText = '';
      try {
        responseText = (await readTextWithTimeout(response, 5000, `${label} error response`)).slice(
          0,
          500,
        );
      } catch {}
      throw new DownloadHttpError(
        `${label} failed: ${response.status} ${response.statusText}${responseText ? ` | ${responseText}` : ''}`,
        { status: response.status, statusText: response.statusText, responseText },
      );
    }

    if (!response.body) throw new Error(`${label} response did not include a body.`);

    const totalSize = Number(response.headers.get('content-length'));
    const expectedSize = Number.isFinite(totalSize) && totalSize > 0 ? totalSize : 0;
    if (typeof options.onStart === 'function') options.onStart({ totalSize: expectedSize });

    reader = response.body.getReader();
    fileStream = fsSync.createWriteStream(tempFilePath, { flags: 'wx' });
    let receivedLength = 0;
    let lastProgress = -1;

    while (true) {
      if (Date.now() - startedAt > overallTimeoutMs) {
        try {
          controller.abort();
        } catch {}
        throw new Error(`${label} exceeded overall timeout of ${overallTimeoutMs}ms`);
      }

      const { done, value } = await readStreamChunkWithTimeout(
        reader,
        controller,
        bodyStallTimeoutMs,
        label,
      );
      if (done) break;

      await writeChunk(fileStream, value);
      receivedLength += value.length;

      if (typeof options.onProgress === 'function') {
        const progress =
          expectedSize > 0 ? Math.min(99, Math.round((receivedLength / expectedSize) * 100)) : null;
        if (progress === null || progress > lastProgress) {
          options.onProgress({ receivedLength, totalSize: expectedSize, progress });
          if (progress !== null) lastProgress = progress;
        }
      }
    }

    await finishWriteStream(fileStream);
    fileStream = null;

    if (expectedSize > 0 && receivedLength < expectedSize) {
      throw new Error(`${label} was incomplete (${receivedLength}/${expectedSize} bytes).`);
    }
    if (receivedLength <= 0 && options.allowEmpty !== true) {
      throw new Error(`${label} was empty.`);
    }

    await fs.rename(tempFilePath, filePath);
    if (typeof options.onProgress === 'function')
      options.onProgress({ receivedLength, totalSize: expectedSize, progress: 100 });
    return { success: true, filePath, bytesWritten: receivedLength, totalSize: expectedSize };
  } catch (error) {
    try {
      if (reader) await reader.cancel();
    } catch {}
    try {
      if (controller) controller.abort();
    } catch {}
    try {
      if (fileStream) fileStream.destroy();
    } catch {}
    await fs.unlink(tempFilePath).catch(() => {});
    if (options.deleteTargetOnFailure !== false) await fs.unlink(filePath).catch(() => {});
    if (options.signal && options.signal.aborted && isAbortLikeError(error)) {
      throw createAbortError();
    }
    throw error;
  } finally {
    detachAbortSignal();
  }
}

async function downloadFile(url, filePath, options = {}) {
  const retries = Math.max(
    0,
    Number.isFinite(Number(options.retries)) ? Number(options.retries) : 0,
  );
  const retryDelayMs = Math.max(
    0,
    Number.isFinite(Number(options.retryDelayMs)) ? Number(options.retryDelayMs) : 1000,
  );
  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await downloadFileOnce(url, filePath, { ...options, attempt });
    } catch (error) {
      lastError = error;
      const shouldRetry =
        typeof options.shouldRetry === 'function'
          ? options.shouldRetry(error, attempt)
          : attempt <= retries;
      if (!shouldRetry || attempt > retries) break;
      if (typeof options.onRetry === 'function')
        options.onRetry({ attempt, nextAttempt: attempt + 1, error });
      const nextDelayMs =
        typeof options.getRetryDelayMs === 'function'
          ? options.getRetryDelayMs(attempt, error)
          : retryDelayMs;
      if (typeof options.waitForRetry === 'function') await options.waitForRetry(nextDelayMs);
      else await delay(nextDelayMs);
    }
  }

  throw lastError || new Error('Download failed without an error.');
}

module.exports = {
  DownloadHttpError,
  createAbortError,
  delay,
  downloadFile,
  downloadFileOnce,
  fetchWithTimeout,
  finishWriteStream,
  isAbortLikeError,
  readJsonWithTimeout,
  readStreamChunkWithTimeout,
  readTextWithTimeout,
  writeChunk,
};
