#!/usr/bin/env node
// Release safety check.
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];
const allowGeneratedOutput = process.argv.includes('--allow-generated-output');

function rel(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function readJson(file) {
  try {
    return JSON.parse(read(file));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
    return {};
  }
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function ok(message) {
  console.log(`ok ${message}`);
}

function requireFile(file) {
  if (!exists(file)) fail(`Missing required file: ${file}`);
  else ok(file);
}

function forbidPath(file) {
  if (exists(file)) fail(`Stale/deprecated path should not exist: ${file}`);
}

function requireText(file, pattern, description) {
  if (!exists(file)) {
    fail(`Missing ${file}; cannot check ${description}.`);
    return;
  }
  const value = read(file);
  if (!pattern.test(value)) fail(`${file} is missing ${description}.`);
  else ok(`${file}: ${description}`);
}

function walk(dir, predicate, results = []) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) return results;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, entry.name);
    const relative = rel(full);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'out', 'release'].includes(entry.name)) continue;
      walk(relative, predicate, results);
    } else if (predicate(full, relative)) {
      results.push(relative);
    }
  }
  return results;
}

function normalizeTag(value) {
  return String(value || '')
    .trim()
    .replace(/^refs\/tags\//, '')
    .replace(/^v/i, '');
}

function getReleaseTagFromEnv() {
  const explicitTag = String(process.env.RELEASE_TAG || '').trim();
  if (explicitTag) return explicitTag;

  const githubRef = String(process.env.GITHUB_REF || '').trim();
  if (githubRef.startsWith('refs/tags/')) return githubRef;

  const refName = String(process.env.GITHUB_REF_NAME || '').trim();
  return /^v?\d+\.\d+\.\d+(?:[-+].*)?$/i.test(refName) ? refName : '';
}

function checkVersionAndChangelog() {
  const rootPkg = readJson('package.json');
  const launcherPkg = readJson('launcher/package.json');
  const rootVersion = String(rootPkg.version || '').trim();
  const launcherVersion = String(launcherPkg.version || '').trim();
  if (!rootVersion) fail('Root package.json is missing version.');
  if (!launcherVersion) fail('launcher/package.json is missing version.');
  if (rootVersion && launcherVersion && rootVersion !== launcherVersion) {
    fail(`Root app version (${rootVersion}) does not match launcher version (${launcherVersion}).`);
  } else if (rootVersion) {
    ok(`root and launcher versions match: ${rootVersion}`);
  }

  const envTag = getReleaseTagFromEnv();
  const tagVersion = normalizeTag(envTag);
  if (tagVersion && rootVersion && tagVersion !== rootVersion) {
    fail(`Release tag (${envTag}) does not match package version (${rootVersion}).`);
  } else if (tagVersion) {
    ok(`release tag matches package version: ${envTag}`);
  }

  const changelog = exists('CHANGELOG.md') ? read('CHANGELOG.md') : '';
  const versionHeading = new RegExp(
    `^##\\s+v?${rootVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'm',
  );
  if (!versionHeading.test(changelog))
    fail(`CHANGELOG.md is missing a ## v${rootVersion} section.`);
  else ok(`CHANGELOG.md has ## v${rootVersion}`);
}

function checkStaticFiles() {
  [
    'src/main/app.js',
    'src/main/window.js',
    'src/preload/preload.js',
    'src/renderer/index.html',
    'src/renderer/scripts/app.js',
    'src/plugin/plugin.lua',
    'src/plugin/modules/GetIdsUIFactory.lua',
    'src/plugin/modules/ReplaceIdsUIFactory.lua',
    'build/entitlements.mac.plist',
    'src/assets/app_icon.ico',
    'src/assets/app_icon.png',
    'launcher/src/main/main.js',
    'launcher/src/main/shortcuts.js',
    'launcher/src/preload/preload.js',
    'launcher/src/popup/popup.html',
    'launcher/src/popup/scripts/popup.js',
    'launcher/src/popup/styles/popup.css',
    'launcher/src/assets/app_icon.ico',
    'launcher/src/assets/app_icon.png',
    'scripts/build-plugin-rbxmx.js',
    'scripts/extract-release-notes.js',
    'scripts/upload-virustotal-release-assets.js',
  ].forEach(requireFile);

  [
    'main.js',
    'preload.js',
    'index.html',
    'plugin.lua',
    'modules',
    'assets',
    'dev',
    'launcher/main.js',
    'launcher/preload.js',
    'launcher/index.html',
    'launcher/popup.html',
    'launcher/assets',
    'launcher/build.js',
    'launcher/build-setup.js',
  ].forEach(forbidPath);
}

function checkBuildConfig() {
  const rootPkg = readJson('package.json');
  const launcherPkg = readJson('launcher/package.json');
  if (rootPkg.main !== 'src/main/app.js')
    fail(`Root package main should be src/main/app.js, got ${rootPkg.main}`);
  else ok('root package main');
  if (
    !rootPkg.build ||
    !rootPkg.build.win ||
    rootPkg.build.win.icon !== 'src/assets/app_icon.ico'
  ) {
    fail('Root Windows build icon should be src/assets/app_icon.ico.');
  } else ok('root Windows icon path');
  if (!rootPkg.build || !rootPkg.build.files || !rootPkg.build.files.includes('src/**/*')) {
    fail('Root build.files must include src/**/* so core modules/assets package correctly.');
  } else ok('root build includes src/**/*');
  if (!rootPkg.build || !rootPkg.build.win || rootPkg.build.win.signAndEditExecutable !== true) {
    warn(
      'Root Windows build is not configured with signAndEditExecutable: true; icons/metadata may not embed as expected.',
    );
  }

  if (launcherPkg.main !== 'src/main/main.js')
    fail(`Launcher package main should be src/main/main.js, got ${launcherPkg.main}`);
  else ok('launcher package main');
  if (
    !launcherPkg.build ||
    !launcherPkg.build.win ||
    launcherPkg.build.win.icon !== 'src/assets/app_icon.ico'
  ) {
    fail('Launcher Windows build icon should be src/assets/app_icon.ico.');
  } else ok('launcher Windows icon path');
  if (
    !launcherPkg.build ||
    !launcherPkg.build.files ||
    !launcherPkg.build.files.includes('src/**/*')
  ) {
    fail('Launcher build.files must include src/**/* so renderer/core/assets package correctly.');
  } else ok('launcher build includes src/**/*');
  if (
    !launcherPkg.build ||
    !launcherPkg.build.win ||
    launcherPkg.build.win.signAndEditExecutable !== true
  ) {
    warn(
      'Launcher Windows build is not configured with signAndEditExecutable: true; icons/metadata may not embed as expected.',
    );
  }
}

function checkElectronSecurity() {
  const files = [
    ...walk('src', (full, relative) => /\.(js|html)$/.test(relative)),
    ...walk('launcher/src', (full, relative) => /\.(js|html)$/.test(relative)),
  ];
  const badNodeIntegration = [];
  const badContextIsolation = [];
  const remoteUsage = [];
  const unsafeEval = [];
  for (const file of files) {
    const text = read(file);
    if (/nodeIntegration\s*:\s*true/.test(text)) badNodeIntegration.push(file);
    if (/contextIsolation\s*:\s*false/.test(text)) badContextIsolation.push(file);
    if (
      /(?:@electron\/remote|require\(['"]electron['"]\)\.remote|\bremote\s*=\s*require\(['"]electron['"]\))/.test(
        text,
      )
    )
      remoteUsage.push(file);
    if (/unsafe-eval/.test(text)) unsafeEval.push(file);
  }
  if (badNodeIntegration.length)
    fail(`nodeIntegration: true found in ${badNodeIntegration.join(', ')}`);
  else ok('no nodeIntegration: true usage');
  if (badContextIsolation.length)
    fail(`contextIsolation: false found in ${badContextIsolation.join(', ')}`);
  else ok('no contextIsolation: false usage');
  if (remoteUsage.length) fail(`Electron remote usage found in ${remoteUsage.join(', ')}`);
  else ok('no Electron remote usage');
  if (unsafeEval.length) fail(`unsafe-eval found in ${unsafeEval.join(', ')}`);
}

function checkGeneratedJunk() {
  ['dist', 'launcher/dist', 'out', 'release', 'downloads', 'logs', 'tmp', 'temp'].forEach(
    (file) => {
      if (allowGeneratedOutput && ['dist', 'launcher/dist'].includes(file)) {
        if (exists(file)) ok(`generated output allowed for this check: ${file}`);
        return;
      }
      if (exists(file)) warn(`Generated/runtime path is present in source tree: ${file}`);
    },
  );
  const junkFiles = walk('.', (full, relative) => {
    const name = path.basename(relative).toLowerCase();
    return (
      name.endsWith('.log') ||
      name.endsWith('.tmp') ||
      name.endsWith('.part') ||
      name.includes('.part-') ||
      name === '.env'
    );
  });
  if (junkFiles.length) warn(`Runtime/temp files found: ${junkFiles.join(', ')}`);
  else ok('no obvious runtime/temp files');
}

function checkProcessSpawnSafety() {
  const scriptFiles = [
    ...walk('scripts', (full, relative) => /\.js$/.test(relative)),
    ...walk('launcher/scripts', (full, relative) => /\.js$/.test(relative)),
  ];
  const shellSpawnFiles = scriptFiles.filter((file) =>
    /shell\s*:\s*(?:true|process\.platform\s*={2,3}\s*['"]win32['"])/.test(read(file)),
  );
  if (shellSpawnFiles.length)
    fail(
      `Avoid unsafe shell options in release/build helper process spawns: ${shellSpawnFiles.join(', ')}`,
    );
  else ok('release/build helper process spawns avoid unsafe shell options');
}

function checkWorkflows() {
  const workflowDir = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(workflowDir)) {
    fail('Missing .github/workflows.');
    return;
  }
  const workflows = fs
    .readdirSync(workflowDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  if (!workflows.length) fail('No GitHub workflows found.');
  const combined = workflows
    .map((name) => read(path.join('.github/workflows', name)))
    .join('\n---\n');
  if (!/actions\/checkout@v5/.test(combined)) fail('Workflows should use actions/checkout@v5.');
  else ok('workflows use checkout@v5');
  if (!/actions\/setup-node@v5/.test(combined)) fail('Workflows should use actions/setup-node@v5.');
  else ok('workflows use setup-node@v5');
  if (!/npm ci/.test(combined)) fail('Workflows should install dependencies with npm ci.');
  else ok('workflows use npm ci');
  if (!/npm test/.test(combined)) fail('Workflows should run npm test before builds/releases.');
  else ok('workflows run tests');
  if (!/release:local-check/.test(combined))
    fail('Workflows should run release:local-check before release-sensitive builds.');
  else ok('workflows run release sanity check');
  if (!/release:hardening-check/.test(combined))
    warn('Workflows do not call release:hardening-check directly.');
  if (!/VIRUSTOTAL_API_KEY/.test(read('.github/workflows/release.yml')))
    fail('Release workflow is missing VirusTotal upload support.');
  else ok('release workflow has VirusTotal support');
  const releaseWorkflow = read('.github/workflows/release.yml');
  if (!/virustotal-links\.md/.test(releaseWorkflow) || !/release-notes\.md/.test(releaseWorkflow))
    fail('Release workflow should add VirusTotal links to release notes.');
  else ok('release workflow adds VirusTotal links to release notes');
  if (/files:\s*\|[\s\S]*virustotal-links\.(?:md|json)/.test(releaseWorkflow))
    fail('Release workflow should not publish VirusTotal report files as downloads.');
  else ok('release workflow keeps VirusTotal report files out of downloads');
}

checkVersionAndChangelog();
checkStaticFiles();
checkBuildConfig();
checkElectronSecurity();
checkGeneratedJunk();
checkProcessSpawnSafety();
checkWorkflows();

if (warnings.length) {
  console.warn('\nWarnings:');
  for (const message of warnings) console.warn(`- ${message}`);
}

if (errors.length) {
  console.error('\nRelease hardening check failed:');
  for (const message of errors) console.error(`- ${message}`);
  process.exit(1);
}

console.log('\nrelease hardening check complete');
