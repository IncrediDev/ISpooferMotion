'use strict';

// Windows shortcut helper. The launcher owns the desktop shortcut; the managed app should not create one.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function quotePowerShellString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function ensureLauncherDesktopShortcut({ app, log = () => {} }) {
  if (!app || process.platform !== 'win32' || !app.isPackaged) return false;

  try {
    const desktopDir = app.getPath('desktop');
    const shortcutPath = path.join(desktopDir, 'ISpooferLauncher.lnk');
    const targetPath = process.execPath;
    const workingDirectory = path.dirname(targetPath);
    const packagedIconPath = path.join(process.resourcesPath || workingDirectory, 'app_icon.ico');
    const iconPath = fs.existsSync(packagedIconPath) ? packagedIconPath : targetPath;

    const script = `
$shortcutPath = ${quotePowerShellString(shortcutPath)}
$targetPath = ${quotePowerShellString(targetPath)}
$workingDirectory = ${quotePowerShellString(workingDirectory)}
$iconPath = ${quotePowerShellString(iconPath)}
$directory = Split-Path -Parent $shortcutPath
if (!(Test-Path $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Launch and update ISpooferMotion'
$shortcut.Save()
`;

    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    return true;
  } catch (err) {
    log(`Could not ensure desktop shortcut: ${err && err.message ? err.message : err}`);
    return false;
  }
}

function removeRealAppDesktopShortcut({ app, log = () => {} }) {
  if (!app || process.platform !== 'win32') return false;
  try {
    const shortcutPath = path.join(app.getPath('desktop'), 'ISpooferMotion.lnk');
    if (fs.existsSync(shortcutPath)) fs.rmSync(shortcutPath, { force: true });
    return true;
  } catch (err) {
    log(`Could not remove real app desktop shortcut: ${err && err.message ? err.message : err}`);
    return false;
  }
}

module.exports = {
  ensureLauncherDesktopShortcut,
  removeRealAppDesktopShortcut,
};
