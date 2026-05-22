'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const outPath = path.join(outDir, `ISpooferMotion-Plugin-${version}.rbxmx`);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function guid(name) {
  return `RBX_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function propString(name, value) {
  return `<string name="${name}">${escapeXml(value)}</string>`;
}

function propBool(name, value) {
  return `<bool name="${name}">${value ? 'true' : 'false'}</bool>`;
}

function sourceProp(value) {
  return `<ProtectedString name="Source">${escapeXml(value)}</ProtectedString>`;
}

function item(className, ref, props, children = '') {
  return `
  <Item class="${className}" referent="${guid(ref)}">
    <Properties>
      ${props.join('\n      ')}
    </Properties>
    ${children}
  </Item>`;
}

function scriptItem(className, ref, name, source, disabled = false) {
  return item(className, ref, [
    propBool('Disabled', disabled),
    '<Content name="LinkedSource"><null></null></Content>',
    propString('Name', name),
    sourceProp(source),
  ]);
}

fs.mkdirSync(outDir, { recursive: true });

const pluginSource = fs
  .readFileSync(path.join(root, 'src', 'plugin', 'plugin.lua'), 'utf8')
  .replace(/__ISPOOFERMOTION_VERSION__/g, version);
const getIdsFactorySource = fs.readFileSync(
  path.join(root, 'src', 'plugin', 'modules', 'GetIdsUIFactory.lua'),
  'utf8',
);
const replaceIdsFactorySource = fs.readFileSync(
  path.join(root, 'src', 'plugin', 'modules', 'ReplaceIdsUIFactory.lua'),
  'utf8',
);

const mainScript = scriptItem(
  'Script',
  'ISpooferMotionPlugin',
  'ISpooferMotion',
  pluginSource,
  false,
);
const assetsFolder = item(
  'Folder',
  'Assets',
  [propString('Name', 'Assets')],
  scriptItem('ModuleScript', 'GetIdsUIFactory', 'GetIdsUIFactory', getIdsFactorySource, false) +
    scriptItem(
      'ModuleScript',
      'ReplaceIdsUIFactory',
      'ReplaceIdsUIFactory',
      replaceIdsFactorySource,
      false,
    ),
);

const xml = `<?xml version="1.0" encoding="utf-8"?>
<roblox version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Folder" referent="${guid('Root')}">
    <Properties>
      ${propString('Name', 'ISpooferMotion')}
    </Properties>
    ${mainScript}
    ${assetsFolder}
  </Item>
</roblox>
`;

fs.writeFileSync(outPath, xml, 'utf8');
console.log(`Built Roblox Studio plugin: ${outPath}`);
