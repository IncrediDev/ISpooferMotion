#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, rmSync, mkdirSync } = require('node:fs');
const { delimiter } = require('node:path');
const { dirname, join } = require('node:path');

const installCache = join(process.cwd(), '.npm-cache');

const resolveNpmCommand = () => {
  if (process.platform !== 'win32') {
    return { command: 'npm', argsPrefix: [] };
  }

  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ...String(process.env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .map((pathEntry) => join(pathEntry, 'node_modules', 'npm', 'bin', 'npm-cli.js')),
  ];

  const npmCliPath = candidates.find((candidate) => candidate && existsSync(candidate));
  if (npmCliPath) {
    return { command: process.execPath, argsPrefix: [npmCliPath] };
  }

  return { command: 'npm.cmd', argsPrefix: [] };
};

const npmCommand = resolveNpmCommand();

const baseEnv = {
  ...process.env,
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_progress: 'false',
  npm_config_cache: installCache,
  npm_config_prefer_offline: 'false',
  npm_config_strict_peer_deps: 'false',
};

const run = (args, label) => {
  console.log(`[ci-install] ${label}`);
  const result = spawnSync(npmCommand.command, [...npmCommand.argsPrefix, ...args], {
    stdio: 'inherit',
    shell: false,
    env: baseEnv,
  });

  if (result.error) {
    console.warn(`[ci-install] Could not start npm: ${result.error.message}`);
  }

  return result;
};

const cleanCache = () => {
  try {
    rmSync(installCache, { recursive: true, force: true });
    mkdirSync(installCache, { recursive: true });
  } catch (error) {
    console.warn(`[ci-install] Could not reset local npm cache: ${error.message}`);
  }
};

const attempts = [
  {
    label: 'npm ci --ignore-scripts --no-audit --no-fund (attempt 1/3)',
    args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-online'],
    cleanBefore: true,
  },
  {
    label: 'npm ci --ignore-scripts --no-audit --no-fund --legacy-peer-deps (attempt 2/3)',
    args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-online', '--legacy-peer-deps'],
    cleanBefore: true,
  },
  {
    label: 'npm install --ignore-scripts --no-audit --no-fund (fallback attempt 3/3)',
    args: ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-online', '--legacy-peer-deps'],
    cleanBefore: true,
  },
];

let lastStatus = 1;
for (const attempt of attempts) {
  if (attempt.cleanBefore) {
    cleanCache();
  }

  const result = run(attempt.args, attempt.label);
  lastStatus = typeof result.status === 'number' ? result.status : 1;

  if (lastStatus === 0) {
    process.exit(0);
  }

  console.warn('[ci-install] install attempt failed; moving to next strategy.');
}

process.exit(lastStatus);
