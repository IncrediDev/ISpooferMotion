'use strict';

const { app, BrowserWindow, ipcMain, clipboard, dialog, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const updater = require('../core/updater');
const launcherDownloads = require('../core/downloads');
const launcherShortcuts = require('./shortcuts');
const { readJsonFile, writeJsonFile } = require('../core/config');

const LAUNCHER_ROOT = path.join(__dirname, '..', '..');
const POPUP_DIR = path.join(LAUNCHER_ROOT, 'src', 'popup');
const PRELOAD_SCRIPT = path.join(LAUNCHER_ROOT, 'src', 'preload', 'preload.js');
const ASSETS_DIR = path.join(LAUNCHER_ROOT, 'src', 'assets');

const RELEASE_SOURCES = {
  official: {
    id: 'official',
    label: 'Official',
    owner: 'IncrediDev',
    repo: 'ISpooferMotion',
    url: 'https://github.com/IncrediDev/ISpooferMotion',
  },
  fork: {
    id: 'fork',
    label: 'Testing / Fork',
    owner: 'codycon',
    repo: 'ISpooferMotion',
    url: 'https://github.com/codycon/ISpooferMotion',
  },
};
const DEFAULT_RELEASE_SOURCE_ID = updater.DEFAULT_RELEASE_SOURCE_ID;
const USER_AGENT = `ISpooferMotion-Electron-Launcher/${app.getVersion()} (+https://github.com/IncrediDev/ISpooferMotion)`;
const REQUEST_TIMEOUT_MS = 30000;
const DOWNLOAD_TIMEOUT_MS = 90000;
const POPUP_READY_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const LAUNCHER_VERSION = app.getVersion();
const LAUNCHER_VERSION_LABEL = LAUNCHER_VERSION.startsWith('v')
  ? LAUNCHER_VERSION
  : `v${LAUNCHER_VERSION}`;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 16, scheduling: 'lifo' });
const RELEASE_CACHE_MAX_AGE_MS = 2 * 60 * 1000;

// Keep launcher data under the ISpooferMotion folder.
app.setAppUserModelId('com.github.IncrediDev.ISpooferMotion.Launcher');
app.setName('ISpooferMotion');
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'ISpooferMotion'));
} catch {}

const IS_DEV = process.argv.includes('--dev');
if (IS_DEV) process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
let running = false;
let popupCounter = 0;
const popupWindows = new Map();
let paths = null;
let installStateCache = null;

function getPaths() {
  if (paths) return paths;
  const rootDir = path.join(app.getPath('userData'), 'managed-app');
  paths = {
    rootDir,
    versionsDir: path.join(rootDir, 'versions'),
    installersDir: path.join(rootDir, 'installers'),
    runDir: path.join(rootDir, 'run'),
    stateFile: path.join(rootDir, 'state.json'),
    logFile: path.join(rootDir, 'launcher.log'),
    releaseCacheFile: path.join(rootDir, 'release-cache.json'),
  };
  return paths;
}

function ensureDirs() {
  const p = getPaths();
  fs.mkdirSync(p.rootDir, { recursive: true });
  fs.mkdirSync(p.versionsDir, { recursive: true });
  fs.mkdirSync(p.installersDir, { recursive: true });
  fs.mkdirSync(p.runDir, { recursive: true });
  if (installStateCache === null) installStateCache = readJson(p.stateFile, {});
}

function getWindowIcon() {
  const png = path.join(ASSETS_DIR, 'app_icon.png');
  const ico = path.join(ASSETS_DIR, 'app_icon.ico');
  const preferred = process.platform === 'win32' ? ico : png;
  const image = nativeImage.createFromPath(preferred);
  return image.isEmpty() ? preferred : image;
}

async function showNativePopupFallback(options = {}, reason = '') {
  if (reason) writeLog(`Launcher popup fallback: ${reason}`);
  const buttons =
    options.buttons && options.buttons.length
      ? options.buttons
      : [{ id: 'ok', label: 'OK', kind: 'primary' }];
  const result = await dialog.showMessageBox({
    type: options.type === 'error' ? 'error' : options.type === 'warn' ? 'warning' : 'info',
    title: options.title || 'ISpooferLauncher',
    message: options.message || 'ISpooferMotion',
    detail: options.detail || '',
    buttons: buttons.map((button) => button.label || 'OK'),
    defaultId: Math.max(
      0,
      buttons.findIndex((button) => button.kind === 'primary'),
    ),
    cancelId: Math.max(
      0,
      buttons.findIndex((button) => button.id === 'ok'),
    ),
    noLink: true,
  });
  return (buttons[result.response] && buttons[result.response].id) || 'ok';
}

function normalizeReleaseSourceId(sourceId) {
  return updater.normalizeReleaseSourceId(sourceId, RELEASE_SOURCES, DEFAULT_RELEASE_SOURCE_ID);
}

