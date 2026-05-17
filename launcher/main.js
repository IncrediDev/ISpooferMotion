'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const OWNER = 'IncrediDev';
const REPO = 'ISpooferMotion';
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const USER_AGENT = 'ISpooferMotion-Electron-Launcher/1.2.16 (+https://github.com/IncrediDev/ISpooferMotion)';
const REQUEST_TIMEOUT_MS = 30000;
const DOWNLOAD_TIMEOUT_MS = 90000;
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);

// Keep launcher data under the ISpooferMotion folder.
app.setName('ISpooferMotion');
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'ISpooferMotion'));
} catch {}

let mainWindow = null;
let rendererAlive = false;
let running = false;
let paths = null;

function getPaths() {
  if (paths) return paths;
  const rootDir = path.join(app.getPath('userData'), 'managed-app');
  paths = {
    rootDir,
    versionsDir: path.join(rootDir, 'versions'),
    installersDir: path.join(rootDir, 'installers'),
    runDir: path.join(rootDir, 'run'),
    stateFile: path.join(rootDir, 'state.json'),
    logFile: path.join(rootDir, 'launcher.log')
  };
  return paths;
}

function ensureDirs() {
  const p = getPaths();
  fs.mkdirSync(p.rootDir, { recursive: true });
  fs.mkdirSync(p.versionsDir, { recursive: true });
  fs.mkdirSync(p.installersDir, { recursive: true });
  fs.mkdirSync(p.runDir, { recursive: true });
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
    ...payload
  };
  if (normalized.log !== false) {
    writeLog(`${normalized.level.toUpperCase()}: ${normalized.message}${normalized.detail ? ` | ${normalized.detail}` : ''}`);
  }

  // Renderer updates are optional during shutdown.
  if (!rendererAlive || !mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed()) return;
  if (wc.isLoadingMainFrame && wc.isLoadingMainFrame()) return;
  setImmediate(() => {
    try {
      if (!rendererAlive || !mainWindow || mainWindow.isDestroyed()) return;
      const activeWc = mainWindow.webContents;
      if (!activeWc || activeWc.isDestroyed()) return;
      activeWc.send('launcher:status', normalized);
    } catch {
      // Intentionally ignored. The launcher may be closing itself.
    }
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
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
  try { parsed = baseUrl ? new URL(url, baseUrl) : new URL(url); }
  catch { throw new Error(`Invalid URL: ${url}`); }
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
  return (!Number.isFinite(bytes) || bytes <= 0) ? '0 MB' : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isBusyError(err) {
  const code = String(err && err.code || '').toUpperCase();
  const message = String(err && err.message || '').toUpperCase();
  return code === 'EBUSY' || message.includes('EBUSY') || message.includes('RESOURCE BUSY') || message.includes('BEING USED BY ANOTHER PROCESS');
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
    if (activeDir && (resolvedDir === activeDir || activeDir.startsWith(`${resolvedDir}${path.sep}`))) {
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
        log: false
      });
    }
  }
}

async function removeContentsWithRetry(dir) {
  if (!fs.existsSync(dir)) return;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    await removeWithRetry(path.join(dir, entry), { recursive: true, force: true }).catch(() => {});
  }
}

async function cleanupDownloadArtifacts() {
  const p = getPaths();
  await removeContentsWithRetry(p.installersDir);
  await removeContentsWithRetry(p.runDir);
  fs.mkdirSync(p.installersDir, { recursive: true });
  fs.mkdirSync(p.runDir, { recursive: true });
}

function getLegacyUserDataDirs() {
  const appData = app.getPath('appData');
  return [
    path.join(appData, 'ispoofermotion-launcher'),
    path.join(appData, 'ispoofermotion')
  ];
}

