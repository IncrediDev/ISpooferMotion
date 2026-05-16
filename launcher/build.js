const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const isWin = process.platform === 'win32';
const launcherDir = __dirname;
const distDir = path.join(launcherDir, 'dist');
const tempBuildDir = path.join(os.tmpdir(), `ispoofermotion-launcher-build-${process.pid}`);
const tempExe = path.join(tempBuildDir, 'launcher.exe');
const iconPath = path.resolve(launcherDir, '..', 'assets', 'app_icon.ico');
const patchedBaseExe = path.join(tempBuildDir, 'pkg-base-icon.exe');
const rootDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ISpooferMotionLauncher');
const appLauncherExe = path.join(rootDir, 'launcher.exe');
const appIcon = path.join(rootDir, 'app_icon.ico');
const consoleColumns = 60;
const consoleRows = 14;

function q(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function run(command, extraEnv = {}) {
  console.log(`> ${command}`);
  execSync(command, { cwd: launcherDir, stdio: 'inherit', shell: 'cmd.exe', env: { ...process.env, ...extraEnv } });
}

function hidePath(file) {
  if (!fs.existsSync(file)) return;
  try { execFileSync('attrib.exe', ['+h', file], { stdio: 'ignore' }); } catch {}
}

function unhidePath(file) {
  if (!fs.existsSync(file)) return;
  try { execFileSync('attrib.exe', ['-h', '-r', file], { stdio: 'ignore' }); } catch {}
}

function copyHidden(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Missing build source: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // Build output is installed straight into AppData; the user should only see
  // the desktop shortcut. This matches the official installer's look I guess.
  unhidePath(destination);
  fs.copyFileSync(source, destination);
  hidePath(destination);
}

function makeShortcutConsoleBlock() {
  // WScript.Shell covers target/icon nicely, but not console geometry. This is
  // the little Shell Link block that makes the window open compact.
  const block = Buffer.alloc(0xCC);
  let offset = 0;
  const writeU32 = value => { block.writeUInt32LE(value >>> 0, offset); offset += 4; };
  const writeU16 = value => { block.writeUInt16LE(value & 0xFFFF, offset); offset += 2; };

  writeU32(0xCC);
  writeU32(0xA0000002);
  writeU16(0x0007);
  writeU16(0x00F5);
  writeU16(consoleColumns);
  writeU16(200);
  writeU16(consoleColumns);
  writeU16(consoleRows);
  writeU16(0);
  writeU16(0);
  writeU32(0);
  writeU32(0);
  writeU32(0x00100000);
  writeU32(54);
  writeU32(400);
  Buffer.from('Consolas', 'utf16le').copy(block, offset);
  offset += 64;
  writeU32(25);
  writeU32(0);
  writeU32(1);
  writeU32(1);
  writeU32(0);
  writeU32(50);
  writeU32(4);
  writeU32(0);

  [
    0x000000, 0x800000, 0x008000, 0x808000,
    0x000080, 0x800080, 0x008080, 0xC0C0C0,
    0x808080, 0xFF0000, 0x00FF00, 0xFFFF00,
    0x0000FF, 0xFF00FF, 0x00FFFF, 0xFFFFFF
  ].forEach(writeU32);

  return block;
}

function patchShortcutConsoleLayout(shortcutPath) {
  if (!shortcutPath || !fs.existsSync(shortcutPath)) return false;

  let data = fs.readFileSync(shortcutPath);
  if (data.length < 4) return false;

  let terminalOffset = data.length - 4;
  while (terminalOffset >= 0 && data.readUInt32LE(terminalOffset) !== 0) terminalOffset -= 4;
  if (terminalOffset < 0) terminalOffset = data.length;

  const block = makeShortcutConsoleBlock();
  if (
    terminalOffset >= block.length &&
    data.readUInt32LE(terminalOffset - block.length) === 0xCC &&
    data.readUInt32LE(terminalOffset - block.length + 4) === 0xA0000002
  ) {
    data = Buffer.concat([data.subarray(0, terminalOffset - block.length), data.subarray(terminalOffset)]);
    terminalOffset -= block.length;
  }

  const patched = Buffer.concat([
    data.subarray(0, terminalOffset),
    block,
    Buffer.alloc(4),
    data.subarray(terminalOffset + 4)
  ]);
  fs.writeFileSync(shortcutPath, patched);
  return true;
}

function repairDesktopShortcut() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$launcher = ${psQuote(appLauncherExe)}
$icon = ${psQuote(appIcon)}
$shortcutName = 'ISpooferMotion.lnk'
$officialNames = @('ISpooferMotion.lnk', 'iSpooferMotion.lnk')
$desktops = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
$shell = New-Object -ComObject WScript.Shell
foreach ($desktop in $desktops) {
  Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $shortcut = $shell.CreateShortcut($_.FullName)
      $target = [string]$shortcut.TargetPath
      $name = $_.Name
      $looksOfficial = ($officialNames -contains $name) -or ($target -match '\\\\Programs\\\\i?SpooferMotion\\\\ISpooferMotion\\.exe$')
      $isLauncher = [string]::Equals($target, $launcher, [StringComparison]::OrdinalIgnoreCase)
      $isOldLauncherShortcut = $isLauncher -and -not [string]::Equals($name, $shortcutName, [StringComparison]::OrdinalIgnoreCase)
      if (($looksOfficial -and -not $isLauncher) -or $isOldLauncherShortcut) {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}
$userDesktop = [Environment]::GetFolderPath('Desktop')
if ($userDesktop -and (Test-Path $userDesktop)) {
  $out = Join-Path $userDesktop $shortcutName
  $shortcut = $shell.CreateShortcut($out)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = ${psQuote(rootDir)}
  $shortcut.WindowStyle = 1
  $shortcut.Description = 'Launch ISpooferMotion'
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Save()
  Write-Output $out
}
`;
  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' }).trim();
}

async function makeIconBase() {
  if (!fs.existsSync(iconPath)) return null;

  try {
    // Patch pkg's base binary before packaging. Editing the final pkg EXE can
    // break its payload footer, so this keeps the icon work upstream.
    const pkgFetch = require('@yao-pkg/pkg-fetch');
    const baseExe = await pkgFetch.need({ nodeRange: 'node20', platform: 'win32', arch: 'x64' });
    fs.copyFileSync(baseExe, patchedBaseExe);

    const { rcedit } = await import('rcedit');
    await rcedit(patchedBaseExe, {
      icon: iconPath,
      'version-string': {
        FileDescription: 'ISpooferMotion',
        ProductName: 'ISpooferMotion',
        OriginalFilename: 'launcher.exe',
        InternalName: 'ISpooferMotion'
      }
    });
    console.log(`+ Patched pkg base icon: ${patchedBaseExe}`);
    return patchedBaseExe;
  } catch (err) {
    console.warn('! Embedded EXE icon skipped; building with the default pkg base.');
    console.warn(`  ${err.message || err}`);
    return null;
  }
}

async function main() {
  if (!isWin) {
    console.error('x Windows build can only be created on Windows.');
    process.exit(1);
  }

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.rmSync(tempBuildDir, { recursive: true, force: true });
  fs.mkdirSync(tempBuildDir, { recursive: true });
  fs.mkdirSync(rootDir, { recursive: true });

  try {
    const iconBase = await makeIconBase();
    run(`npm exec -- pkg ./launcher.js --targets node20-win-x64 --output ${q(tempExe)}`, iconBase ? { PKG_NODE_PATH: iconBase } : {});

    copyHidden(tempExe, appLauncherExe);
    if (fs.existsSync(iconPath)) {
      copyHidden(iconPath, appIcon);
    } else {
      console.warn(`! Icon install skipped. Missing: ${iconPath}`);
    }

    hidePath(rootDir);
    const shortcutPath = repairDesktopShortcut();
    if (patchShortcutConsoleLayout(shortcutPath)) {
      console.log(`+ Shortcut console layout set: ${consoleColumns}x${consoleRows}`);
    }
    fs.rmSync(distDir, { recursive: true, force: true });

    console.log('');
    console.log('+ Build complete.');
    console.log(`+ Hidden launcher files installed in: ${rootDir}`);
    console.log(`+ Desktop shortcut ready: ${shortcutPath || 'ISpooferMotion.lnk'}`);
  } finally {
    fs.rmSync(tempBuildDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
