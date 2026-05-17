'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const changelogPath = path.join(root, 'CHANGELOG.md');
const outDir = path.join(root, 'dist');
const outPath = path.join(outDir, 'release-notes.md');

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^refs\/tags\//, '').replace(/^v/i, '');
}

function getVersion() {
  const ref = process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || '';
  const fromRef = normalizeVersion(ref);
  if (fromRef) return fromRef;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return normalizeVersion(pkg.version);
}

function extractSection(markdown, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##\\s+v?${escaped}\\s*$`, 'im');
  const match = markdown.match(heading);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

const version = getVersion();
const changelog = fs.readFileSync(changelogPath, 'utf8');
const section = extractSection(changelog, version);

if (!section) {
  throw new Error(`No changelog section found for v${version}. Add a "## v${version}" section to CHANGELOG.md.`);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, `# ISpooferMotion v${version}\n\n${section}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outPath)}`);
