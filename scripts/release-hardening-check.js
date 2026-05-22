#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function mustInclude(file, pattern, message) {
  const content = read(file);
  const matched = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern);
  if (!matched) errors.push(`${file}: ${message}`);
}

function mustNotInclude(file, pattern, message) {
  const content = read(file);
  const matched = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern);
  if (matched) errors.push(`${file}: ${message}`);
}

mustInclude('src/main/window.js', /contextIsolation:\s*true/, 'contextIsolation must stay enabled.');
mustInclude('src/main/window.js', /nodeIntegration:\s*false/, 'nodeIntegration must stay disabled.');
mustInclude('src/preload/preload.js', /contextBridge\.exposeInMainWorld/, 'preload must expose a bridged API.');
mustInclude('src/preload/preload.js', /Object\.freeze/, 'preload API should be frozen.');
mustInclude('src/main/services/ipc-handlers.js', /get-release-source/, 'get-release-source IPC handler must be registered.');
mustInclude('src/main/services/ipc-handlers.js', /fetch-audio-quota/, 'fetch-audio-quota IPC handler must be registered.');
mustInclude('src/main/services/common.js', /redact/i, 'common logging must keep redaction support.');
mustInclude('src/main/services/roblox-api.js', /timeout/i, 'Roblox API requests should keep timeout handling.');
mustInclude('src/main/services/transfer-handlers.js', /pipeline|finished|createWriteStream/s, 'transfer handlers must stream downloads safely.');
mustNotInclude('src/renderer/index.html', /Content-Security-Policy[^>]*unsafe-eval/i, 'renderer CSP must not allow unsafe-eval.');

const pkg = JSON.parse(read('package.json'));
if (pkg.build?.win?.signAndEditExecutable !== true) {
  errors.push('package.json: app win.signAndEditExecutable should remain true for release metadata/icon editing.');
}
if (pkg.build?.files?.some((entry) => String(entry).includes('launcher/**/*')) !== true) {
  errors.push('package.json: app build files should explicitly exclude launcher from the packaged app.');
}

const launcherPkg = JSON.parse(read('launcher/package.json'));
if (launcherPkg.build?.win?.signAndEditExecutable !== false) {
  errors.push('launcher/package.json: launcher win.signAndEditExecutable should stay false for unsigned local builds.');
}

if (errors.length) {
  console.error('\nRelease hardening check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('release hardening check passed');
