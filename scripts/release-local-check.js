#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const errors = [];

function run(label, command, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.status !== 0) errors.push(`${label} failed with exit code ${result.status || 1}`);
}

function exists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) errors.push(`Missing ${relativePath}`);
}

run('syntax and package checks', process.execPath, ['scripts/run-syntax-check.js']);

for (const file of [
  'package.json',
  'package-lock.json',
  'src/assets/app_icon.ico',
  'src/assets/app_icon.png',
  'launcher/package.json',
  'launcher/package-lock.json',
  'launcher/src/assets/app_icon.ico',
  'launcher/src/assets/app_icon.png',
  'scripts/build-plugin-rbxmx.js',
  'scripts/extract-release-notes.js',
  'scripts/verify-release-assets.js',
]) exists(file);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const launcherPkg = JSON.parse(fs.readFileSync(path.join(root, 'launcher/package.json'), 'utf8'));
if (pkg.version !== launcherPkg.version) {
  errors.push(`App version ${pkg.version} does not match launcher version ${launcherPkg.version}.`);
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version)) {
  errors.push(`Version is not semver-compatible: ${pkg.version}`);
}

if (!pkg.scripts || !pkg.scripts.test || !pkg.scripts['release:local-check'] || !pkg.scripts['release:hardening-check']) {
  errors.push('package.json is missing required workflow scripts.');
}

if (!launcherPkg.scripts || !launcherPkg.scripts['build:win:release']) {
  errors.push('launcher/package.json is missing build:win:release.');
}

if (errors.length) {
  console.error('\nRelease local check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('\nrelease local check passed');
