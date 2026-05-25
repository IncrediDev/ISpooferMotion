#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function run(command, args) {
  const executable =
    process.platform === 'win32' && command === 'taskkill' ? 'taskkill.exe' : command;
  spawnSync(executable, args, { cwd: root, stdio: 'ignore', shell: false });
}

function remove(relativePath) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 400 });
    console.log(`removed ${relativePath}`);
  } catch (err) {
    console.warn(`could not remove ${relativePath}: ${err.message}`);
  }
}

run('taskkill', ['/F', '/IM', 'ISpooferMotion.exe', '/T']);
run('taskkill', ['/F', '/IM', 'ISpooferMotion Launcher.exe', '/T']);
run('taskkill', ['/F', '/IM', 'electron.exe', '/T']);

[
  'dist',
  'out',
  'plugin-build',
  'dist-plugin',
  '.cache',
  '.vite',
  'src/renderer-react/dist',
  'src/renderer-react/.vite',
].forEach(remove);

console.log('clean complete');
