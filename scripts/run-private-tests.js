#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cwd = process.cwd();

function normalizeSlash(value) {
  return value.replace(/\\/g, '/');
}

function expandPattern(pattern) {
  const normalized = normalizeSlash(pattern);
  if (!normalized.includes('*')) return [path.resolve(cwd, pattern)];

  const parts = normalized.split('/');
  const starIndex = parts.findIndex((part) => part.includes('*'));
  const base = path.resolve(cwd, ...parts.slice(0, starIndex));
  const rest = parts.slice(starIndex);
  const matches = [];

  function walk(directory, remaining) {
    if (!remaining.length) {
      matches.push(directory);
      return;
    }

    const [segment, ...next] = remaining;
    if (!fs.existsSync(directory)) return;

    const escaped = segment
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const matcher = new RegExp(`^${escaped}$`);

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!matcher.test(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (next.length && !entry.isDirectory()) continue;
      walk(fullPath, next);
    }
  }

  walk(base, rest);
  return matches;
}

const files = process.argv.slice(2).flatMap(expandPattern).filter((file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
});

if (!files.length) {
  console.error('No test files matched.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd,
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status || 0);
