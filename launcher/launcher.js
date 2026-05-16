#!/usr/bin/env node
'use strict';

/*
  ISpooferMotion
  External launcher/updater for ISpooferMotion official releases.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, spawnSync, execFileSync } = require('child_process');

const OWNER = 'IncrediDev';
const REPO = 'ISpooferMotion';
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const USER_AGENT = 'ISM-Launcher/1.0 (+https://github.com/IncrediDev/ISpooferMotion)';

const ROOT_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ISpooferMotionLauncher');
const VERSIONS_DIR = path.join(ROOT_DIR, 'versions');
const INSTALLERS_DIR = path.join(ROOT_DIR, 'installers');
const RUN_DIR = path.join(ROOT_DIR, 'run');
const STATE_FILE = path.join(ROOT_DIR, 'state.json');
const LOG_FILE = path.join(ROOT_DIR, 'launcher.log');
const LOCK_FILE = path.join(ROOT_DIR, 'launcher.lock');
const LAUNCHER_EXE_FILE = path.join(ROOT_DIR, 'launcher.exe');
const APP_ICON_FILE = path.join(ROOT_DIR, 'app_icon.ico');
const EXIT_DELAY_MS = 3000;
const ERROR_WAIT_MS = 30000;
const REQUEST_TIMEOUT_MS = 30000;
const DOWNLOAD_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 5;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 180000;
const CONSOLE_COLUMNS = 60;
const CONSOLE_ROWS = 14;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);
const IS_PACKAGED = Boolean(process.pkg);
let lockHandle = null;
let titleKeeper = null;

function ensureDirs() {
  fs.mkdirSync(ROOT_DIR, { recursive: true });
  fs.mkdirSync(VERSIONS_DIR, { recursive: true });
  fs.mkdirSync(INSTALLERS_DIR, { recursive: true });
  fs.mkdirSync(RUN_DIR, { recursive: true });
}

function writeLog(message) {
  try {
    ensureDirs();
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

writeLog(`START packaged=${IS_PACKAGED} execPath=${process.execPath} cwd=${process.cwd()} argv=${process.argv.join(' ')}`);

function setConsoleTitle(useCmd = false) {
  process.title = 'ISpooferMotion';
  try { process.stdout.write('\x1b]0;ISpooferMotion\x07'); } catch {}
  if (useCmd && process.platform === 'win32') {
    try { execFileSync('cmd.exe', ['/d', '/s', '/c', 'title ISpooferMotion'], { stdio: 'ignore', windowsHide: true }); } catch {}
  }
}

function startTitleKeeper() {
  if (titleKeeper || process.platform !== 'win32') return;
  // Some Windows console helpers restore their own title when they exit. This
  // is intentionally simple: keep nudging it back while the launcher is alive.
  titleKeeper = setInterval(() => setConsoleTitle(true), 750);
  if (typeof titleKeeper.unref === 'function') titleKeeper.unref();
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function acquireInstanceLock() {
  ensureDirs();
  try {
    lockHandle = fs.openSync(LOCK_FILE, 'wx');
    fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return true;
  } catch (err) {
    if (err && err.code !== 'EEXIST') throw err;
  }

  const lock = readJson(LOCK_FILE, {});
  const pid = Number(lock.pid);
  const ageMs = lock.startedAt ? Date.now() - Date.parse(lock.startedAt) : Number.POSITIVE_INFINITY;
  if (isProcessRunning(pid) && ageMs < 30 * 60 * 1000) return false;

  try { fs.rmSync(LOCK_FILE, { force: true }); } catch {}
  lockHandle = fs.openSync(LOCK_FILE, 'wx');
  fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return true;
}

function releaseInstanceLock() {
  if (lockHandle === null) return;
  try { fs.closeSync(lockHandle); } catch {}
  lockHandle = null;
  try { fs.rmSync(LOCK_FILE, { force: true }); } catch {}
}

process.on('exit', releaseInstanceLock);

process.on('uncaughtException', err => {
  writeLog(`UNCAUGHT: ${err && err.stack ? err.stack : err}`);
  try { console.error(`x ERROR: ${err && err.message ? err.message : err}`); } catch {}
});

process.on('unhandledRejection', err => {
  writeLog(`UNHANDLED: ${err && err.stack ? err.stack : err}`);
  try { console.error(`x ERROR: ${err && err.message ? err.message : err}`); } catch {}
});

function configureConsoleWindow() {
  setConsoleTitle(true);
  startTitleKeeper();
  if (process.platform !== 'win32') return;

  // Console sizing on Windows is annoyingly host-dependent. The shortcut gets
  // the real layout data too; these runtime calls are just extra chances.
  try { process.stdout.write(`\x1b[8;${CONSOLE_ROWS};${CONSOLE_COLUMNS}t`); } catch {}

  try {
    execFileSync('cmd.exe', ['/d', '/s', '/c', `title ISpooferMotion & mode con: cols=${CONSOLE_COLUMNS} lines=${CONSOLE_ROWS} >nul 2>nul`], { stdio: 'ignore', windowsHide: true });
  } catch (err) {
    writeLog(`Console resize through mode failed: ${errorOutput(err)}`);
  }

  // The title keeper handles child processes that try to be the main character.
  setConsoleTitle(true);
  for (const delayMs of [250, 1000, 2000, 4000]) {
    const timer = setTimeout(() => setConsoleTitle(true), delayMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  writeLog(`Console requested ${CONSOLE_COLUMNS}x${CONSOLE_ROWS}; stdio reports ${process.stdout.columns || 'unknown'}x${process.stdout.rows || 'unknown'}`);
}

configureConsoleWindow();

const USE_COLOR = process.stdout && process.stdout.isTTY;
const COLORS = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };
function color(text, name) { return USE_COLOR ? `${COLORS[name] || ''}${text}${COLORS.reset}` : text; }
function step(message, type = 'info') {
  const icons = { info: '*', ok: '+', warn: '!', error: 'x', launch: '-' };
  const colors = { info: 'cyan', ok: 'green', warn: 'yellow', error: 'red', launch: 'green' };
  console.log(`${color(icons[type] || '*', colors[type] || 'cyan')} ${message}`);
  writeLog(message);
}
function status(message) { console.log(`${color('-', 'cyan')} ${message}`); writeLog(message); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function closeAfterSuccess() {
  console.log(color('Closing in 3 seconds...', 'dim'));
  await sleep(EXIT_DELAY_MS);
}

async function waitOnError() {
  console.log('');
  console.log(color(`Log saved to: ${LOG_FILE}`, 'yellow'));
  console.log(color('Press Enter to close, or it will close in 30 seconds...', 'dim'));
  await new Promise(resolve => {
    const timer = setTimeout(resolve, ERROR_WAIT_MS);
    try {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', () => { clearTimeout(timer); rl.close(); resolve(); });
    } catch { resolve(); }
  });
}

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
function samePath(a, b) { return path.resolve(a || '').toLowerCase() === path.resolve(b || '').toLowerCase(); }
function hashFileSync(file, algorithm = 'sha256') { return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex'); }

function hidePath(file) {
  if (process.platform !== 'win32' || !file || !fs.existsSync(file)) return;
  try { execFileSync('attrib.exe', ['+h', file], { stdio: 'ignore' }); } catch {}
}

function unhidePath(file) {
  if (process.platform !== 'win32' || !file || !fs.existsSync(file)) return;
  try { execFileSync('attrib.exe', ['-h', '-r', file], { stdio: 'ignore' }); } catch {}
}

function copyIfChanged(source, destination) {
  if (!source || !fs.existsSync(source)) return false;
  try {
    unhidePath(destination);
    if (fs.existsSync(destination)) {
      const src = fs.statSync(source);
      const dest = fs.statSync(destination);
      if (src.size === dest.size && hashFileSync(source) === hashFileSync(destination)) return false;
    }
    fs.copyFileSync(source, destination);
    return true;
  } catch (err) {
    writeLog(`Copy failed ${source} -> ${destination}: ${err.message}`);
    return false;
  }
}

function findBundledIcon() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'app_icon.ico'),
    path.join(process.cwd(), 'app_icon.ico'),
    path.resolve(__dirname, '..', 'assets', 'app_icon.ico')
  ];
  return candidates.find(file => {
    try { return fs.existsSync(file); } catch { return false; }
  }) || null;
}

function installLauncherAssets() {
  ensureDirs();

  // The public build output is just the seed. The copy in AppData is the one
  // the desktop shortcut should keep pointing at.
  if (IS_PACKAGED && !samePath(process.execPath, LAUNCHER_EXE_FILE)) {
    if (copyIfChanged(process.execPath, LAUNCHER_EXE_FILE)) {
      writeLog(`Installed launcher copy: ${LAUNCHER_EXE_FILE}`);
    }
  }

  const iconSource = findBundledIcon();
  if (iconSource && copyIfChanged(iconSource, APP_ICON_FILE)) {
    writeLog(`Installed launcher icon: ${APP_ICON_FILE}`);
  }

  hidePath(LAUNCHER_EXE_FILE);
  hidePath(APP_ICON_FILE);
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
    throw new Error(`Refusing download redirect to unexpected host: ${parsed.hostname}`);
  }
  return parsed;
}

function sanitizeFileName(name) {
  const cleaned = String(name || 'asset')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/^\.+$/, '_')
    .slice(0, 180);
  return cleaned || 'asset';
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
  writeLog(`${label} SHA-256 verified: ${actual}`);
  return actual;
}

async function makeRunnableInstallerCopy(sourcePath, expectedSha256) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const safeName = sanitizeFileName(path.basename(sourcePath));
  const runPath = path.join(RUN_DIR, `${Date.now()}-${process.pid}-${safeName}`);
  // Windows was happiest when the cached installer stayed untouched and each
  // run got its own verified copy to execute.
  fs.copyFileSync(sourcePath, runPath);
  await verifyFileSha256(runPath, expectedSha256, 'Runnable installer copy');
  writeLog(`Runnable installer copy: ${runPath}`);
  return runPath;
}

function cleanupRunDir() {
  try {
    if (!fs.existsSync(RUN_DIR)) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(RUN_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(RUN_DIR, entry.name);
      try {
        const stat = fs.statSync(file);
        if (stat.mtimeMs < cutoff) fs.rmSync(file, { force: true });
      } catch {}
    }
  } catch (err) {
    writeLog(`Run directory cleanup failed: ${err.message}`);
  }
}

function requestJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const parsed = toSafeUrl(url);
    const req = https.get(parsed, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.github+json' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectCount >= MAX_REDIRECTS) return reject(new Error('GitHub request redirected too many times.'));
        try { return resolve(requestJson(toSafeUrl(res.headers.location, parsed.href).href, redirectCount + 1)); } catch (err) { return reject(err); }
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`GitHub request failed: HTTP ${res.statusCode}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_JSON_BYTES && !settled) {
          settled = true;
          res.destroy(new Error('GitHub response was larger than expected.'));
        }
      });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (err) { reject(err); } });
      res.on('error', reject);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('GitHub request timed out.')));
    req.on('error', reject);
  });
}

function formatBytes(bytes) { return (!Number.isFinite(bytes) || bytes <= 0) ? '0 MB' : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function drawProgress(downloaded, total) {
  const width = 26;
  if (!total) { process.stdout.write(`\r${color('*', 'cyan')} Downloading... ${formatBytes(downloaded)}        `); return; }
  const ratio = Math.max(0, Math.min(1, downloaded / total));
  const filled = Math.round(ratio * width);
  const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
  const percent = Math.round(ratio * 100).toString().padStart(3, ' ');
  process.stdout.write(`\r${color('*', 'cyan')} [${bar}] ${percent}% ${formatBytes(downloaded)}/${formatBytes(total)}   `);
}

function downloadFile(url, destination, expectedSize = 0, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temp = `${destination}.download`;
    let file = fs.createWriteStream(temp);
    let settled = false;
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
    const get = currentUrl => {
      let parsed;
      try { parsed = ensureAllowedDownloadUrl(currentUrl); } catch (err) { fail(err); return; }
      const req = https.get(parsed, { headers: { 'User-Agent': USER_AGENT } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectCount >= MAX_REDIRECTS) return fail(new Error('Download redirected too many times.'));
          let nextUrl;
          try { nextUrl = ensureAllowedDownloadUrl(res.headers.location, parsed.href).href; } catch (err) { fail(err); return; }
          file.close(() => { try { fs.rmSync(temp, { force: true }); } catch {}; file = fs.createWriteStream(temp); downloadFile(nextUrl, destination, expectedSize, redirectCount + 1).then(succeed, fail); });
          return;
        }
        if (res.statusCode !== 200) { res.resume(); return fail(new Error(`Download failed: HTTP ${res.statusCode}`)); }
        const total = Number(res.headers['content-length'] || 0);
        if (total > MAX_DOWNLOAD_BYTES) { res.resume(); return fail(new Error(`Download is unexpectedly large: ${formatBytes(total)}`)); }
        if (expectedSize && total && total !== expectedSize) { res.resume(); return fail(new Error(`Download size mismatch. Expected ${formatBytes(expectedSize)}, server reported ${formatBytes(total)}.`)); }
        let downloaded = 0;
        drawProgress(downloaded, total);
        res.on('data', chunk => { downloaded += chunk.length; drawProgress(downloaded, total); });
        res.on('data', () => {
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
          process.stdout.write('\n');
          fs.renameSync(temp, destination);
          writeLog(`Downloaded ${path.basename(destination)} (${formatBytes(downloaded)})`);
          succeed(destination);
        }));
      });
      req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('Download timed out.')));
      req.on('error', fail);
    };
    get(url);
  });
}

function chooseWindowsAsset(assets) {
  const usable = (assets || []).filter(a => a && a.browser_download_url && a.name && !/\.yml$|\.blockmap$/i.test(a.name));
  return (
    usable.find(a => /win|windows/i.test(a.name) && /\.zip$/i.test(a.name)) ||
    usable.find(a => /portable/i.test(a.name) && /\.exe$/i.test(a.name)) ||
    usable.find(a => /setup|installer/i.test(a.name) && /\.exe$/i.test(a.name)) ||
    usable.find(a => /\.zip$/i.test(a.name) && !/mac|darwin|linux/i.test(a.name)) ||
    usable.find(a => /\.exe$/i.test(a.name) && !/mac|darwin|linux/i.test(a.name)) ||
    null
  );
}

function expandZip(zipPath, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destination)} -Force`], { stdio: 'ignore', windowsHide: true });
  setConsoleTitle(true);
}

function scoreExe(file) {
  const name = path.basename(file).toLowerCase();
  let score = 0;
  if (name === 'ispoofermotion.exe') score += 100;
  if (name.includes('ispoofer')) score += 50;
  if (name.includes('motion')) score += 25;
  if (name.includes('uninstall')) score -= 100;
  if (name === 'update.exe' || name.includes('squirrel')) score -= 100;
  if (name.includes('setup') || name.includes('installer')) score -= 50;
  return score;
}

function findExe(startDir, maxDepth = 5) {
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
        if (depth < maxDepth && !/node_modules|resources\b|locales\b|cache|temp/i.test(full)) stack.push({ dir: full, depth: depth + 1 });
      } else if (/\.exe$/i.test(entry.name)) {
        const score = scoreExe(full);
        if (score > 0) candidates.push(full);
      }
    }
  }
  candidates.sort((a, b) => scoreExe(b) - scoreExe(a));
  return candidates[0] || null;
}

function knownOfficialInstallLocations() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    path.join(local, 'Programs', 'ISpooferMotion'),
    path.join(local, 'Programs', 'ispoofermotion'),
    path.join(local, 'Programs', 'ISpoofer Motion'),
    path.join(local, 'Programs', 'iSpoofer Motion'),
    path.join(local, 'ISpooferMotion'),
    path.join(local, 'ispoofermotion'),
    path.join(local, 'ispoofermotion-update'),
    path.join(appData, 'ISpooferMotion'),
    path.join(appData, 'ispoofermotion')
  ];
}

function findInstalledApp() {
  for (const location of knownOfficialInstallLocations()) {
    const exePath = findExe(location);
    if (exePath) return exePath;
  }
  return null;
}

function isSubPath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAllowedAppPath(exePath) {
  if (!exePath || !/\.exe$/i.test(exePath) || !fs.existsSync(exePath)) return false;
  if (scoreExe(exePath) <= 0) return false;
  return isSubPath(VERSIONS_DIR, exePath) || knownOfficialInstallLocations().some(location => isSubPath(location, exePath));
}

function getFileMtime(exePath) {
  try { return fs.statSync(exePath).mtimeMs; } catch { return 0; }
}

function errorOutput(err) {
  const parts = [];
  if (err && err.message) parts.push(err.message);
  if (err && err.stdout) {
    const stdout = err.stdout.toString().trim();
    if (stdout) parts.push(`stdout: ${stdout}`);
  }
  if (err && err.stderr) {
    const stderr = err.stderr.toString().trim();
    if (stderr) parts.push(`stderr: ${stderr}`);
  }
  return parts.join(' | ') || String(err);
}

function psQuote(value) { return `'${String(value).replace(/'/g, "''")}'`; }

function makeShortcutConsoleBlock() {
  // WScript.Shell cannot set console size, but .lnk files can carry a console
  // data block.
  const block = Buffer.alloc(0xCC);
  let offset = 0;
  const writeU32 = value => { block.writeUInt32LE(value >>> 0, offset); offset += 4; };
  const writeU16 = value => { block.writeUInt16LE(value & 0xFFFF, offset); offset += 2; };

  writeU32(0xCC);
  writeU32(0xA0000002);
  writeU16(0x0007);
  writeU16(0x00F5);
  writeU16(CONSOLE_COLUMNS);
  writeU16(200);
  writeU16(CONSOLE_COLUMNS);
  writeU16(CONSOLE_ROWS);
  writeU16(0);
  writeU16(0);
  writeU32(0);
  writeU32(0);
  writeU32(0x00100000);
  writeU32(54);
  writeU32(400);
  Buffer.from('Consolas', 'utf16le').copy(block, offset);
  offset += 64;
  writeU32(25);
  writeU32(0);
  writeU32(1);
  writeU32(1);
  writeU32(0);
  writeU32(50);
  writeU32(4);
  writeU32(0);

  [
    0x000000, 0x800000, 0x008000, 0x808000,
    0x000080, 0x800080, 0x008080, 0xC0C0C0,
    0x808080, 0xFF0000, 0x00FF00, 0xFFFF00,
    0x0000FF, 0xFF00FF, 0x00FFFF, 0xFFFFFF
  ].forEach(writeU32);

  return block;
}

function patchShortcutConsoleLayout(shortcutPath) {
  if (process.platform !== 'win32' || !shortcutPath || !fs.existsSync(shortcutPath)) return false;

  try {
    let data = fs.readFileSync(shortcutPath);
    if (data.length < 4) return false;

    let terminalOffset = data.length - 4;
    while (terminalOffset >= 0 && data.readUInt32LE(terminalOffset) !== 0) terminalOffset -= 4;
    if (terminalOffset < 0) terminalOffset = data.length;

    const block = makeShortcutConsoleBlock();
    if (
      terminalOffset >= block.length &&
      data.readUInt32LE(terminalOffset - block.length) === 0xCC &&
      data.readUInt32LE(terminalOffset - block.length + 4) === 0xA0000002
    ) {
      data = Buffer.concat([data.subarray(0, terminalOffset - block.length), data.subarray(terminalOffset)]);
      terminalOffset -= block.length;
    }

    const patched = Buffer.concat([
      data.subarray(0, terminalOffset),
      block,
      Buffer.alloc(4),
      data.subarray(terminalOffset + 4)
    ]);
    fs.writeFileSync(shortcutPath, patched);
    writeLog(`Shortcut console layout patched: ${shortcutPath} (${CONSOLE_COLUMNS}x${CONSOLE_ROWS})`);
    return true;
  } catch (err) {
    writeLog(`Shortcut console layout patch failed: ${errorOutput(err)}`);
    return false;
  }
}

function repairDesktopShortcut() {
  if (process.platform !== 'win32' || !IS_PACKAGED) return;
  const launcherTarget = fs.existsSync(LAUNCHER_EXE_FILE) ? LAUNCHER_EXE_FILE : process.execPath;
  const iconTarget = fs.existsSync(APP_ICON_FILE) ? APP_ICON_FILE : launcherTarget;
  // The official installer likes to recreate its own shortcut. But our version is better :P
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$launcher = ${psQuote(launcherTarget)}
$icon = ${psQuote(iconTarget)}
$shortcutName = 'ISpooferMotion.lnk'
$officialNames = @('ISpooferMotion.lnk', 'iSpooferMotion.lnk')
$desktops = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
$shell = New-Object -ComObject WScript.Shell
foreach ($desktop in $desktops) {
  Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $shortcut = $shell.CreateShortcut($_.FullName)
      $target = [string]$shortcut.TargetPath
      $name = $_.Name
      $looksOfficial = ($officialNames -contains $name) -or ($target -match '\\\\Programs\\\\i?SpooferMotion\\\\ISpooferMotion\\.exe$')
      $isLauncher = [string]::Equals($target, $launcher, [StringComparison]::OrdinalIgnoreCase)
      $isOldLauncherShortcut = $isLauncher -and -not [string]::Equals($name, $shortcutName, [StringComparison]::OrdinalIgnoreCase)
      if (($looksOfficial -and -not $isLauncher) -or $isOldLauncherShortcut) {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}
$userDesktop = [Environment]::GetFolderPath('Desktop')
if ($userDesktop -and (Test-Path $userDesktop)) {
  $out = Join-Path $userDesktop $shortcutName
  $shortcut = $shell.CreateShortcut($out)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = ${psQuote(ROOT_DIR)}
  $shortcut.WindowStyle = 1
  $shortcut.Description = 'Launch ISpooferMotion'
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Save()
  Write-Output $out
}
`;

  try {
    const shortcutPath = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
    setConsoleTitle(true);
    patchShortcutConsoleLayout(shortcutPath);
    writeLog(`Desktop shortcut repaired: ${launcherTarget}`);
  } catch (err) {
    setConsoleTitle(true);
    writeLog(`Desktop shortcut repair failed: ${errorOutput(err)}`);
  }
}

function startInstallerViaPowerShell(installerPath, args) {
  // Built pkg EXEs can be flaky when spawning a downloaded installer directly.
  // This writes a tiny PowerShell bridge and lets PowerShell start the installer.
  const scriptPath = path.join(ROOT_DIR, 'run-installer.ps1');
  const argText = args.map(a => `  ${psQuote(a)}`).join(',\n');
  const script = `
$ErrorActionPreference = 'Stop'
$installer = ${psQuote(installerPath)}
$argsList = @(
${argText}
)
$p = Start-Process -FilePath $installer -ArgumentList $argsList -WindowStyle Hidden -PassThru -Wait
$p.Id | Out-File -Encoding ascii ${psQuote(path.join(ROOT_DIR, 'installer.pid'))}
$p.ExitCode | Out-File -Encoding ascii ${psQuote(path.join(ROOT_DIR, 'installer.exitcode'))}
exit 0
`;
  fs.writeFileSync(scriptPath, script, 'utf8');
  writeLog(`PowerShell bridge: ${scriptPath}`);
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { stdio: 'pipe', timeout: INSTALL_TIMEOUT_MS, windowsHide: true });
    setConsoleTitle(true);
  } catch (err) {
    setConsoleTitle(true);
    throw new Error(errorOutput(err));
  }
  let pid = 'unknown';
  let exitCode = 0;
  try { pid = fs.readFileSync(path.join(ROOT_DIR, 'installer.pid'), 'utf8').trim() || 'unknown'; } catch {}
  try {
    const text = fs.readFileSync(path.join(ROOT_DIR, 'installer.exitcode'), 'utf8').trim();
    exitCode = text === '' ? 0 : Number(text);
  } catch {}
  return { pid, exitCode };
}

function startInstallerDirect(installerPath, args) {
  writeLog('Direct installer fallback starting.');
  const result = spawnSync(installerPath, args, {
    cwd: path.dirname(installerPath),
    windowsHide: true,
    timeout: INSTALL_TIMEOUT_MS,
    encoding: 'utf8'
  });
  if (result.error) throw result.error;
  if (result.stdout && result.stdout.trim()) writeLog(`Installer stdout: ${result.stdout.trim()}`);
  if (result.stderr && result.stderr.trim()) writeLog(`Installer stderr: ${result.stderr.trim()}`);
  return { pid: 'direct', exitCode: typeof result.status === 'number' ? result.status : 0 };
}

function isBusyError(err) {
  const text = String((err && err.message) || err || '');
  return /\bEBUSY\b|being used by another process|cannot access the file/i.test(text);
}

async function startInstallerWithRetry(installerPath, args, findReadyApp) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const readyApp = typeof findReadyApp === 'function' ? findReadyApp() : null;
    if (readyApp) {
      writeLog(`Installer retry skipped because app is now available: ${readyApp}`);
      return { pid: 'existing', exitCode: 0, exePath: readyApp };
    }

    try {
      let result;
      try {
        result = startInstallerViaPowerShell(installerPath, args);
        writeLog(`Installer completed through PowerShell. PID=${result.pid} exitCode=${result.exitCode}`);
      } catch (powershellErr) {
        writeLog(`PowerShell installer method failed: ${powershellErr.message}`);
        result = startInstallerDirect(installerPath, args);
        writeLog(`Installer completed directly. PID=${result.pid} exitCode=${result.exitCode}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      const readyAfterError = typeof findReadyApp === 'function' ? findReadyApp() : null;
      if (readyAfterError) {
        writeLog(`Installer lock ignored because app is now available: ${readyAfterError}`);
        return { pid: 'existing', exitCode: 0, exePath: readyAfterError };
      }
      if (!isBusyError(err) || attempt === 5) break;
      const delayMs = 2000 * attempt;
      step(`Installer is busy. Retrying in ${Math.round(delayMs / 1000)}s...`, 'warn');
      writeLog(`Installer start retry ${attempt}/5 after lock error: ${err.message}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function runInstaller(installerPath, installDir) {
  fs.mkdirSync(installDir, { recursive: true });

  const alreadyInstalled = findExe(installDir) || findInstalledApp();
  const alreadyInstalledMtime = alreadyInstalled ? getFileMtime(alreadyInstalled) : 0;
  if (alreadyInstalled) writeLog(`Existing install before update: ${alreadyInstalled}`);

  const attempts = [
    { name: 'normal install', args: ['/S'] },
    { name: 'managed folder install', args: ['/S', `/D=${installDir}`] }
  ];

  let lastStatus = 'not started';
  for (const attempt of attempts) {
    step('Installing...', 'info');
    status('Please wait. This can take a minute.');
    writeLog(`Install method: ${attempt.name}`);
    writeLog(`Installer file: ${installerPath}`);
    writeLog(`Installer args: ${attempt.args.join(' ')}`);

    let installerSucceeded = false;
    try {
      const result = await startInstallerWithRetry(installerPath, attempt.args, () => findExe(installDir) || findInstalledApp());
      if (result.exePath) return result.exePath;
      if (result.exitCode && Number.isFinite(result.exitCode)) {
        lastStatus = `${attempt.name} exited with code ${result.exitCode}`;
        writeLog(lastStatus);
      } else {
        installerSucceeded = true;
      }
    } catch (err) {
      const readyApp = findExe(installDir) || findInstalledApp();
      if (isBusyError(err) && readyApp) {
        step('Existing install found while installer was busy.', 'ok');
        writeLog(`Using existing app after installer lock: ${readyApp}`);
        return readyApp;
      }
      lastStatus = `installer could not complete: ${err.message}`;
      writeLog(lastStatus);
      if (isBusyError(err)) {
        step('Installer is busy. Please close any other installer window and try again.', 'warn');
        break;
      }
      continue;
    }

    const started = Date.now();
    let lastNotice = 0;
    while (Date.now() - started < 30000) {
      const installedPath = findExe(installDir) || findInstalledApp();
      if (installedPath) {
        const changedExistingInstall = alreadyInstalled && installedPath === alreadyInstalled && getFileMtime(installedPath) !== alreadyInstalledMtime;
        const newInstallPath = !alreadyInstalled || installedPath !== alreadyInstalled;
        if (installerSucceeded || changedExistingInstall || newInstallPath) {
          step('Install found.', 'ok');
          writeLog(`Installed app found: ${installedPath}`);
          return installedPath;
        }
      }
      const elapsed = Math.round((Date.now() - started) / 1000);
      if (elapsed - lastNotice >= 20) {
        lastNotice = elapsed;
        status(`Still installing... ${elapsed}s`);
      }
      await sleep(1000);
    }
    lastStatus = `${attempt.name} completed, but ISpooferMotion.exe was not found after 30 seconds`;
    writeLog(lastStatus);
    step('Trying another install method...', 'warn');
  }

  const finalPath = findExe(installDir) || findInstalledApp();
  if (finalPath && (!alreadyInstalled || finalPath !== alreadyInstalled || getFileMtime(finalPath) !== alreadyInstalledMtime)) return finalPath;
  throw new Error(`Installer did not produce a verified ISpooferMotion.exe (${lastStatus}). Check whether the official installer opens normally by running the downloaded setup in %LOCALAPPDATA%\\ISpooferMotionLauncher\\installers.`);
}

function launchExe(exePath) {
  if (!isAllowedAppPath(exePath)) throw new Error(`Refusing to launch unverified app path: ${exePath}`);
  step('Launching ISpooferMotion...', 'launch');
  writeLog(`Launching app path: ${exePath}`);
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

async function installRelease(release, asset) {
  const tag = release.tag_name || release.name || 'latest';
  const safeTag = tag.replace(/[^a-z0-9_.-]/gi, '_');
  const safeAssetName = sanitizeFileName(asset.name);
  const versionDir = path.join(VERSIONS_DIR, safeTag);
  const downloadPath = path.join(INSTALLERS_DIR, `${safeTag}-${safeAssetName}`);
  const expectedSize = Number(asset.size || 0);
  const expectedSha256 = assetSha256(asset);
  if (!expectedSha256) throw new Error(`Release asset is missing a SHA-256 digest: ${asset.name}`);
  const cachedSize = fs.existsSync(downloadPath) ? fs.statSync(downloadPath).size : 0;
  let cacheLooksValid = cachedSize > 0 && (!expectedSize || cachedSize === expectedSize);
  if (cacheLooksValid && expectedSha256) {
    try {
      await verifyFileSha256(downloadPath, expectedSha256, 'Cached asset');
    } catch (err) {
      writeLog(`Cached asset rejected: ${err.message}`);
      cacheLooksValid = false;
    }
  }

  if (!cacheLooksValid) {
    if (cachedSize > 0) { step('Cached download looked incomplete. Re-downloading...', 'warn'); fs.rmSync(downloadPath, { force: true }); }
    step(`Downloading official ${tag}...`, 'info');
    writeLog(`Download asset: ${asset.name}`);
    await downloadFile(asset.browser_download_url, downloadPath, expectedSize);
    await verifyFileSha256(downloadPath, expectedSha256, 'Downloaded asset');
  } else {
    step('Using cached download.', 'ok');
    writeLog(`Using cached download: ${asset.name}`);
    writeLog(`Cached size verified: ${cachedSize} bytes`);
  }

  let exePath = null;
  if (/\.zip$/i.test(asset.name)) {
    step('Extracting official app...', 'info');
    expandZip(downloadPath, versionDir);
    exePath = findExe(versionDir);
    if (!exePath) throw new Error('No app .exe was found after extracting the release zip.');
  } else if (/\.exe$/i.test(asset.name) && /portable/i.test(asset.name)) {
    step('Preparing portable app...', 'info');
    fs.mkdirSync(versionDir, { recursive: true });
    exePath = path.join(versionDir, safeAssetName);
    fs.copyFileSync(downloadPath, exePath);
  } else if (/\.exe$/i.test(asset.name)) {
    exePath = findExe(versionDir);
    if (exePath) {
      step('Using managed install for this version.', 'ok');
      writeLog(`Using managed install for ${tag}: ${exePath}`);
    } else {
      const runnableInstaller = await makeRunnableInstallerCopy(downloadPath, expectedSha256);
      try {
        exePath = await runInstaller(runnableInstaller, versionDir);
      } finally {
        try { fs.rmSync(runnableInstaller, { force: true }); } catch {}
      }
    }
  } else {
    throw new Error(`Unsupported release asset type: ${asset.name}`);
  }

  if (!isAllowedAppPath(exePath)) throw new Error(`Installed executable did not pass launcher validation: ${exePath}`);
  writeJson(STATE_FILE, { tag, assetName: asset.name, assetDigest: asset.digest || null, assetSha256: expectedSha256, downloadSha256: expectedSha256 ? await hashFile(downloadPath, 'sha256') : null, exePath, updatedAt: new Date().toISOString() });
  step(`Ready: official ${tag}`, 'ok');
  return exePath;
}

async function main() {
  ensureDirs();
  cleanupRunDir();
  installLauncherAssets();
  if (!acquireInstanceLock()) {
    step('Launcher is already running. Please wait for it to finish.', 'warn');
    await closeAfterSuccess();
    return;
  }
  const state = readJson(STATE_FILE, {});
  let release;

  try {
    step('Checking official GitHub release...', 'info');
    release = await requestJson(API_URL);
  } catch (err) {
    step(`Update check failed: ${err.message}`, 'warn');
    if (isAllowedAppPath(state.exePath)) {
      repairDesktopShortcut();
      await launchExe(state.exePath);
      await sleep(1000);
      repairDesktopShortcut();
      step('Started previously installed app.', 'ok');
      await closeAfterSuccess();
      return;
    }
    throw err;
  }

  const latestTag = release.tag_name || release.name || 'latest';
  const asset = chooseWindowsAsset(release.assets);
  if (!asset) throw new Error('No usable Windows release asset was found on the official latest release.');

  let exePath = state.exePath;
  if (state.tag !== latestTag || !isAllowedAppPath(exePath)) {
    step(`Latest official version: ${latestTag}`, 'info');
    exePath = await installRelease(release, asset);
  } else {
    step(`Already up to date: ${latestTag}`, 'ok');
  }

  repairDesktopShortcut();
  await launchExe(exePath);
  await sleep(1000);
  repairDesktopShortcut();
  step('Done.', 'ok');
  await closeAfterSuccess();
}

main().catch(async err => {
  step(`ERROR: ${err.message}`, 'error');
  writeLog(err.stack || err.message);
  await waitOnError();
  process.exit(1);
});
