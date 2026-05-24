#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'src', 'renderer-react');
const rendererPackageJson = path.join(rendererDir, 'package.json');
const rendererLockFile = path.join(rendererDir, 'package-lock.json');
const rendererNodeModules = path.join(rendererDir, 'node_modules');
const rendererIndex = path.join(rendererDir, 'dist', 'index.html');

function commandForPlatform(command) {
  if (process.platform !== 'win32') return command;
  return command === 'npm' || command === 'npx' ? `${command}.cmd` : command;
}

function run(command, args, cwd = rendererDir) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  const result = spawnSync(commandForPlatform(command), args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    if (result.error) console.error(result.error);
    process.exit(result.status || 1);
  }
}

function installRendererDependencies() {
  if (fs.existsSync(rendererNodeModules)) return;

  if (fs.existsSync(rendererLockFile)) {
    run('npm', ['ci']);
    return;
  }

  run('npm', ['install']);
}

function buildRenderer() {
  if (!fs.existsSync(rendererPackageJson)) {
    console.error(`Renderer package not found: ${rendererPackageJson}`);
    process.exit(1);
  }

  installRendererDependencies();
  run('npm', ['run', 'build']);

  if (!fs.existsSync(rendererIndex)) {
    console.error(`Renderer build failed: missing ${rendererIndex}`);
    process.exit(1);
  }

  console.log(`\nrenderer build complete: ${path.relative(root, rendererIndex)}`);
}

buildRenderer();
