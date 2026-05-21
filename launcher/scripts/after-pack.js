'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveRcedit() {
  try {
    return require.resolve('electron-winstaller/vendor/rcedit.exe', {
      paths: [path.join(__dirname, '..')],
    });
  } catch {
    return null;
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const appOutDir = context.appOutDir;
  const exePath = path.join(appOutDir, 'ISpooferLauncher.exe');
  const iconPath = path.join(__dirname, '..', 'src', 'assets', 'app_icon.ico');
  const rcedit = resolveRcedit();

  if (!rcedit || !fs.existsSync(exePath) || !fs.existsSync(iconPath)) {
    throw new Error('Could not stamp launcher icon because rcedit, exe, or icon was missing.');
  }

  execFileSync(
    rcedit,
    [
      exePath,
      '--set-icon',
      iconPath,
      '--set-version-string',
      'FileDescription',
      'ISpooferLauncher',
      '--set-version-string',
      'ProductName',
      'ISpooferLauncher',
      '--set-version-string',
      'CompanyName',
      'IncrediDev',
      '--set-version-string',
      'LegalCopyright',
      'ISpooferMotion',
    ],
    { stdio: 'inherit', windowsHide: true },
  );
};