function showLauncherPopup(options = {}) {
  return new Promise((resolve) => {
    const id = `popup-${Date.now()}-${++popupCounter}`;
    const type = options.type || 'info';
    const popupHtml = path.join(POPUP_DIR, 'popup.html');
    let settled = false;
    let readyTimer = null;
    const popup = new BrowserWindow({
      width: 560,
      height: type === 'error' ? 312 : 282,
      resizable: false,
      frame: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: options.title || 'ISpooferLauncher',
      icon: getWindowIcon(),
      backgroundColor: '#0b0b0b',
      webPreferences: {
        preload: PRELOAD_SCRIPT,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    function cleanup() {
      if (readyTimer) clearTimeout(readyTimer);
      ipcMain.off('launcher:popup-ready', handlePopupReady);
    }

    function finish(action) {
      if (settled) return;
      settled = true;
      cleanup();
      if (popupWindows.has(id)) {
        popupWindows.delete(id);
      }
      resolve(action || 'ok');
    }

    function fallback(reason) {
      if (settled) return;
      settled = true;
      cleanup();
      popupWindows.delete(id);
      try {
        if (!popup.isDestroyed()) popup.close();
      } catch {}
      showNativePopupFallback(options, reason)
        .then((action) => resolve(action))
        .catch(() => resolve('ok'));
    }

    function handlePopupReady(event, readyId) {
      if (readyId !== id || event.sender !== popup.webContents || settled) return;
      popup.webContents.send('popup:init', {
        id,
        type,
        title: options.title || 'ISpooferLauncher',
        message: options.message || 'ISpooferMotion',
        detail: options.detail || '',
        buttons: options.buttons || [{ id: 'ok', label: 'OK', kind: 'primary' }],
      });
      popup.show();
      popup.focus();
    }

    popupWindows.set(id, { window: popup, resolve: finish });
    ipcMain.on('launcher:popup-ready', handlePopupReady);
    popup.once('closed', () => finish('close'));
    popup.webContents.once('did-fail-load', (_event, code, description) => {
      fallback(`failed to load popup HTML (${code}): ${description}`);
    });
    popup.webContents.once('render-process-gone', (_event, details) => {
      fallback(`popup renderer stopped: ${details.reason || 'unknown'}`);
    });
    readyTimer = setTimeout(() => {
      fallback('popup renderer did not become ready');
    }, POPUP_READY_TIMEOUT_MS);
    popup.loadFile(popupHtml, { query: { id } }).catch((err) => {
      fallback(`failed to open popup HTML: ${err && err.message ? err.message : err}`);
    });
  });
}

async function showSilentError(err, options = {}) {
  const message = err && err.message ? err.message : String(err);
  const detail = [
    message,
    options.source
      ? `Source: ${options.source.label} (${options.source.owner}/${options.source.repo})`
      : '',
    '',
    'The launcher is running silently. Only warnings and errors are shown here.',
  ]
    .filter(Boolean)
    .join('\n');
  const buttons = [
    ...(options.canTryFork ? [{ id: 'try-fork', label: 'Try Fork', kind: 'primary' }] : []),
    { id: 'ok', label: 'OK', kind: 'primary' },
    { id: 'retry', label: 'Retry', kind: 'secondary' },
    { id: 'copy', label: 'Copy Error', kind: 'secondary' },
  ];

  const response = await showLauncherPopup({
    type: 'error',
    title: 'ISpooferLauncher',
    message: 'Update failed.',
    detail,
    buttons,
  });
  if (response === 'copy') clipboard.writeText(detail);
  return response;
}

function getReleaseSource(sourceId = DEFAULT_RELEASE_SOURCE_ID) {
  return updater.getReleaseSource(RELEASE_SOURCES, sourceId, DEFAULT_RELEASE_SOURCE_ID);
}

function getMissingPayloadMessage() {
  return `The selected release does not include the app payload yet. Use the fork source or wait for the official ${LAUNCHER_VERSION_LABEL} release.`;
}

function getVersionFromNameOrTag(value) {
  return updater.getVersionFromNameOrTag(value);
}

function getReleaseVersion(release) {
  return getVersionFromNameOrTag((release && (release.tag_name || release.name)) || '');
}

async function chooseForkReleaseIfNewer(officialRelease, options = {}) {
  if ((options.sourceId || DEFAULT_RELEASE_SOURCE_ID) !== 'official') return null;
  if (options.skipForkPrompt || options.forceRepair) return null;

  const officialVersion = getReleaseVersion(officialRelease);
  if (!officialVersion) return null;

  const forkSource = getReleaseSource('fork');
  let forkRelease;
  try {
    forkRelease = await requestLatestRelease(forkSource, {
      forceRefresh: Boolean(options.forceRefresh),
    });
  } catch (err) {
    writeLog(`Fork update check failed: ${err && err.message ? err.message : err}`);
    return null;
  }

  const forkVersion = getReleaseVersion(forkRelease);
  if (!forkVersion || updater.compareVersions(forkVersion, officialVersion) <= 0) return null;

  const forkAsset = updater.chooseWindowsAppAsset(forkRelease.assets);
  if (!forkAsset) {
    writeLog(`Fork ${forkVersion} is newer but has no managed app asset.`);
    return null;
  }

  const response = await showLauncherPopup({
    type: 'warn',
    title: 'ISpooferLauncher',
    message: 'Fork update available.',
    detail: `The fork has ${forkVersion}, while official is ${officialVersion}.\n\nContinue with official for the stable release, or use fork to install the newer test build.`,
    buttons: [
      { id: 'use-fork', label: 'Use Fork', kind: 'primary' },
      { id: 'continue-official', label: 'Continue Official', kind: 'secondary' },
    ],
  });

  if (response !== 'use-fork') return null;
  return { source: forkSource, release: forkRelease };
}

function getAssetSize(asset) {
  return Number(asset && asset.size) > 0 ? Number(asset.size) : 0;
}

function writeLog(message) {
  try {
    ensureDirs();
    fs.appendFileSync(getPaths().logFile, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function sendStatus(payload) {
  const normalized = {
    level: 'info',
    message: '',
    progress: null,
    detail: null,
    log: true,
    ...payload,
  };
  if (normalized.log !== false) {
    writeLog(
      `${normalized.level.toUpperCase()}: ${normalized.message}${normalized.detail ? ` | ${normalized.detail}` : ''}`,
    );
  }
}

function readJson(file, fallback) {
  return readJsonFile(file, fallback);
}

function writeJson(file, value) {
  return writeJsonFile(file, value);
}

function getInstallState() {
  if (installStateCache === null) installStateCache = readJson(getPaths().stateFile, {});
  return installStateCache;
}

function saveInstallState(nextState) {
  installStateCache = nextState || {};
  writeJson(getPaths().stateFile, installStateCache);
  return installStateCache;
}

function validateInstallState(state = getInstallState()) {
  const issues = [];
  if (!state || !state.exePath) {
    issues.push('App is not installed yet.');
  } else if (!isAllowedAppPath(state.exePath)) {
    issues.push('Managed app EXE is missing or invalid.');
  }

  if (state && state.pluginPath) {
    try {
      validatePluginFile(state.pluginPath, 0);
    } catch {
      issues.push('Roblox Studio plugin is missing or incomplete.');
    }
  }

  return { ok: issues.length === 0, issues };
}

function sanitizeFileName(name) {
  const cleaned = String(name || 'asset')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/^\.+$/, '_')
    .slice(0, 180);
  return cleaned || 'asset';
}

function toSafeUrl(url, baseUrl = null) {
  let parsed;
  try {
    parsed = baseUrl ? new URL(url, baseUrl) : new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`Refusing non-HTTPS URL: ${parsed.href}`);
  return parsed;
}

function ensureAllowedDownloadUrl(url, baseUrl = null) {
  const parsed = toSafeUrl(url, baseUrl);
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing download from unexpected host: ${parsed.hostname}`);
  }
  return parsed;
}

function formatBytes(bytes) {
  return !Number.isFinite(bytes) || bytes <= 0 ? '0 MB' : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusyError(err) {
  const code = String((err && err.code) || '').toUpperCase();
  const message = String((err && err.message) || '').toUpperCase();
  return (
    code === 'EBUSY' ||
    message.includes('EBUSY') ||
    message.includes('RESOURCE BUSY') ||
    message.includes('BEING USED BY ANOTHER PROCESS')
  );
}

async function copyFileWithRetry(source, destination, attempts = 12) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.copyFileSync(source, destination);
      return destination;
    } catch (err) {
      if (attempt === attempts || !isBusyError(err)) throw err;
      await delay(Math.min(250 * attempt, 2000));
    }
  }
  return destination;
}

async function removeWithRetry(target, options = { force: true }, attempts = 8) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (!fs.existsSync(target)) return;
      const stat = fs.lstatSync(target);
      const rmOptions = stat.isDirectory()
        ? { recursive: true, force: true, ...options }
        : { force: true };
      fs.rmSync(target, rmOptions);
      return;
    } catch (err) {
      if (attempt === attempts || !isBusyError(err)) throw err;
      await delay(Math.min(300 * attempt, 2500));
    }
  }
}

function getUniqueInstallDir(baseDir) {
  if (!fs.existsSync(baseDir)) return baseDir;
  return `${baseDir}-${Date.now()}`;
}

async function cleanupOldVersionDirs(activeExePath = null) {
  const p = getPaths();
  if (!fs.existsSync(p.versionsDir)) return;

  const activeDir = activeExePath ? path.resolve(path.dirname(activeExePath)) : null;
  const entries = fs.readdirSync(p.versionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(p.versionsDir, entry.name);
    const resolvedDir = path.resolve(dir);
    if (
      activeDir &&
      (resolvedDir === activeDir || activeDir.startsWith(`${resolvedDir}${path.sep}`))
    ) {
      continue;
    }

    try {
      await removeWithRetry(dir, { recursive: true, force: true }, 4);
    } catch (err) {
      // Old app versions can be locked if a previous ISpooferMotion window is still open.
      // Leave them in place and try again on the next launcher run instead of failing startup.
      sendStatus({
        level: 'warn',
        message: 'Skipped cleanup for a locked old app folder.',
        detail: dir,
        log: false,
      });
    }
  }
}

async function removeContentsWithRetry(dir) {
  if (!fs.existsSync(dir)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    await removeWithRetry(path.join(dir, entry), { recursive: true, force: true }).catch(() => {});
  }
}

async function cleanupDownloadArtifacts() {
  const p = getPaths();
  // Keep verified release payloads cached so the next launch/update can reuse them instantly.
  await removeContentsWithRetry(p.runDir);
  fs.mkdirSync(p.installersDir, { recursive: true });
  fs.mkdirSync(p.runDir, { recursive: true });

  let entries = [];
  try {
    entries = fs.readdirSync(p.installersDir, { withFileTypes: true });
  } catch {
    return;
  }
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(p.installersDir, entry.name);
      let stat = null;
      try {
        stat = fs.statSync(fullPath);
      } catch {}
      return stat ? { fullPath, mtimeMs: stat.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files.slice(8)) {
    await removeWithRetry(file.fullPath, { force: true }, 2).catch(() => {});
  }
}

function getLegacyUserDataDirs() {
  const appData = app.getPath('appData');
  return [path.join(appData, 'ispoofermotion-launcher'), path.join(appData, 'ispoofermotion')];
}

async function cleanupLegacyFolders() {
  for (const dir of getLegacyUserDataDirs()) {
    if (path.resolve(dir) !== path.resolve(app.getPath('userData'))) {
      await removeWithRetry(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function ensureLauncherDesktopShortcut() {
  return launcherShortcuts.ensureLauncherDesktopShortcut({ app, log: writeLog });
}

function removeRealAppDesktopShortcut() {
  return launcherShortcuts.removeRealAppDesktopShortcut({ app, log: writeLog });
}

function hashFile(file, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function assetSha256(asset) {
  const digest = asset && typeof asset.digest === 'string' ? asset.digest.trim() : '';
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

async function verifyFileSha256(file, expectedSha256, label) {
  if (!expectedSha256) {
    throw new Error(`${label} is missing a GitHub SHA-256 digest.`);
  }
  const actual = await hashFile(file, 'sha256');
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`${label} SHA-256 mismatch. Expected ${expectedSha256}, got ${actual}.`);
  }
  return actual;
}

function requestJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const parsed = toSafeUrl(url);
    const req = https.get(
      parsed,
      {
        agent: HTTPS_AGENT,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectCount >= MAX_REDIRECTS)
            return reject(new Error('GitHub request redirected too many times.'));
          try {
            return resolve(
              requestJson(toSafeUrl(res.headers.location, parsed.href).href, redirectCount + 1),
            );
          } catch (err) {
            return reject(err);
          }
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GitHub request failed: HTTP ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_JSON_BYTES && !settled) {
            settled = true;
            res.destroy(new Error('GitHub response was larger than expected.'));
          }
        });
        res.on('end', () => {
          if (settled) return;
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('GitHub request timed out.')));
    req.on('error', reject);
  });
}

async function requestLatestRelease(source, options = {}) {
  const cacheStore = updater.createReleaseCacheStore({
    readJson,
    writeJson,
    cacheFile: getPaths().releaseCacheFile,
    maxAgeMs: RELEASE_CACHE_MAX_AGE_MS,
    requestJson,
    getReleaseUrl: updater.getReleaseApiUrl,
    onCacheHit: (cachedRelease, cachedSource) =>
      sendStatus({
        level: 'success',
        message: 'Using recent update check.',
        detail: `${cachedSource.label} ${cachedRelease.tag_name || cachedRelease.name || 'latest'}`,
        log: false,
      }),
  });
  return cacheStore.requestLatestRelease(source, options);
}

async function downloadFile(
  url,
  destination,
  expectedSize = 0,
  redirectCount = 0,
  label = 'update',
) {
  let downloadStartLogged = false;
  let lastProgressSent = 0;
  let lastPercentSent = -1;
  const sendDownloadProgress = (downloaded, total, force = false) => {
    const now = Date.now();
    const pct = total ? Math.floor((downloaded / total) * 100) : -1;
    if (!force && pct === lastPercentSent && now - lastProgressSent < 750) return;
    lastPercentSent = pct;
    lastProgressSent = now;
    const shouldLog = !downloadStartLogged;
    if (shouldLog) downloadStartLogged = true;
    sendStatus({
      level: 'info',
      message: `Downloading ${label}...`,
      progress: { downloaded, total },
      log: shouldLog,
    });
  };

  const result = await launcherDownloads.downloadFile({
    url,
    destination,
    expectedSize,
    label,
    redirectCount,
    maxRedirects: MAX_REDIRECTS,
    maxBytes: MAX_DOWNLOAD_BYTES,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    bodyStallTimeoutMs: DOWNLOAD_TIMEOUT_MS,
    agent: HTTPS_AGENT,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity', Connection: 'keep-alive' },
    validateUrl: ensureAllowedDownloadUrl,
    formatBytes,
    onProgress: ({ downloaded, total, force }) => sendDownloadProgress(downloaded, total, force),
  });
  sendDownloadProgress(result.bytesWritten || 0, result.totalSize || expectedSize || 0, true);
  return destination;
}

function shouldSelfUpdateLauncher(release, launcherAsset, options = {}) {
  return updater.shouldSelfUpdateLauncher({
    release,
    launcherAsset,
    currentVersion: LAUNCHER_VERSION_LABEL,
    isDev: IS_DEV,
    isPackaged: app.isPackaged,
    platform: process.platform,
    forceRepair: Boolean(options.forceRepair),
  });
}

function expandZip(zipPath, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destination)} -Force`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
  } else {
    throw new Error('This launcher currently supports Windows release zips only.');
  }
}

function getRobloxPluginsDir() {
  if (process.platform !== 'win32') {
    throw new Error('Automatic Roblox Studio plugin install currently supports Windows only.');
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Roblox', 'Plugins');
}

function validatePluginFile(pluginPath, expectedSize = 0) {
  if (!pluginPath || !fs.existsSync(pluginPath)) {
    throw new Error('Roblox Studio plugin install failed because the plugin file was not created.');
  }
  const stat = fs.statSync(pluginPath);
  if (!stat.isFile())
    throw new Error('Roblox Studio plugin install failed because the plugin path is not a file.');
  if (stat.size < 1024)
    throw new Error(
      'Roblox Studio plugin install failed because the plugin file looks incomplete.',
    );
  if (expectedSize && stat.size !== expectedSize) {
    throw new Error(
      `Roblox Studio plugin size mismatch after install. Expected ${formatBytes(expectedSize)}, got ${formatBytes(stat.size)}.`,
    );
  }
  return stat;
}

async function isCachedReleaseAssetValid(filePath, asset, label) {
  if (!filePath || !asset || !fs.existsSync(filePath)) return false;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile() || stat.size <= 0) return false;
  const expectedSize = getAssetSize(asset);
  if (expectedSize && stat.size !== expectedSize) return false;
  const expectedSha256 = assetSha256(asset);
  if (!expectedSha256) return false;
  if (expectedSha256) {
    try {
      await verifyFileSha256(filePath, expectedSha256, `Cached ${label}`);
    } catch {
      return false;
    }
  }
  return true;
}

async function ensureReleaseAssetCached(asset, destination, label) {
  const expectedSize = getAssetSize(asset);
  const expectedSha256 = assetSha256(asset);
  if (await isCachedReleaseAssetValid(destination, asset, label)) {
    sendStatus({ level: 'success', message: `Using cached ${label}.` });
    return destination;
  }
  try {
    fs.rmSync(destination, { force: true });
  } catch {}
  await downloadFile(asset.browser_download_url, destination, expectedSize, 0, label);
  await verifyFileSha256(destination, expectedSha256, `Downloaded ${label}`);
  return destination;
}

async function installRobloxPluginRelease(release, asset) {
  if (!asset) {
    sendStatus({ level: 'warn', message: 'No .rbxmx plugin asset found on the latest release.' });
    return null;
  }

  const p = getPaths();
  const tag = release.tag_name || release.name || 'latest';
  const safeTag = sanitizeFileName(tag.replace(/[^a-z0-9_.-]/gi, '_'));
  const safeAssetName = sanitizeFileName(asset.name);
  const downloadPath = path.join(p.installersDir, `${safeTag}-${safeAssetName}`);
  const pluginDir = getRobloxPluginsDir();
  const pluginPath = path.join(pluginDir, safeAssetName);
  const expectedSize = Number(asset.size || 0);
  const expectedSha256 = assetSha256(asset);

  await ensureReleaseAssetCached(asset, downloadPath, 'Roblox Studio plugin');

  fs.mkdirSync(pluginDir, { recursive: true });

  // Keep only the latest ISpooferMotion plugin file.
  try {
    for (const name of fs.readdirSync(pluginDir)) {
      const full = path.join(pluginDir, name);
      if (full !== pluginPath && /ispoofermotion.*\.rbxmx$/i.test(name)) {
        fs.rmSync(full, { force: true });
      }
    }
  } catch {}

  fs.copyFileSync(downloadPath, pluginPath);
  validatePluginFile(pluginPath, expectedSize);

  const pluginVersion =
    getVersionFromNameOrTag(asset.name) ||
    getVersionFromNameOrTag(release.tag_name || release.name);
  sendStatus({
    level: 'success',
    message: 'Roblox Studio plugin installed.',
    detail: pluginVersion ? `${pluginVersion} installed.` : pluginPath,
  });
  return {
    pluginName: asset.name,
    pluginVersion,
    pluginDigest: asset.digest || null,
    pluginSha256: expectedSha256,
    pluginPath,
    pluginUpdatedAt: new Date().toISOString(),
  };
}

function scoreExe(file) {
  const name = path.basename(file).toLowerCase();
  let score = 0;
  if (name === 'ispoofermotion.exe') score += 100;
  if (name.includes('ispoofer')) score += 50;
  if (name.includes('motion')) score += 25;
  if (name.includes('uninstall')) score -= 100;
  if (name === 'update.exe' || name.includes('squirrel')) score -= 100;
  if (name.includes('setup') || name.includes('installer') || name.includes('launcher'))
    score -= 100;
  return score;
}

function findExe(startDir, maxDepth = 6) {
  if (!fs.existsSync(startDir)) return null;
  const stack = [{ dir: startDir, depth: 0 }];
  const candidates = [];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth && !/node_modules|resources\b|locales\b|cache|temp/i.test(full)) {
          stack.push({ dir: full, depth: depth + 1 });
        }
      } else if (/\.exe$/i.test(entry.name)) {
        const score = scoreExe(full);
        if (score > 0) candidates.push(full);
      }
    }
  }
  candidates.sort((a, b) => scoreExe(b) - scoreExe(a));
  return candidates[0] || null;
}

