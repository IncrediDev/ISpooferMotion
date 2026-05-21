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

const projectRoot = path.join(__dirname, '..');
const dist = path.join(projectRoot, 'dist');
try {
  fs.rmSync(dist, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
} catch (err) {
  console.warn(`Could not fully clean dist before build: ${err.message}`);
}

// A broken winCodeSign cache can make unsigned local builds fail on Windows when symlinks are disabled.
// It is safe to delete because electron-builder will download it again if it ever needs it.
if (process.platform === 'win32') {
  const winCodeSignCache = path.join(
    os.homedir(),
    'AppData',
    'Local',
    'electron-builder',
    'Cache',
    'winCodeSign',
  );
  try {
    fs.rmSync(winCodeSignCache, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {}
}

let cli;
try {
  cli = require.resolve('electron-builder/out/cli/cli.js', { paths: [projectRoot] });
} catch {
  cli = null;
}

const releaseBuild =
  process.argv.includes('--release') || process.env.ISPOOFER_LAUNCHER_RELEASE_BUILD === '1';
const args = ['--win', 'nsis', '--publish', 'never'];
if (!releaseBuild) {
  args.push('-c.win.signAndEditExecutable=false');
}
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = cli
  ? spawnSync(process.execPath, [cli, ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    })
  : spawnSync(npxCommand, ['electron-builder', ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });

process.exit(result.status || 0);
