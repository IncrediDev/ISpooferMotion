const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const DEVELOPER_MODE = process.argv.includes('--dev');
const KEEP_DOWNLOADS_ON_FAILURE = false; // Determines persistence policy for volatile download fragments upon transaction failures.
const LOG_TO_FILE = true; // Governs redirection of stdout and stderr pipelines to persistent disk logs.

let logFileStream = null;
let logsDirectory = null;
let currentLogFilePath = null;
function sanitizeLogMessage(message) {
  if (typeof message !== 'string') return message;

  let sanitized = message;
  sanitized = sanitized.replace(/"robloxCookie"\s*:\s*"[^"]*"/gi, '"robloxCookie":"{Cookie:Here}"');
  sanitized = sanitized.replace(/\.ROBLOSECURITY=[^;\s,}"]*/gi, '{Cookie:Here}');
  sanitized = sanitized.replace(/_\|WARNING:[^|]*\|_[^,}\s"]*/gi, '{Cookie:Here}');
  sanitized = sanitized.replace(/ROBLOSECURITY[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, '{Cookie:Here}$1');
  sanitized = sanitized.replace(
    /X-CSRF-TOKEN[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi,
    'X-CSRF-TOKEN:{Cookie:Here}$1',
  );
  sanitized = sanitized.replace(/"X-CSRF-TOKEN"\s*:\s*"[^"]*"/gi, '"X-CSRF-TOKEN":"{Cookie:Here}"');
  sanitized = sanitized.replace(/Bearer\s+[^\s,;},"]*([,}"\s]|$)/gi, 'Bearer {Cookie:Here}$1');
  sanitized = sanitized.replace(
    /Authorization[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi,
    'Authorization:{Cookie:Here}$1',
  );
  sanitized = sanitized.replace(
    /"Authorization"\s*:\s*"[^"]*"/gi,
    '"Authorization":"{Cookie:Here}"',
  );
  sanitized = sanitized.replace(/"x-api-key"\s*:\s*"[^"]*"/gi, '"x-api-key":"{ApiKey:Here}"');
  sanitized = sanitized.replace(
    /x-api-key[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi,
    'x-api-key:{ApiKey:Here}$1',
  );
  sanitized = sanitized.replace(
    /"openCloudApiKey"\s*:\s*"[^"]*"/gi,
    '"openCloudApiKey":"{ApiKey:Here}"',
  );
  sanitized = sanitized.replace(/"apiKey"\s*:\s*"[^"]*"/gi, '"apiKey":"{ApiKey:Here}"');
  sanitized = sanitized.replace(
    /(^|[\s,{])Cookie(?:=\s*|:\s+)[^};"]*([};"]\s*|$)/gi,
    '$1Cookie:{Cookie:Here}$2',
  );
  sanitized = sanitized.replace(/"Cookie"\s*:\s*"[^"]*"/gi, '"Cookie":"{Cookie:Here}"');
  sanitized = sanitized.replace(/"session"\s*:\s*"[^"]*"/gi, '"session":"{Cookie:Here}"');
  sanitized = sanitized.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"{Cookie:Here}"');
  sanitized = sanitized.replace(/"accessToken"\s*:\s*"[^"]*"/gi, '"accessToken":"{Cookie:Here}"');

  return sanitized;
}
function formatLogMessage(level, args) {
  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) => {
      if (typeof arg === 'object') {
        try {
          return sanitizeLogMessage(JSON.stringify(arg, null, 2));
        } catch {
          return String(arg);
        }
      }
      return sanitizeLogMessage(String(arg));
    })
    .join(' ');

  return `[${timestamp}] [${level}] ${message}`;
}

function sanitizeConsoleArg(arg) {
  if (typeof arg === 'string') return sanitizeLogMessage(arg);
  if (!arg || typeof arg !== 'object') return arg;

  try {
    return JSON.parse(sanitizeLogMessage(JSON.stringify(arg)));
  } catch {
    return sanitizeLogMessage(String(arg));
  }
}

