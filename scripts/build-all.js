#!/usr/bin/env node
// Build helper for local/release packaging.
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

function commandForPlatform(command) {
  if (process.platform !== 'win32') return command;
  return command === 'npm' || command === 'npx' ? `${command}.cmd` : command;
}

function run(command, args, cwd = root) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  const result = spawnSync(commandForPlatform(command), args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run('npm', ['run', 'clean']);
run('npm', ['run', 'build:plugin']);
run('npm', ['run', 'build']);
run('npm', ['run', 'build:setup'], path.join(root, 'launcher'));

console.log('\nbuild complete');
