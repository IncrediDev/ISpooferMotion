'use strict';

const fs = require('fs');
const path = require('path');

function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
  return value;
}

function mergeDefaults(defaults, value) {
  const base = typeof defaults === 'function' ? defaults() : { ...(defaults || {}) };
  return { ...base, ...(value && typeof value === 'object' ? value : {}) };
}

function createConfigStore({ file, defaults = {}, normalize = null, migrate = null }) {
  if (!file) throw new Error('createConfigStore requires a file path.');

  function load() {
    const raw = readJsonFile(file, null);
    const migrated = migrate ? migrate(raw) : raw;
    const merged = mergeDefaults(defaults, migrated);
    return normalize ? normalize(merged) : merged;
  }

  function ensure() {
    const value = load();
    if (!fs.existsSync(file)) writeJsonFile(file, value);
    return value;
  }

  function save(next) {
    const current = load();
    const merged = mergeDefaults(defaults, { ...current, ...(next || {}) });
    const normalized = normalize ? normalize(merged) : merged;
    writeJsonFile(file, normalized);
    return load();
  }

  return { file, load, ensure, save };
}

function createLauncherSettingsDefaults(now = new Date().toISOString()) {
  return {
    configVersion: 1,
    allowForkBuilds: false,
    silentLauncher: false,
    updatedAt: now,
  };
}

function normalizeLauncherSettings(settings = {}) {
  return {
    configVersion: 1,
    allowForkBuilds: Boolean(settings.allowForkBuilds),
    silentLauncher: Boolean(settings.silentLauncher),
    updatedAt: settings.updatedAt || new Date().toISOString(),
  };
}

function createLauncherSettingsStore(file) {
  return createConfigStore({
    file,
    defaults: createLauncherSettingsDefaults,
    normalize: normalizeLauncherSettings,
  });
}

module.exports = {
  readJsonFile,
  writeJsonFile,
  createConfigStore,
  createLauncherSettingsDefaults,
  normalizeLauncherSettings,
  createLauncherSettingsStore,
};
