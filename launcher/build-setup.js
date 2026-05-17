#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
process.env.CSC_LINK = '';
process.env.WIN_CSC_LINK = '';
process.env.ELECTRON_BUILDER_DISABLE_WIN_CODE_SIGN = 'true';

const dist = path.join(__dirname, 'dist');
try {
  fs.rmSync(dist, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
} catch (err) {
  console.warn(`Could not fully clean dist before build: ${err.message}`);
}

// A broken winCodeSign cache can make unsigned local builds fail on Windows when symlinks are disabled.
// It is safe to delete because electron-builder will download it again if it ever needs it.
if (process.platform === 'win32') {
  const winCodeSignCache = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  try {
    fs.rmSync(winCodeSignCache, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {}
}

let cli;
try {
  cli = require.resolve('electron-builder/out/cli/cli.js', { paths: [__dirname] });
} catch {
  cli = null;
}

const args = ['--win', 'nsis', '--publish', 'never'];
const result = cli
  ? spawnSync(process.execPath, [cli, ...args], { cwd: __dirname, stdio: 'inherit', shell: false, env: process.env })
  : spawnSync('npx', ['electron-builder', ...args], { cwd: __dirname, stdio: 'inherit', shell: process.platform === 'win32', env: process.env });

process.exit(result.status || 0);
