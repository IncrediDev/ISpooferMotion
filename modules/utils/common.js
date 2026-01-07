// modules/utils/common.js
const fs = require('fs').promises;
const path = require('path');

const DEVELOPER_MODE = true;
const KEEP_DOWNLOADS_ON_FAILURE = false; // Set to false to delete downloads
const LOG_TO_FILE = true; // Set to true to log all console output to a .txt file

let logFileStream = null;
let logsDirectory = null;

/**
 * Sanitizes log messages by removing sensitive information
 */
function sanitizeLogMessage(message) {
  if (typeof message !== 'string') return message;
  
  let sanitized = message;
  
  // Replace robloxCookie values in JSON
  sanitized = sanitized.replace(/"robloxCookie"\s*:\s*"[^"]*"/gi, '"robloxCookie":"{Cookie:Here}"');
  
  // Replace any ROBLOSECURITY cookies (various formats)
  sanitized = sanitized.replace(/\.ROBLOSECURITY=[^;\s,}"]*/gi, '{Cookie:Here}');
  sanitized = sanitized.replace(/_\|WARNING:[^|]*\|_[^,}\s"]*/gi, '{Cookie:Here}');
  sanitized = sanitized.replace(/ROBLOSECURITY[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, '{Cookie:Here}$1');
  
  // Replace X-CSRF-TOKEN values
  sanitized = sanitized.replace(/X-CSRF-TOKEN[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, 'X-CSRF-TOKEN:{Cookie:Here}$1');
  sanitized = sanitized.replace(/"X-CSRF-TOKEN"\s*:\s*"[^"]*"/gi, '"X-CSRF-TOKEN":"{Cookie:Here}"');
  
  // Replace Authorization/Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[^\s,;},"]*([,}"\s]|$)/gi, 'Bearer {Cookie:Here}$1');
  sanitized = sanitized.replace(/Authorization[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, 'Authorization:{Cookie:Here}$1');
  sanitized = sanitized.replace(/"Authorization"\s*:\s*"[^"]*"/gi, '"Authorization":"{Cookie:Here}"');
  
  // Replace any Cookie headers
  sanitized = sanitized.replace(/Cookie[=:]\s*[^};"]*([};"]\s*|$)/gi, 'Cookie:{Cookie:Here}$1');
  sanitized = sanitized.replace(/"Cookie"\s*:\s*"[^"]*"/gi, '"Cookie":"{Cookie:Here}"');
  
  // Replace any session/token properties in JSON objects
  sanitized = sanitized.replace(/"session"\s*:\s*"[^"]*"/gi, '"session":"{Cookie:Here}"');
  sanitized = sanitized.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"{Cookie:Here}"');
  sanitized = sanitized.replace(/"accessToken"\s*:\s*"[^"]*"/gi, '"accessToken":"{Cookie:Here}"');
  
  return sanitized;
}

/**
 * Formats log message with timestamp
 */
function formatLogMessage(level, args) {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return sanitizeLogMessage(JSON.stringify(arg, null, 2));
      } catch {
        return String(arg);
      }
    }
    return sanitizeLogMessage(String(arg));
  }).join(' ');
  
  return `[${timestamp}] [${level}] ${message}`;
}

/**
 * Initialize file logging
 */
async function initializeFileLogging(logsDir) {
  if (!LOG_TO_FILE) return;
  
  try {
    logsDirectory = logsDir;
    await fs.mkdir(logsDirectory, { recursive: true });
    
    const logFileName = `debug-${new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]}_${Date.now()}.txt`;
    const logFilePath = path.join(logsDirectory, logFileName);
    
    // We'll use a simple approach with fs.appendFile instead of a stream
    console.log(`[LOG FILE] Logging initialized: ${logFilePath}`);
    
    // Override console methods
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.log = function(...args) {
      const message = formatLogMessage('LOG', args);
      originalLog(...args);
      if (LOG_TO_FILE) writeToLogFile(message, logFilePath);
    };
    
    console.error = function(...args) {
      const message = formatLogMessage('ERROR', args);
      originalError(...args);
      if (LOG_TO_FILE) writeToLogFile(message, logFilePath);
    };
    
    console.warn = function(...args) {
      const message = formatLogMessage('WARN', args);
      originalWarn(...args);
      if (LOG_TO_FILE) writeToLogFile(message, logFilePath);
    };
    
    return logFilePath;
  } catch (err) {
    console.error('Failed to initialize file logging:', err);
  }
}

/**
 * Writes message to log file
 */
async function writeToLogFile(message, logFilePath) {
  if (!LOG_TO_FILE || !logFilePath) return;
  
  try {
    await fs.appendFile(logFilePath, message + '\n', 'utf8');
  } catch (err) {
    // Silently fail to avoid infinite loops
  }
}

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
async function clearDownloadsDirectory(directoryPath, skipIfEnabled = KEEP_DOWNLOADS_ON_FAILURE) {
  if (skipIfEnabled) {
    if (DEVELOPER_MODE) console.log(`(Dev) Skipping directory clear: KEEP_DOWNLOADS_ON_FAILURE is enabled`);
    return true;
  }
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
  initializeFileLogging,
  sanitizeLogMessage,
  DEVELOPER_MODE,
  KEEP_DOWNLOADS_ON_FAILURE,
  LOG_TO_FILE,
};
