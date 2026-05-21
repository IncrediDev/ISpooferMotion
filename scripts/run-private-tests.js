'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findPattern(pattern) {
  const normalized = pattern.replace(/\\/g, '/');
  const starIndex = normalized.indexOf('*');

  if (starIndex === -1) {
    const resolved = path.resolve(process.cwd(), pattern);
    return fs.existsSync(resolved) ? [resolved] : [];
  }

  const slashIndex = normalized.lastIndexOf('/', starIndex);
  const dirPart = slashIndex === -1 ? '.' : normalized.slice(0, slashIndex);
  const filePattern = normalized.slice(slashIndex + 1);
  const [prefix, suffix] = filePattern.split('*');
  const dir = path.resolve(process.cwd(), dirPart);

  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix),
    )
    .map((entry) => path.join(dir, entry.name));
}

const patterns = process.argv.slice(2);
const files = [...new Set(patterns.flatMap(findPattern))].sort();

if (files.length === 0) {
  console.log('No private test files found; skipping.');
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
