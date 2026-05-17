'use strict';

const { execFileSync } = require('child_process');

if (process.platform !== 'win32') {
  console.error('x Windows setup can only be built on Windows.');
  process.exit(1);
}

execFileSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
