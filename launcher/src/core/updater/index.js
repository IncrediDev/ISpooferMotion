'use strict';

// Launcher update helpers. Kept inside launcher/src because the launcher has to work on its own after packaging.

const DEFAULT_RELEASE_SOURCE_ID = 'official';

function normalizeReleaseSourceId(sourceId, sources, defaultSourceId = DEFAULT_RELEASE_SOURCE_ID) {
  const id = String(sourceId || '')
    .trim()
    .toLowerCase();
  return sources && sources[id] ? id : defaultSourceId;
}

function getReleaseSource(sources, sourceId = null, defaultSourceId = DEFAULT_RELEASE_SOURCE_ID) {
  return sources[normalizeReleaseSourceId(sourceId, sources, defaultSourceId)];
}

function getReleaseApiUrl(source) {
  if (!source || !source.owner || !source.repo) throw new Error('Invalid release source.');
  return `https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`;
}

function getSourceDisplayName(source) {
  return `${source.label} - ${source.owner}/${source.repo}`;
}

const VERSION_PATTERN = /v?\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?/i;

function getVersionFromNameOrTag(value) {
  const match = String(value || '').match(VERSION_PATTERN);
  if (!match) return null;
  return /^v/i.test(match[0]) ? match[0] : `v${match[0]}`;
}

function getMetadataRevision(value, isPrerelease = false) {
  const metadata = String(value || '').trim().toLowerCase();
  if (!metadata) return 0;

  const namedRevision = metadata.match(
    /(?:^|[.-])(?:hotfix|hf|patch|rev|revision|build)[.-]?(\d+)?(?:$|[.-])/,
  );
  if (namedRevision) return Number(namedRevision[1] || 1);

  if (/^\d+$/.test(metadata)) return Number(metadata);
  return isPrerelease ? -1 : 0;
}

function parseVersionParts(value) {
  const match = String(value || '').match(
    /v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+([0-9A-Za-z][0-9A-Za-z.-]*))?/i,
  );
  if (!match) return null;
  const parts = match.slice(1, 4).map((part) => Number(part));
  parts.push(getMetadataRevision(match[5]) || getMetadataRevision(match[4], true));
  return parts;
}

