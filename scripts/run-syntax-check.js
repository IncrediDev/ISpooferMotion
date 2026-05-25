#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const includeDirs = ['src', 'scripts'];
const skipNames = new Set(['node_modules', 'dist', 'out', 'build', '.git']);
const errors = [];

function collectJavaScriptFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJavaScriptFiles(fullPath, files);
    else if (/\.m?js$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function checkFile(file) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    errors.push(`${path.relative(root, file)}\n${result.stderr || result.stdout}`.trim());
  }
}

function readJson(relativePath) {
  const file = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${relativePath} is not valid JSON: ${error.message}`);
    return null;
  }
}

for (const dir of includeDirs) {
  for (const file of collectJavaScriptFiles(path.join(root, dir))) checkFile(file);
}

for (const relativePath of ['package.json', 'package-lock.json']) {
  readJson(relativePath);
}

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');

if (pkg && lock) {
  const lockRoot = lock.packages && lock.packages[''];
  if (!lockRoot) errors.push('package-lock.json is missing packages[""].');
  else {
    if (lockRoot.version !== pkg.version) {
      errors.push(
        `package-lock.json version ${lockRoot.version} does not match package.json ${pkg.version}.`,
      );
    }
    for (const section of ['dependencies', 'devDependencies']) {
      const expected = pkg[section] || {};
      const actual = lockRoot[section] || {};
      for (const [name, range] of Object.entries(expected)) {
        if (actual[name] !== range)
          errors.push(`package-lock.json ${section}.${name} does not match package.json.`);
      }
    }
  }
}

const requiredFiles = [
  'src/main/app.js',
  'src/main/window.js',
  'src/preload/preload.js',
  'src/renderer-react/index.html',
  'src/renderer-react/src/styles/app.css',
  'src/plugin/plugin.lua',
  'src/assets/app_icon.ico',
  'src/assets/app_icon.png',

  'build/entitlements.mac.plist',
];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath)))
    errors.push(`Missing required file: ${relativePath}`);
}

if (errors.length) {
  console.error('Project checks failed:\n');
  for (const error of errors) console.error(`- ${error}\n`);
  process.exit(1);
}

console.log(`syntax/package check passed (${includeDirs.length} roots)`);