async function cleanupLegacyFolders() {
  for (const dir of getLegacyUserDataDirs()) {
    if (path.resolve(dir) !== path.resolve(app.getPath('userData'))) {
      await removeWithRetry(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function getShortcutAndTempCleanupTargets() {
  const targets = [];
  const home = os.homedir();
  const appData = app.getPath('appData');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const desktop = path.join(home, 'Desktop');
  const startMenu = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const tempDir = os.tmpdir();

  targets.push(path.join(desktop, 'ISpooferMotion.lnk'));
  targets.push(path.join(startMenu, 'ISpooferMotion.lnk'));
  targets.push(path.join(startMenu, 'ISpooferMotion'));
  targets.push(path.join(localAppData, 'Programs', 'ISpooferMotion'));
  targets.push(path.join(localAppData, 'ISpooferMotion'));
  targets.push(path.join(localAppData, 'ispoofermotion'));

  try {
    for (const name of fs.readdirSync(tempDir)) {
      if (/ispoofermotion/i.test(name)) targets.push(path.join(tempDir, name));
    }
  } catch {}

  return [...new Set(targets)];
}

async function closeISpooferMotionProcesses() {
  if (process.platform !== 'win32') return;
  sendStatus({ level: 'warn', message: 'Closing running ISpooferMotion windows...' });
  const currentPid = process.pid;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$currentPid = ${currentPid}
$blocked = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$blocked.Add($currentPid)
$changed = $true
while ($changed) {
  $changed = $false
  Get-CimInstance Win32_Process | ForEach-Object {
    if ($blocked.Contains([int]$_.ParentProcessId) -and -not $blocked.Contains([int]$_.ProcessId)) {
      [void]$blocked.Add([int]$_.ProcessId)
      $changed = $true
    }
  }
}
Get-Process | Where-Object {
  -not $blocked.Contains([int]$_.Id) -and (
    $_.Name -like '*ISpooferMotion*' -or
    ($_.Path -and $_.Path -like '*ISpooferMotion*')
  ) -and -not ($_.Path -and $_.Path -like '*Roblox Studio*')
} | Stop-Process -Force
`;
  try {
    await spawnDetachedAndWait('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 12000 });
  } catch (err) {
    sendStatus({ level: 'warn', message: 'Some ISpooferMotion processes may still be running.', detail: err.message, log: false });
  }
  await delay(700);
}

async function removeAllISpooferMotionFiles() {
  const targets = [
    getPaths().rootDir,
    ...getLegacyUserDataDirs(),
    ...getStandardAppInstallDirs(),
    ...getShortcutAndTempCleanupTargets()
  ];

  for (const target of [...new Set(targets)]) {
    if (!target) continue;
    try {
      await removeWithRetry(target, { recursive: true, force: true }, 10);
    } catch (err) {
      sendStatus({
        level: 'warn',
        message: 'Could not remove a locked ISpooferMotion path.',
        detail: target,
        log: false
      });
    }
  }
}

async function execFileSyncWithBusyRetry(file, args, options, attempts = 8) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return execFileSync(file, args, options);
    } catch (err) {
      if (attempt === attempts || !isBusyError(err)) throw err;
      sendStatus({
        level: 'warn',
        message: `Installer is still locked by Windows. Retrying (${attempt}/${attempts - 1})...`,
        log: attempt === 1
      });
      await delay(Math.min(500 * attempt, 3000));
    }
  }
  return null;
}

function hashFile(file, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
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
  if (!expectedSha256) return null;
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
    const req = https.get(parsed, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github+json'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectCount >= MAX_REDIRECTS) return reject(new Error('GitHub request redirected too many times.'));
        try { return resolve(requestJson(toSafeUrl(res.headers.location, parsed.href).href, redirectCount + 1)); }
        catch (err) { return reject(err); }
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GitHub request failed: HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_JSON_BYTES && !settled) {
          settled = true;
          res.destroy(new Error('GitHub response was larger than expected.'));
        }
      });
      res.on('end', () => {
        if (settled) return;
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(err); }
      });
      res.on('error', reject);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('GitHub request timed out.')));
    req.on('error', reject);
  });
}

function downloadFile(url, destination, expectedSize = 0, redirectCount = 0, label = 'update') {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temp = `${destination}.download`;
    let file = fs.createWriteStream(temp);
    let settled = false;
    let lastProgressSent = 0;
    let lastPercentSent = -1;

    const fail = err => {
      if (settled) return;
      settled = true;
      try { file.close(); } catch {}
      try { fs.rmSync(temp, { force: true }); } catch {}
      reject(err);
    };
    const succeed = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let downloadStartLogged = false;
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
        log: shouldLog
      });
    };
    const get = currentUrl => {
      let parsed;
      try { parsed = ensureAllowedDownloadUrl(currentUrl); }
      catch (err) { fail(err); return; }
      const req = https.get(parsed, { headers: { 'User-Agent': USER_AGENT } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectCount >= MAX_REDIRECTS) return fail(new Error('Download redirected too many times.'));
          let nextUrl;
          try { nextUrl = ensureAllowedDownloadUrl(res.headers.location, parsed.href).href; }
          catch (err) { fail(err); return; }
          file.close(() => {
            try { fs.rmSync(temp, { force: true }); } catch {}
            file = fs.createWriteStream(temp);
            downloadFile(nextUrl, destination, expectedSize, redirectCount + 1, label).then(succeed, fail);
          });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers['content-length'] || 0);
        if (total > MAX_DOWNLOAD_BYTES) {
          res.resume();
          return fail(new Error(`Download is unexpectedly large: ${formatBytes(total)}`));
        }
        if (expectedSize && total && total !== expectedSize) {
          res.resume();
          return fail(new Error(`Download size mismatch. Expected ${formatBytes(expectedSize)}, server reported ${formatBytes(total)}.`));
        }
        let downloaded = 0;
        sendDownloadProgress(downloaded, total, true);
        res.on('data', chunk => {
          downloaded += chunk.length;
          sendDownloadProgress(downloaded, total, false);
          if (downloaded > MAX_DOWNLOAD_BYTES) res.destroy(new Error(`Download exceeded ${formatBytes(MAX_DOWNLOAD_BYTES)}.`));
          if (expectedSize && downloaded > expectedSize) res.destroy(new Error(`Download exceeded expected size ${formatBytes(expectedSize)}.`));
        });
        res.on('error', fail);
        file.on('error', fail);
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          if (expectedSize && downloaded !== expectedSize) {
            fail(new Error(`Download size mismatch. Expected ${formatBytes(expectedSize)}, got ${formatBytes(downloaded)}.`));
            return;
          }
          sendDownloadProgress(downloaded, total, true);
          fs.renameSync(temp, destination);
          succeed(destination);
        }));
      });
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('Download timed out.')));
      req.on('error', fail);
    };
    get(url);
  });
}


function isSetupOrInstallerAssetName(name) {
  const lower = String(name || '').toLowerCase();
  return /(^|[._\-\s])(setup|installer|install)([._\-\s]|$)/i.test(lower) || lower.includes('nsis');
}

function isLauncherAssetName(name) {
  const lower = String(name || '').toLowerCase();
  return lower.includes('launcher') || lower === 'ispoofermotion-setup.exe';
}

function chooseWindowsAppAsset(assets) {
  const usable = (assets || []).filter(asset => {
    if (!asset || !asset.browser_download_url || !asset.name) return false;
    const name = String(asset.name);
    if (/\.yml$|\.blockmap$|\.rbxmx$/i.test(name)) return false;
    if (/mac|darwin|linux/i.test(name)) return false;
    if (!/\.(exe|zip)$/i.test(name)) return false;
    if (isLauncherAssetName(name)) return false;
    return /win|windows|app|portable|setup|installer|install|ispoofer|motion/i.test(name);
  });

  const directAppCandidates = usable.filter(asset => !isSetupOrInstallerAssetName(asset.name));
  directAppCandidates.sort((a, b) => scoreReleaseAsset(b.name) - scoreReleaseAsset(a.name));
  if (directAppCandidates[0]) return directAppCandidates[0];

  // Non-launcher setup EXEs are accepted only as a fallback payload.
  const setupCandidates = usable.filter(asset => isSetupOrInstallerAssetName(asset.name));
  setupCandidates.sort((a, b) => scoreSetupPayloadAsset(b.name) - scoreSetupPayloadAsset(a.name));
  return setupCandidates[0] || null;
}

function chooseRejectedWindowsInstallerAsset(assets) {
  return (assets || []).find(asset => {
    if (!asset || !asset.browser_download_url || !asset.name) return false;
    const name = String(asset.name);
    return /\.(exe|zip)$/i.test(name) && isLauncherAssetName(name);
  }) || null;
}

function scoreReleaseAsset(name) {
  const lower = String(name || '').toLowerCase();
  let score = 0;
  if (/\.exe$/i.test(lower)) score += 80;
  if (/\.zip$/i.test(lower)) score += 60;
  if (lower.includes('portable')) score += 45;
  if (lower.includes('app')) score += 35;
  if (lower.includes('ispoofermotion')) score += 60;
  if (lower.includes('ispoofer')) score += 35;
  if (lower.includes('motion')) score += 20;
  if (lower.includes('win') || lower.includes('windows')) score += 10;
  if (isSetupOrInstallerAssetName(lower) || isLauncherAssetName(lower)) score -= 1000;
  return score;
}

function scoreSetupPayloadAsset(name) {
  const lower = String(name || '').toLowerCase();
  let score = 0;
  if (/\.exe$/i.test(lower)) score += 80;
  if (lower.includes('ispoofermotion')) score += 60;
  if (lower.includes('ispoofer')) score += 35;
  if (lower.includes('motion')) score += 20;
  if (lower.includes('setup')) score += 25;
  if (lower.includes('installer') || lower.includes('install')) score += 15;
  if (lower.includes('launcher')) score -= 1000;
  if (lower === 'ispoofermotion-setup.exe') score -= 1000;
  return score;
}


function chooseRobloxPluginAsset(assets) {
  const candidates = (assets || []).filter(asset => {
    if (!asset || !asset.browser_download_url || !asset.name) return false;
    return /\.rbxmx$/i.test(String(asset.name));
  });
  candidates.sort((a, b) => scorePluginAsset(b.name) - scorePluginAsset(a.name));
  return candidates[0] || null;
}

function scorePluginAsset(name) {
  const lower = String(name || '').toLowerCase();
  let score = 0;
  if (lower.includes('plugin')) score += 60;
  if (lower.includes('ispoofermotion')) score += 40;
  if (lower.includes('ispoofer')) score += 20;
  return score;
}

function expandZip(zipPath, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destination)} -Force`
    ], { stdio: 'ignore', windowsHide: true });
  } else {
    throw new Error('This launcher currently supports Windows release zips only.');
  }
}

function getStandardAppInstallDirs() {
  const candidates = [];
  const home = os.homedir();
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'ISpooferMotion'));
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'ISpooferMotion'));
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'ISpooferMotion'));
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'ISpooferMotion'));
  if (process.env['ProgramFiles(x86)']) candidates.push(path.join(process.env['ProgramFiles(x86)'], 'ISpooferMotion'));
  candidates.push(path.join(home, 'AppData', 'Local', 'Programs', 'ISpooferMotion'));
  return [...new Set(candidates)];
}