function compareVersions(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 4; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function isSetupOrInstallerAssetName(name) {
  const lower = String(name || '').toLowerCase();
  return /(^|[._\-\s])(setup|installer|install)([._\-\s]|$)/i.test(lower) || lower.includes('nsis');
}

function isLauncherAssetName(name) {
  const lower = String(name || '').toLowerCase();
  return lower.includes('launcher') || lower === 'ispoofermotion-setup.exe';
}

function scoreReleaseAsset(name) {
  const lower = String(name || '').toLowerCase();
  let score = 0;
  if (/\.exe$/i.test(lower)) score += 80;
  if (/\.zip$/i.test(lower)) score += 60;
  if (lower.includes('portable')) score += 45;
  if (lower.includes('app')) score += 35;
  if (lower.includes('ispoofermotion')) score += 60;
  if (lower.includes('ispoofer')) score += 35;
  if (lower.includes('motion')) score += 20;
  if (lower.includes('win') || lower.includes('windows')) score += 10;
  if (isSetupOrInstallerAssetName(lower) || isLauncherAssetName(lower)) score -= 1000;
  return score;
}

function chooseWindowsAppAsset(assets) {
  const candidates = (assets || []).filter((asset) => {
    if (!asset || !asset.browser_download_url || !asset.name) return false;
    const name = String(asset.name);
    if (/\.yml$|\.blockmap$|\.rbxmx$/i.test(name)) return false;
    if (/mac|darwin|linux/i.test(name)) return false;
    if (!/\.(exe|zip)$/i.test(name)) return false;
    if (isLauncherAssetName(name) || isSetupOrInstallerAssetName(name)) return false;
    return /win|windows|app|portable|ispoofer|motion/i.test(name);
  });

  candidates.sort((a, b) => scoreReleaseAsset(b.name) - scoreReleaseAsset(a.name));
  return candidates[0] || null;
}

function scoreLauncherAsset(name) {
  const lower = String(name || '').toLowerCase();
  let score = 0;
  if (lower === 'ispoofermotion-setup.exe') score += 200;
  if (lower.includes('launcher')) score += 120;
  if (lower.includes('ispoofermotion')) score += 80;
  if (lower.includes('setup') || lower.includes('installer')) score += 60;
  if (/\.exe$/i.test(lower)) score += 30;
  if (lower.includes('app') || lower.includes('portable')) score -= 100;
  return score;
}

function chooseWindowsLauncherAsset(assets) {
  const candidates = (assets || []).filter((asset) => {
    if (!asset || !asset.browser_download_url || !asset.name) return false;
    const name = String(asset.name);
    if (!/\.exe$/i.test(name)) return false;
    if (/mac|darwin|linux|blockmap|\.yml$/i.test(name)) return false;
    const lower = name.toLowerCase();
    return lower === 'ispoofermotion-setup.exe' || lower.includes('launcher');
  });

  candidates.sort((a, b) => scoreLauncherAsset(b.name) - scoreLauncherAsset(a.name));
  return candidates[0] || null;
}

function scorePluginAsset(name) {
  const lower = String(name || '').toLowerCase();
  let score = 0;
  if (lower.includes('plugin')) score += 60;
  if (lower.includes('ispoofermotion')) score += 40;
  if (lower.includes('ispoofer')) score += 20;
  return score;
}

function chooseRobloxPluginAsset(assets) {
  const candidates = (assets || []).filter((asset) => {
    if (!asset || !asset.browser_download_url || !asset.name) return false;
    return /\.rbxmx$/i.test(String(asset.name));
  });
  candidates.sort((a, b) => scorePluginAsset(b.name) - scorePluginAsset(a.name));
  return candidates[0] || null;
}

function getReleaseCacheKey(source) {
  return `${source.owner}/${source.repo}`.toLowerCase();
}

function createReleaseCacheStore({
  readJson,
  writeJson,
  cacheFile,
  maxAgeMs,
  requestJson,
  getReleaseUrl = getReleaseApiUrl,
  onCacheHit = null,
}) {
  if (
    typeof readJson !== 'function' ||
    typeof writeJson !== 'function' ||
    typeof requestJson !== 'function'
  ) {
    throw new Error(
      'createReleaseCacheStore requires readJson, writeJson, and requestJson functions.',
    );
  }

  function readCache() {
    return readJson(cacheFile, {});
  }

  function writeCache(cache) {
    writeJson(cacheFile, cache || {});
  }

  async function requestLatestRelease(source, options = {}) {
    const cache = readCache();
    const key = getReleaseCacheKey(source);
    const cached = cache[key];
    const now = Date.now();
    if (
      !options.forceRefresh &&
      cached &&
      cached.release &&
      now - Number(cached.savedAt || 0) < maxAgeMs
    ) {
      if (onCacheHit) onCacheHit(cached.release, source);
      return cached.release;
    }
    const release = await requestJson(getReleaseUrl(source));
    cache[key] = { savedAt: now, release };
    writeCache(cache);
    return release;
  }

  return { readCache, writeCache, requestLatestRelease };
}

function shouldSelfUpdateLauncher({
  release,
  launcherAsset,
  currentVersion,
  isDev = false,
  isPackaged = false,
  platform = process.platform,
  forceRepair = false,
}) {
  if (isDev || !isPackaged || platform !== 'win32') return false;
  if (!launcherAsset) return false;
  if (forceRepair) return true;
  const releaseVersion = getVersionFromNameOrTag(
    (release && (release.tag_name || release.name)) || '',
  );
  if (!releaseVersion) return false;
  return compareVersions(releaseVersion, currentVersion) > 0;
}

module.exports = {
  DEFAULT_RELEASE_SOURCE_ID,
  normalizeReleaseSourceId,
  getReleaseSource,
  getReleaseApiUrl,
  getSourceDisplayName,
  getVersionFromNameOrTag,
  parseVersionParts,
  compareVersions,
  isSetupOrInstallerAssetName,
  isLauncherAssetName,
  scoreReleaseAsset,
  chooseWindowsAppAsset,
  scoreLauncherAsset,
  chooseWindowsLauncherAsset,
  scorePluginAsset,
  chooseRobloxPluginAsset,
  getReleaseCacheKey,
  createReleaseCacheStore,
  shouldSelfUpdateLauncher,
};
