#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targets = [
  'dist',
  'build',
  'out',
  '.cache',
  '.vite',
  'node_modules',
  'npm-debug.log',
  'yarn-error.log',
];

for (const target of targets) {
  const fullPath = path.join(root, target);
  try {
    fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    console.log(`removed ${target}`);
  } catch (err) {
    console.warn(`could not remove ${target}: ${err.message}`);
  }
}
