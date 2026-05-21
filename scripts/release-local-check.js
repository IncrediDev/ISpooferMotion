#!/usr/bin/env node
// Local sanity check for paths, syntax, and release basics.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function run(command, args, cwd = root) {
  console.log(`> ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function checkJson(file) {
  JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  console.log(`ok ${file}`);
}

function checkFile(file) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  console.log(`ok ${file}`);
}

checkJson('package.json');
checkJson('launcher/package.json');
checkFile('scripts/build-plugin-rbxmx.js');
checkFile('launcher/scripts/build-win.js');

checkFile('build/entitlements.mac.plist');
checkFile('src/assets/app_icon.ico');
checkFile('src/assets/app_icon.png');
checkFile('launcher/src/assets/app_icon.ico');
checkFile('launcher/src/assets/app_icon.png');

run('node', ['--check', 'src/core/tasks/index.js']);
run('node', ['--check', 'scripts/upload-virustotal-release-assets.js']);
run('node', ['--check', 'scripts/release-hardening-check.js']);
run('node', ['--check', 'scripts/verify-release-assets.js']);
run('node', ['--check', 'src/main/app.js']);
run('node', ['--check', 'src/preload/preload.js']);
run('node', ['--check', 'src/renderer/scripts/app.js']);
run('node', ['--check', 'src/main/window.js']);
run('node', ['--check', 'src/main/services/ipc-handlers.js']);
run('node', ['--check', 'launcher/src/main/main.js']);
run('node', ['--check', 'launcher/src/preload/preload.js']);
run('node', ['--check', 'launcher/src/popup/scripts/popup.js']);
run('node', ['--check', 'launcher/scripts/build-win.js']);
run('node', ['--check', 'scripts/build-plugin-rbxmx.js']);
run('node', ['scripts/release-hardening-check.js', '--allow-generated-output']);
run('node', ['scripts/build-plugin-rbxmx.js']);

console.log('\nlocal release check complete');