function findNewestExeInDirs(dirs) {
  const found = [];
  for (const dir of dirs) {
    const exe = findExe(dir);
    if (exe) {
      try { found.push({ exe, mtime: fs.statSync(exe).mtimeMs }); } catch { found.push({ exe, mtime: 0 }); }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found.length ? found[0].exe : null;
}

async function mirrorInstalledAppToManagedDir(sourceExe, destination) {
  const sourceDir = path.dirname(sourceExe);
  const installDir = getUniqueInstallDir(destination);
  fs.mkdirSync(installDir, { recursive: true });
  sendStatus({ level: 'info', message: 'Copying installed app into launcher storage...' });
  await copyDirectoryWithRetry(sourceDir, installDir);
  const exe = findExe(installDir);
  if (!exe) throw new Error('Installed app was copied, but no valid ISpooferMotion executable was found.');
  return { installDir, exePath: exe };
}

async function copyDirectoryWithRetry(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(source, entry.name);
    const dst = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryWithRetry(src, dst);
    } else if (entry.isFile()) {
      await copyFileWithRetry(src, dst);
    }
  }
}

async function spawnInstallerAndWait(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd: options.cwd || path.dirname(file),
        detached: false,
        stdio: 'ignore',
        windowsHide: true
      });
    } catch (err) {
      reject(err);
      return;
    }

    let settled = false;
    const timeoutMs = options.timeout || 180000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`Installer timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ code, signal });
      else reject(new Error(`Installer exited with code ${code}${signal ? ` (${signal})` : ''}.`));
    });
  });
}

async function spawnDetachedAndWait(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd: options.cwd || path.dirname(file),
        detached: false,
        stdio: 'ignore',
        windowsHide: true
      });
    } catch (err) {
      reject(err);
      return;
    }

    let settled = false;
    const timeoutMs = options.timeout || 30000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ code: null, timedOut: true });
    }, timeoutMs);

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, timedOut: false });
    });
  });
}

function spawnInstallerDetached(file, args, options = {}) {
  const child = spawn(file, args, {
    cwd: options.cwd || path.dirname(file),
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  return child;
}

async function waitForInstalledExe(dirs, timeoutMs = 90000) {
  const started = Date.now();
  let lastStatusAt = 0;
  while (Date.now() - started < timeoutMs) {
    const exe = findNewestExeInDirs(dirs);
    if (exe) return exe;
    const elapsed = Date.now() - started;
    if (elapsed - lastStatusAt > 5000) {
      lastStatusAt = elapsed;
      sendStatus({
        level: 'info',
        message: 'Waiting for installer to finish...',
        detail: `${Math.ceil((timeoutMs - elapsed) / 1000)}s remaining`,
        log: elapsed < 6000
      });
    }
    await delay(750);
  }
  return null;
}

async function runWindowsSetupSilently(setupPath, destination) {
  if (process.platform !== 'win32') {
    throw new Error('Windows setup EXE payloads are only supported on Windows.');
  }

  const p = getPaths();
  const runnerDir = path.join(p.runDir, 'installers');
  const runnerName = `${Date.now()}-${sanitizeFileName(path.basename(setupPath))}`;
  const runnerPath = path.join(runnerDir, runnerName);
  const installDir = getUniqueInstallDir(destination);

  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(runnerDir, { recursive: true });

  sendStatus({ level: 'info', message: 'Installing app package...' });

  try {
    // Run from a fresh path to avoid file locks from download scanning.
    await copyFileWithRetry(setupPath, runnerPath);
    await delay(350);

    try {
      await spawnInstallerAndWait(runnerPath, ['/S', `/D=${installDir}`], {
        cwd: path.dirname(runnerPath),
        timeout: 20000
      });
      return { installDir, exePath: null };
    } catch (firstErr) {
      await removeWithRetry(installDir, { recursive: true, force: true }).catch(() => {});
      sendStatus({
        level: 'error',
        message: 'This release asset is an installer that cannot be managed cleanly by the launcher.',
        detail: 'Upload the portable app EXE from the release workflow instead of the setup EXE for faster installs and updates.',
        log: true
      });
      throw new Error(`Managed install failed because the setup EXE rejected the launcher install folder. Upload a portable app EXE asset instead. Details: ${firstErr.message}`);
    }
  } catch (err) {
    await removeWithRetry(installDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Silent app installer failed: ${err.message}`);
  } finally {
    await removeWithRetry(runnerPath, { force: true }).catch(() => {});
  }
}