function isSubPath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === '' || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function isAllowedAppPath(exePath) {
  if (!exePath || !/\.exe$/i.test(exePath) || !fs.existsSync(exePath)) return false;
  if (scoreExe(exePath) <= 0) return false;
  return isSubPath(getPaths().versionsDir, exePath);
}

function launchExe(exePath) {
  if (!isAllowedAppPath(exePath))
    throw new Error(`Refusing to launch unverified app path: ${exePath}`);
  sendStatus({ level: 'success', message: 'Launching ISpooferMotion...' });
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exePath, [], {
        cwd: path.dirname(exePath),
        detached: !IS_DEV,
        stdio: IS_DEV ? ['ignore', 'pipe', 'pipe'] : 'ignore',
        env: { ...process.env, ISPOOFERMOTION_DEV: IS_DEV ? '1' : process.env.ISPOOFERMOTION_DEV },
      });
    } catch (err) {
      reject(err);
      return;
    }
    if (IS_DEV) {
      if (child.stdout)
        child.stdout.on('data', (chunk) => writeLog(`APP STDOUT: ${String(chunk).trimEnd()}`));
      if (child.stderr)
        child.stderr.on('data', (chunk) => writeLog(`APP STDERR: ${String(chunk).trimEnd()}`));
      child.on('exit', (code, signal) =>
        writeLog(`APP EXIT: code ${code}${signal ? ` (${signal})` : ''}.`),
      );
    }
    child.once('error', reject);
    child.once('spawn', () => {
      if (IS_DEV) writeLog(`APP SPAWNED: ${exePath}`);
      if (!IS_DEV) child.unref();
      resolve();
    });
  });
}

