// modules/utils/common.js
const fs = require('fs').promises;
const path = require('path');

const DEVELOPER_MODE = false;

/**
 * Retries an async function with configurable attempts and delay
 */
async function retryAsync(fn, retries = 3, delayMs = 1000, onRetryAttempt) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (onRetryAttempt) onRetryAttempt(i + 1, retries, err);
      if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
      else {
        const enrichedError = new Error(`After ${retries} attempts: ${err.message}`);
        enrichedError.cause = err;
        throw enrichedError;
      }
    }
  }
}

/**
 * Clears all files from a directory
 */
async function clearDownloadsDirectory(directoryPath) {
  try {
    if (await fs.stat(directoryPath).catch(() => null)) {
      if (DEVELOPER_MODE) console.log(`(Dev) Clearing directory: ${directoryPath}`);
      const files = await fs.readdir(directoryPath);
      for (const file of files) {
        await fs.unlink(path.join(directoryPath, file));
      }
      if (DEVELOPER_MODE) console.log(`(Dev) Directory ${directoryPath} cleared successfully.`);
      return true;
    } else {
      if (DEVELOPER_MODE) console.log(`(Dev) Directory ${directoryPath} does not exist. No need to clear.`);
      return true;
    }
  } catch (err) {
    console.error(`Error clearing directory ${directoryPath}:`, err);
    return false;
  }
}

/**
 * Sanitizes filename by removing invalid characters
 */
function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
}

module.exports = {
  retryAsync,
  clearDownloadsDirectory,
  sanitizeFilename,
  DEVELOPER_MODE,
};