function getRobloxPluginsDir() {
  if (process.platform !== 'win32') {
    throw new Error('Automatic Roblox Studio plugin install currently supports Windows only.');
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Roblox', 'Plugins');
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

  let cacheLooksValid = fs.existsSync(downloadPath) && fs.statSync(downloadPath).size > 0;
  if (cacheLooksValid && expectedSize) cacheLooksValid = fs.statSync(downloadPath).size === expectedSize;
  if (cacheLooksValid && expectedSha256) {
    try { await verifyFileSha256(downloadPath, expectedSha256, 'Cached Roblox plugin'); }
    catch { cacheLooksValid = false; }
  }

  if (!cacheLooksValid) {
    try { fs.rmSync(downloadPath, { force: true }); } catch {}
    await downloadFile(asset.browser_download_url, downloadPath, expectedSize, 0, 'Roblox Studio plugin');
    await verifyFileSha256(downloadPath, expectedSha256, 'Downloaded Roblox plugin');
  }

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.copyFileSync(downloadPath, pluginPath);
  sendStatus({ level: 'success', message: 'Roblox Studio plugin installed.', detail: pluginPath });
  return {
    pluginName: asset.name,
    pluginDigest: asset.digest || null,
    pluginSha256: expectedSha256,
    pluginPath,
    pluginUpdatedAt: new Date().toISOString()
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
  if (name.includes('setup') || name.includes('installer') || name.includes('launcher')) score -= 100;
  return score;
}

function findExe(startDir, maxDepth = 6) {
  if (!fs.existsSync(startDir)) return null;
  const stack = [{ dir: startDir, depth: 0 }];
  const candidates = [];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
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
  return relative === '' || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAllowedAppPath(exePath) {
  if (!exePath || !/\.exe$/i.test(exePath) || !fs.existsSync(exePath)) return false;
  if (scoreExe(exePath) <= 0) return false;
  return isSubPath(getPaths().versionsDir, exePath);
}

function launchExe(exePath) {
  if (!isAllowedAppPath(exePath)) throw new Error(`Refusing to launch unverified app path: ${exePath}`);
  sendStatus({ level: 'success', message: 'Launching ISpooferMotion...' });
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: 'ignore' });
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function installRelease(release, asset, pluginInfo = null) {
  const p = getPaths();
  const tag = release.tag_name || release.name || 'latest';
  const safeTag = sanitizeFileName(tag.replace(/[^a-z0-9_.-]/gi, '_'));
  const safeAssetName = sanitizeFileName(asset.name);
  const versionDir = path.join(p.versionsDir, safeTag);
  const downloadPath = path.join(p.installersDir, `${safeTag}-${safeAssetName}`);
  const expectedSize = Number(asset.size || 0);
  const expectedSha256 = assetSha256(asset);
  let cacheLooksValid = fs.existsSync(downloadPath) && fs.statSync(downloadPath).size > 0;
  if (cacheLooksValid && expectedSize) cacheLooksValid = fs.statSync(downloadPath).size === expectedSize;
  if (cacheLooksValid && expectedSha256) {
    try { await verifyFileSha256(downloadPath, expectedSha256, 'Cached app asset'); }
    catch { cacheLooksValid = false; }
  }

  if (!cacheLooksValid) {
    try { fs.rmSync(downloadPath, { force: true }); } catch {}
    await downloadFile(asset.browser_download_url, downloadPath, expectedSize, 0, 'app');
    await verifyFileSha256(downloadPath, expectedSha256, 'Downloaded app asset');
  } else {
    sendStatus({ level: 'success', message: 'Using cached app package.' });
  }

  let exePath = null;
  let installedDir = null;
  if (/\.zip$/i.test(asset.name)) {
    sendStatus({ level: 'info', message: 'Installing app package...' });
    installedDir = getUniqueInstallDir(versionDir);
    expandZip(downloadPath, installedDir);
    exePath = findExe(installedDir);
    if (!exePath) throw new Error('No ISpooferMotion app executable was found after extracting the release package.');
  } else if (/\.exe$/i.test(asset.name)) {
    if (isSetupOrInstallerAssetName(asset.name)) {
      const setupResult = await runWindowsSetupSilently(downloadPath, versionDir);
      installedDir = setupResult.installDir || setupResult;
      exePath = setupResult.exePath || findExe(installedDir);
      if (!exePath) {
        throw new Error('No ISpooferMotion app executable was found after running the app setup package.');
      }
    } else {
      installedDir = getUniqueInstallDir(versionDir);
      fs.mkdirSync(installedDir, { recursive: true });
      exePath = path.join(installedDir, safeAssetName);
      await copyFileWithRetry(downloadPath, exePath);
    }
  } else {
    throw new Error(`Unsupported app asset type: ${asset.name}`);
  }

  await removeWithRetry(downloadPath, { force: true }).catch(() => {});

  if (!isAllowedAppPath(exePath)) throw new Error(`Installed executable did not pass launcher validation: ${exePath}`);
  await cleanupOldVersionDirs(exePath);

  const nextState = {
    ...readJson(p.stateFile, {}),
    tag,
    assetName: asset.name,
    assetDigest: asset.digest || null,
    assetSha256: expectedSha256,
    exePath,
    updatedAt: new Date().toISOString()
  };
  if (pluginInfo) Object.assign(nextState, pluginInfo);
  writeJson(p.stateFile, nextState);
  return exePath;
}

async function runUpdateFlow() {
  if (running) return { running: true };
  running = true;
  ensureDirs();
  try {
    await cleanupLegacyFolders();
    sendStatus({ level: 'info', message: 'Checking for updates...' });
    const state = readJson(getPaths().stateFile, {});
    let release;
    try {
      release = await requestJson(API_URL);
    } catch (err) {
      sendStatus({ level: 'warn', message: `Update check failed: ${err.message}` });
      if (isAllowedAppPath(state.exePath)) {
        await launchExe(state.exePath);
        sendStatus({ level: 'success', message: 'Started previously installed app.' });
        setTimeout(() => app.quit(), 600);
        return { ok: true, offline: true };
      }
      throw err;
    }

    const latestTag = release.tag_name || release.name || 'latest';
    const asset = chooseWindowsAppAsset(release.assets);
    const pluginAsset = chooseRobloxPluginAsset(release.assets);
    if (!asset) {
      const rejectedInstaller = chooseRejectedWindowsInstallerAsset(release.assets);
      const installerHint = rejectedInstaller
        ? ` Found ${rejectedInstaller.name}, but it looks like the launcher installer, not the managed app payload.`
        : '';
      throw new Error(`No managed Windows app .exe, setup .exe, or .zip was found on the latest official release.${installerHint} Upload the official Windows app EXE plus the .rbxmx plugin asset.`);
    }

    let pluginInfo = null;
    const pluginNeedsInstall = pluginAsset && (
      state.tag !== latestTag ||
      state.pluginName !== pluginAsset.name ||
      !state.pluginPath ||
      !fs.existsSync(state.pluginPath)
    );
    if (pluginNeedsInstall) {
      pluginInfo = await installRobloxPluginRelease(release, pluginAsset);
    } else if (pluginAsset) {
      sendStatus({ level: 'success', message: 'Roblox Studio plugin is already installed.' });
    }

    let exePath = state.exePath;
    if (state.tag !== latestTag || state.assetName !== asset.name || !isAllowedAppPath(exePath)) {
      sendStatus({ level: 'info', message: `Latest version: ${latestTag}` });
      exePath = await installRelease(release, asset, pluginInfo);
    } else {
      if (pluginInfo) writeJson(getPaths().stateFile, { ...state, ...pluginInfo });
      sendStatus({ level: 'success', message: `Already up to date: ${latestTag}` });
    }

    await cleanupDownloadArtifacts();
    await launchExe(exePath);
    sendStatus({ level: 'success', message: 'Done.' });
    setTimeout(() => app.quit(), 600);
    return { ok: true };
  } finally {
    running = false;
  }
}


function findLauncherUninstaller() {
  if (!app.isPackaged || process.platform !== 'win32') return null;
  const exeDir = path.dirname(app.getPath('exe'));
  const candidates = [
    path.join(exeDir, 'Uninstall ISpooferMotion.exe'),
    path.join(exeDir, 'Uninstall.exe')
  ];
  return candidates.find(file => fs.existsSync(file)) || null;
}

async function removeInstalledPlugins() {
  if (process.platform !== 'win32') return [];
  const removed = [];
  let pluginDir;
  try { pluginDir = getRobloxPluginsDir(); } catch { return removed; }
  const state = readJson(getPaths().stateFile, {});
  const candidates = new Set();
  if (state.pluginPath) candidates.add(state.pluginPath);
  try {
    for (const name of fs.readdirSync(pluginDir)) {
      if (/ispoofermotion.*\.rbxmx$/i.test(name) || /ispoofer.*plugin.*\.rbxmx$/i.test(name)) {
        candidates.add(path.join(pluginDir, name));
      }
    }
  } catch {}
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      await removeWithRetry(file, { force: true }).catch(() => {});
      if (!fs.existsSync(file)) removed.push(file);
    }
  }
  return removed;
}