async function installRelease(release, asset, pluginInfo = null, source = getReleaseSource()) {
  const p = getPaths();
  const tag = release.tag_name || release.name || 'latest';
  const safeTag = sanitizeFileName(tag.replace(/[^a-z0-9_.-]/gi, '_'));
  const safeAssetName = sanitizeFileName(asset.name);
  const versionDir = path.join(p.versionsDir, safeTag);
  const downloadPath = path.join(p.installersDir, `${safeTag}-${safeAssetName}`);
  const expectedSize = Number(asset.size || 0);
  const expectedSha256 = assetSha256(asset);
  await ensureReleaseAssetCached(asset, downloadPath, 'app package');

  let exePath = null;
  let installedDir = null;
  if (/\.zip$/i.test(asset.name)) {
    sendStatus({ level: 'info', message: 'Installing app package...' });
    installedDir = getUniqueInstallDir(versionDir);
    expandZip(downloadPath, installedDir);
    exePath = findExe(installedDir);
    if (!exePath)
      throw new Error(
        'No ISpooferMotion app executable was found after extracting the release package.',
      );
  } else if (/\.exe$/i.test(asset.name)) {
    if (updater.isSetupOrInstallerAssetName(asset.name)) {
      throw new Error(
        'Setup installers cannot be used as managed app payloads. Upload the portable app EXE from the release workflow.',
      );
    }
    installedDir = getUniqueInstallDir(versionDir);
    fs.mkdirSync(installedDir, { recursive: true });
    exePath = path.join(installedDir, safeAssetName);
    await copyFileWithRetry(downloadPath, exePath);
  } else {
    throw new Error(`Unsupported app asset type: ${asset.name}`);
  }

  // Keep the downloaded package cache so repair/retry can reuse it quickly.

  if (!isAllowedAppPath(exePath))
    throw new Error(`Installed executable failed launcher validation: ${exePath}`);
  cleanupOldVersionDirs(exePath).catch(() => {});

  const nextState = {
    ...getInstallState(),
    tag,
    assetName: asset.name,
    assetDigest: asset.digest || null,
    assetSha256: expectedSha256,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceRepo: `${source.owner}/${source.repo}`,
    sourceUrl: source.url,
    exePath,
    updatedAt: new Date().toISOString(),
  };
  if (pluginInfo) Object.assign(nextState, pluginInfo);
  saveInstallState(nextState);
  return exePath;
}