function sanitizeConsoleArgs(args) {
  return args.map(sanitizeConsoleArg);
}
async function initializeFileLogging(logsDir) {
  if (!LOG_TO_FILE) return;

  try {
    logsDirectory = logsDir;
    fsSync.mkdirSync(logsDirectory, { recursive: true });

    const logFileName = `debug-${new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]}_${Date.now()}.txt`;
    const logFilePath = path.join(logsDirectory, logFileName);
    currentLogFilePath = logFilePath;
    fsSync.writeFileSync(
      logFilePath,
      formatLogMessage('LOG', ['Logging initialized', logFilePath]) + '\n',
      'utf8',
    );
    console.log(`[LOG FILE] Logging initialized: ${logFilePath}`);
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = function (...args) {
      const message = formatLogMessage('LOG', args);
      originalLog(...sanitizeConsoleArgs(args));
      if (LOG_TO_FILE) writeToLogFile(message, logFilePath);
    };

    console.error = function (...args) {
      const message = formatLogMessage('ERROR', args);
      originalError(...sanitizeConsoleArgs(args));
      if (LOG_TO_FILE) writeToLogFile(message, logFilePath);
    };

    console.warn = function (...args) {
      const message = formatLogMessage('WARN', args);
      originalWarn(...sanitizeConsoleArgs(args));
      if (LOG_TO_FILE) writeToLogFile(message, logFilePath);
    };

    return logFilePath;
  } catch (err) {
    console.error('Failed to initialize file logging:', err);
  }
}
async function writeToLogFile(message, logFilePath) {
  if (!LOG_TO_FILE || !logFilePath) return;

  try {
    fsSync.appendFileSync(logFilePath, message + '\n', 'utf8');
  } catch (err) {}
}
function getCurrentLogFilePath() {
  return currentLogFilePath;
}
async function readTextFileTail(filePath, maxBytes = 24000) {
  if (!filePath) return '';

  try {
    const stat = await fs.stat(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return sanitizeLogMessage(buffer.toString('utf8'));
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}
async function getLatestLogFilePath(logsDir) {
  try {
    const entries = await fs.readdir(logsDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.txt')) continue;
      const filePath = path.join(logsDir, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat) files.push({ filePath, mtimeMs: stat.mtimeMs });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0] ? files[0].filePath : null;
  } catch {
    return null;
  }
}
async function retryAsync(fn, retries = 3, delayMs = 1000, onRetryAttempt) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (onRetryAttempt) onRetryAttempt(i + 1, retries, err);
      if (i < retries - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
      else {
        const enrichedError = new Error(`After ${retries} attempts: ${err.message}`);
        enrichedError.cause = err;
        throw enrichedError;
      }
    }
  }
}
async function clearDownloadsDirectory(directoryPath, skipIfEnabled = KEEP_DOWNLOADS_ON_FAILURE) {
  if (skipIfEnabled) {
    if (DEVELOPER_MODE)
      console.log(`(Dev) Skipping directory clear: KEEP_DOWNLOADS_ON_FAILURE is enabled`);
    return true;
  }

  try {
    const directory = await fs.stat(directoryPath).catch(() => null);
    if (!directory) {
      if (DEVELOPER_MODE)
        console.log(`(Dev) Directory ${directoryPath} does not exist. No need to clear.`);
      return true;
    }

    if (!directory.isDirectory()) {
      console.error(`Error clearing directory ${directoryPath}: path is not a directory`);
      return false;
    }

    if (DEVELOPER_MODE) console.log(`(Dev) Clearing directory: ${directoryPath}`);
    const files = await fs.readdir(directoryPath);
    await Promise.all(
      files.map((file) => fs.rm(path.join(directoryPath, file), { recursive: true, force: true })),
    );
    if (DEVELOPER_MODE) console.log(`(Dev) Directory ${directoryPath} cleared successfully.`);
    return true;
  } catch (err) {
    console.error(`Error clearing directory ${directoryPath}:`, err);
    return false;
  }
}
function sanitizeFilename(filename) {
  const fallback = 'asset';
  const value = String(filename || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();

  const safeValue = value || fallback;
  const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  const normalized = reservedWindowsName.test(safeValue) ? `_${safeValue}` : safeValue;

  return normalized.slice(0, 180);
}
function normalizeRobloxCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return '';

  let normalized = cookieValue.trim();
  normalized = normalized.replace(/^['"]+|['"]+$/g, '');
  const prefixedMatch = normalized.match(/(?:^|;\s*)\.ROBLOSECURITY=([^;]+)/i);
  if (prefixedMatch && prefixedMatch[1]) {
    normalized = prefixedMatch[1].trim();
  }
  normalized = normalized.replace(/^\.ROBLOSECURITY=/i, '').trim();
  normalized = normalized.replace(/[;\r\n]+$/g, '').trim();

  return normalized;
}
function buildRobloxCookieHeader(cookieValue) {
  const normalized = normalizeRobloxCookie(cookieValue);
  return normalized ? `.ROBLOSECURITY=${normalized}` : '';
}

module.exports = {
  retryAsync,
  clearDownloadsDirectory,
  sanitizeFilename,
  normalizeRobloxCookie,
  buildRobloxCookieHeader,
  initializeFileLogging,
  sanitizeLogMessage,
  sanitizeConsoleArg,
  sanitizeConsoleArgs,
  getCurrentLogFilePath,
  getLatestLogFilePath,
  readTextFileTail,
  DEVELOPER_MODE,
  KEEP_DOWNLOADS_ON_FAILURE,
  LOG_TO_FILE,
};