function scheduleUserDataRemoval() {
}

async function uninstallEverything() {
  if (running) throw new Error('Wait for the current update/launch task to finish before uninstalling.');
  running = true;
  ensureDirs();

  let uninstaller = null;
  try { uninstaller = findLauncherUninstaller(); } catch {}

  try {
    sendStatus({ level: 'warn', message: 'Deep uninstalling ISpooferMotion...' });
    await closeISpooferMotionProcesses();

    const removedPlugins = await removeInstalledPlugins();
    await removeAllISpooferMotionFiles();

    if (uninstaller) {
      sendStatus({ level: 'warn', message: 'Starting launcher uninstaller...' });
      spawn(uninstaller, ['/S'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref();
    }

    sendStatus({
      level: 'success',
      message: 'Deep uninstall complete.',
      detail: removedPlugins.length ? `Removed ${removedPlugins.length} Roblox Studio plugin file(s).` : 'Removed app data, managed app files, shortcuts, and plugin files.'
    });

    setTimeout(() => app.quit(), 250);

    return { ok: true, removedPlugins, launcherUninstallerStarted: Boolean(uninstaller) };
  } finally {
    running = false;
  }
}

function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'app_icon.ico')
    : path.join(__dirname, 'assets', 'app_icon.png');

  mainWindow = new BrowserWindow({
    width: 760,
    height: 600,
    minWidth: 680,
    minHeight: 540,
    title: 'ISpooferMotion Launcher',
    icon: iconPath,
    frame: false,
    resizable: true,
    backgroundColor: '#2C2F33',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.webContents.on('did-finish-load', () => { rendererAlive = true; });
  mainWindow.webContents.on('render-process-gone', () => { rendererAlive = false; });
  mainWindow.webContents.on('destroyed', () => { rendererAlive = false; });
  mainWindow.on('closed', () => {
    rendererAlive = false;
    mainWindow = null;
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('launcher:start', () => runUpdateFlow());
ipcMain.handle('launcher:uninstall-all', () => uninstallEverything());
ipcMain.handle('launcher:get-state', () => {
  ensureDirs();
  const p = getPaths();
  return {
    running,
    rootDir: p.rootDir,
    logFile: p.logFile,
    state: readJson(p.stateFile, {})
  };
});
ipcMain.handle('launcher:open-log', async () => {
  ensureDirs();
  if (!fs.existsSync(getPaths().logFile)) fs.writeFileSync(getPaths().logFile, '', 'utf8');
  await shell.openPath(getPaths().logFile);
});
ipcMain.handle('launcher:open-data-folder', async () => {
  ensureDirs();
  await shell.openPath(getPaths().rootDir);
});
ipcMain.handle('launcher:quit', () => app.quit());

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', err => {
  writeLog(`UNCAUGHT: ${err && err.stack ? err.stack : err}`);
  sendStatus({ level: 'error', message: err && err.message ? err.message : String(err) });
});

process.on('unhandledRejection', err => {
  writeLog(`UNHANDLED: ${err && err.stack ? err.stack : err}`);
  sendStatus({ level: 'error', message: err && err.message ? err.message : String(err) });
});