async function prepareLauncherSelfUpdate(release, asset, source = getReleaseSource()) {
  const p = getPaths();
  const tag = release.tag_name || release.name || 'latest';
  const safeTag = sanitizeFileName(tag.replace(/[^a-z0-9_.-]/gi, '_'));
  const safeAssetName = sanitizeFileName(asset.name);
  const downloadPath = path.join(p.installersDir, `${safeTag}-${safeAssetName}`);
  const expectedSize = Number(asset.size || 0);
  const expectedSha256 = assetSha256(asset);
  await ensureReleaseAssetCached(asset, downloadPath, 'launcher installer');

  scheduleLauncherSelfUpdate(downloadPath, tag, asset.name, source);
  return { launcherUpdateTag: tag, launcherUpdateAssetName: asset.name };
}

function scheduleLauncherSelfUpdate(installerPath, tag, assetName, source) {
  if (process.platform !== 'win32') return false;
  if (!fs.existsSync(installerPath))
    throw new Error('Launcher self-update installer is missing after download.');

  const p = getPaths();
  fs.mkdirSync(p.runDir, { recursive: true });
  const scriptPath = path.join(p.runDir, 'launcher-self-update.ps1');
  const logPath = p.logFile;
  const currentPid = process.pid;
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$launcherPid = ${currentPid}
$installer = ${quotePs(installerPath)}
$logPath = ${quotePs(logPath)}
function Add-LauncherLog($Message) {
  try { Add-Content -LiteralPath $logPath -Value "[$((Get-Date).ToString('o'))] SELF-UPDATE: $Message" } catch {}
}
Add-LauncherLog 'Waiting for launcher process to exit.'
try { Wait-Process -Id $launcherPid -Timeout 120 } catch {}
Start-Sleep -Milliseconds 900
if (Test-Path -LiteralPath $installer) {
  Add-LauncherLog "Starting launcher installer: $installer"
  try {
    $process = Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -PassThru
    if ($process) { $process.WaitForExit() }
    Add-LauncherLog 'Launcher installer finished.'
  } catch {
    Add-LauncherLog "Launcher installer failed: $($_.Exception.Message)"
  }
} else {
  Add-LauncherLog 'Launcher installer was missing when self-update started.'
}
`;
  fs.writeFileSync(scriptPath, ps, 'utf8');

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  child.unref();

  const currentState = getInstallState();
  saveInstallState({
    ...currentState,
    launcherUpdateScheduled: true,
    launcherUpdateTag: tag,
    launcherUpdateAssetName: assetName,
    launcherUpdateSourceRepo: `${source.owner}/${source.repo}`,
    launcherUpdateScheduledAt: new Date().toISOString(),
  });
  sendStatus({
    level: 'success',
    message: 'Launcher update queued.',
    detail: 'It will install after the launcher closes.',
  });
  writeLog(`Launcher self-update queued for ${tag} using ${assetName}.`);
  return true;
}

async function runUpdateFlow(options = {}) {
  if (running) return { running: true };
  running = true;
  ensureDirs();
  let launchedEarly = false;
  try {
    cleanupLegacyFolders().catch(() => {});
    let source = getReleaseSource(options.sourceId || DEFAULT_RELEASE_SOURCE_ID);
    const state = getInstallState();
    if (
      options.fastLaunch !== false &&
      !options.forceRepair &&
      !options.forceRefresh &&
      isAllowedAppPath(state.exePath)
    ) {
      await launchExe(state.exePath);
      launchedEarly = true;
      sendStatus({ level: 'success', message: 'Started installed app. Checking updates...' });
    }
    sendStatus({
      level: 'info',
      message: 'Checking for updates...',
      detail: updater.getSourceDisplayName(source),
    });
    let release;
    try {
      release = await requestLatestRelease(source, {
        forceRefresh: Boolean(options.forceRepair || options.forceRefresh),
      });
    } catch (err) {
      sendStatus({ level: 'warn', message: `Update check failed: ${err.message}` });
      if (launchedEarly) return { ok: true, offline: true, launchedEarly: true };
      if (isAllowedAppPath(state.exePath)) {
        await launchExe(state.exePath);
        sendStatus({ level: 'success', message: 'Started previously installed app.' });
        if (!IS_DEV) setTimeout(() => app.quit(), 120);
        return { ok: true, offline: true };
      }
      throw err;
    }

    const forkChoice = await chooseForkReleaseIfNewer(release, {
      ...options,
      sourceId: source.id,
    });
    if (forkChoice) {
      source = forkChoice.source;
      release = forkChoice.release;
      sendStatus({
        level: 'info',
        message: 'Using fork release.',
        detail: `${source.label} ${release.tag_name || release.name || 'latest'}`,
      });
    }

    const latestTag = release.tag_name || release.name || 'latest';
    const asset = updater.chooseWindowsAppAsset(release.assets);
    const pluginAsset = updater.chooseRobloxPluginAsset(release.assets);
    const launcherAsset = updater.chooseWindowsLauncherAsset(release.assets);
    const launcherNeedsSelfUpdate = shouldSelfUpdateLauncher(release, launcherAsset, options);
    sendStatus({
      level: asset ? 'success' : 'warn',
      message: 'Release assets checked.',
      detail: `${source.label} ${latestTag} - app ${asset ? 'found' : 'missing'}, plugin ${pluginAsset ? 'found' : 'missing'}, launcher ${launcherAsset ? 'found' : 'missing'}`,
    });
    if (!asset) {
      throw new Error(getMissingPayloadMessage());
    }

    let pluginInfo = null;
    let launcherSelfUpdatePromise = null;
    if (launcherNeedsSelfUpdate) {
      sendStatus({
        level: 'info',
        message: 'Launcher update found.',
        detail: `${LAUNCHER_VERSION_LABEL} -> ${latestTag}`,
      });
      launcherSelfUpdatePromise = prepareLauncherSelfUpdate(release, launcherAsset, source).catch(
        (err) => {
          sendStatus({
            level: 'warn',
            message: 'Launcher self-update failed to queue.',
            detail: err.message,
          });
          return null;
        },
      );
    }

    const pluginNeedsInstall =
      pluginAsset &&
      (options.forceRepair ||
        state.tag !== latestTag ||
        state.pluginName !== pluginAsset.name ||
        !state.pluginPath ||
        !fs.existsSync(state.pluginPath));

    let pluginPromise = null;
    if (pluginNeedsInstall) {
      pluginPromise = installRobloxPluginRelease(release, pluginAsset);
    } else if (pluginAsset) {
      validatePluginFile(state.pluginPath, getAssetSize(pluginAsset));
      if (!state.pluginVersion) {
        saveInstallState({
          ...state,
          pluginVersion:
            getVersionFromNameOrTag(pluginAsset.name) || getVersionFromNameOrTag(latestTag),
        });
      }
      sendStatus({ level: 'success', message: 'Roblox Studio plugin is already installed.' });
    }

    let exePath = state.exePath;
    const appNeedsInstall =
      options.forceRepair ||
      state.sourceId !== source.id ||
      state.tag !== latestTag ||
      state.assetName !== asset.name ||
      !isAllowedAppPath(exePath);
    if (appNeedsInstall) {
      sendStatus({ level: 'info', message: 'Update found.', detail: latestTag });
      // Download/install the app while the Roblox plugin download/install runs too.
      const appPromise = installRelease(release, asset, null, source);
      if (pluginPromise) {
        [exePath, pluginInfo] = await Promise.all([appPromise, pluginPromise]);
      } else {
        exePath = await appPromise;
      }
    } else {
      sendStatus({ level: 'success', message: `Already up to date: ${latestTag}` });
      if (pluginPromise) pluginInfo = await pluginPromise;
    }

    if (launcherSelfUpdatePromise) await launcherSelfUpdatePromise;

    if (pluginInfo) saveInstallState({ ...getInstallState(), ...pluginInfo });

    const check = validateInstallState(getInstallState());
    if (!check.ok) {
      throw new Error(`Install finished but validation failed: ${check.issues.join(' ')}`);
    }

    cleanupDownloadArtifacts().catch(() => {});
    if (!launchedEarly) {
      await launchExe(exePath);
    }
    sendStatus({ level: 'success', message: 'Done.' });
    if (!IS_DEV) setTimeout(() => app.quit(), 120);
    return { ok: true, launchedEarly };
  } finally {
    running = false;
  }
}

function quotePs(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

ipcMain.on('launcher:popup-action', (event, id, action) => {
  const record = popupWindows.get(id);
  if (!record) return;
  popupWindows.delete(id);
  try {
    record.resolve(action || 'ok');
  } catch {}
  try {
    if (record.window && !record.window.isDestroyed()) record.window.close();
  } catch {}
});

async function runSilentLauncherFlow() {
  const officialSource = getReleaseSource('official');
  while (true) {
    try {
      await runUpdateFlow({ silent: true, sourceId: 'official' });
      return;
    } catch (err) {
      writeLog(`SILENT OFFICIAL ERROR: ${err && err.stack ? err.stack : err}`);
      const response = await showSilentError(err, { source: officialSource, canTryFork: true });
      if (response === 'retry') continue;
      if (response !== 'try-fork') throw err;
      break;
    }
  }

  const forkSource = getReleaseSource('fork');
  while (true) {
    try {
      writeLog('Trying fork release source after official update failed.');
      await runUpdateFlow({ silent: true, sourceId: 'fork', forceRefresh: true });
      return;
    } catch (err) {
      writeLog(`SILENT FORK ERROR: ${err && err.stack ? err.stack : err}`);
      const response = await showSilentError(err, { source: forkSource, canTryFork: false });
      if (response === 'retry') continue;
      throw err;
    }
  }
}

function showDevFakePopupPreview() {
  if (!IS_DEV) return Promise.resolve('skipped');

  const errorPopup = showLauncherPopup({
    type: 'error',
    title: 'fake popup preview',
    message: 'message goes here',
    detail: 'details go here',
    buttons: [
      { id: 'try-fork', label: 'Try Fork', kind: 'primary' },
      { id: 'ok', label: 'OK', kind: 'primary' },
      { id: 'retry', label: 'Retry', kind: 'secondary' },
      { id: 'copy', label: 'Copy Error', kind: 'secondary' },
    ],
  });

  const updaterPopup = showDevFakeUpdaterPreview();

  return Promise.all([errorPopup, updaterPopup]);
}

function showDevFakeUpdaterPreview() {
  if (!IS_DEV) return Promise.resolve('skipped');
  return new Promise((resolve) => {
    const id = `popup-${Date.now()}-${++popupCounter}`;
    const popup = new BrowserWindow({
      width: 560,
      height: 282,
      resizable: false,
      frame: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: 'ISpooferLauncher',
      icon: getWindowIcon(),
      backgroundColor: '#0b0b0b',
      webPreferences: {
        preload: PRELOAD_SCRIPT,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    popupWindows.set(id, { window: popup, resolve });
    popup.once('closed', () => {
      if (popupWindows.has(id)) {
        popupWindows.delete(id);
        resolve('close');
      }
    });
    popup.webContents.once('did-finish-load', () => {
      popup.webContents.send('popup:init', {
        id,
        type: 'updating',
        title: 'ISpooferLauncher',
        message: 'Checking for updates...',
        detail: '',
        buttons: [],
      });
      popup.show();
      popup.focus();

      // Simulate download progress after a short delay
      let downloaded = 0;
      const total = 64 * 1024 * 1024; // 64 MB fake size
      const interval = setInterval(() => {
        if (popup.isDestroyed()) {
          clearInterval(interval);
          return;
        }
        downloaded = Math.min(downloaded + total * 0.04, total);
        popup.webContents.send('popup:progress', {
          message: 'Downloading update...',
          downloaded,
          total,
        });
        if (downloaded >= total) {
          clearInterval(interval);
          popup.webContents.send('popup:autoclose', {
            message: 'Update complete!',
            delay: 1500,
          });
        }
      }, 300);
    });
    popup.loadFile(path.join(POPUP_DIR, 'popup.html'));
  });
}

app.whenReady().then(async () => {
  ensureDirs();
  writeLog(
    `Launcher ${LAUNCHER_VERSION_LABEL} starting. ${process.platform} ${process.arch}, Electron ${process.versions.electron}, Node ${process.versions.node}`,
  );
  if (IS_DEV)
    showDevFakePopupPreview().catch((err) =>
      writeLog(`Dev fake popup failed: ${err && err.message ? err.message : err}`),
    );
  setImmediate(() => {
    Promise.resolve()
      .then(() => ensureLauncherDesktopShortcut())
      .then(() => removeRealAppDesktopShortcut())
      .catch((err) =>
        writeLog(`Desktop shortcut maintenance failed: ${err && err.message ? err.message : err}`),
      );
  });
  try {
    await runSilentLauncherFlow();
  } catch (err) {
    writeLog(`Silent launcher stopped: ${err && err.message ? err.message : err}`);
  } finally {
    if (!IS_DEV) app.quit();
  }
});

app.on('window-all-closed', () => {
  if (!IS_DEV) app.quit();
});
