'use strict';

const fs = require('fs').promises;

const ROBLOX_ID_RE = /\b(\d{5,})\b/;
const RESOLUTION_CACHE_VERSION = 1;
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const BAD_PLACE_TTL_MS = 60 * 60 * 1000;

function cleanString(value) {
  return String(value || '').trim();
}

function cleanName(value, fallback) {
  const cleaned = cleanString(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function parseCreator(value) {
  const text = cleanString(value);
  if (!text) return { creatorType: null, creatorId: null };

  const creatorMatch = text.match(/\b(user|group)\s*[:#-]?\s*(\d+)/i);
  if (creatorMatch) {
    return {
      creatorType: creatorMatch[1].toLowerCase() === 'group' ? 'group' : 'user',
      creatorId: creatorMatch[2],
    };
  }

  return { creatorType: null, creatorId: null };
}

function parseBracketLine(line, assetTypeName) {
  const match = line.match(/^\[([^\]]+)\]\s*\[([^\]]*)\]\s*\[([^\]]+)\]\s*,?$/);
  if (!match) return null;

  const idMatch = cleanString(match[1]).match(ROBLOX_ID_RE);
  if (!idMatch) return null;

  const id = idMatch[1];
  const { creatorType, creatorId } = parseCreator(match[3]);

  return {
    id,
    name: cleanName(match[2], `${assetTypeName} ${id}`),
    creatorType,
    creatorId,
    inputFormat: 'bracket',
  };
}

function parseUrlLine(line, assetTypeName) {
  if (!/^https?:\/\//i.test(line) && !/roblox\.com/i.test(line)) return null;

  const idPatterns = [
    /[?&](?:id|assetId)=([0-9]+)/i,
    /\/store\/asset\/(\d+)/i,
    /\/(?:library|catalog|marketplace|assets?)\/(\d+)/i,
    /\/(\d{5,})(?:[/?#]|$)/,
  ];

  let id = null;
  for (const pattern of idPatterns) {
    const match = line.match(pattern);
    if (match) {
      id = match[1];
      break;
    }
  }
  if (!id) return null;

  let name = `${assetTypeName} ${id}`;
  try {
    const url = new URL(/^https?:\/\//i.test(line) ? line : `https://${line}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const idIndex = parts.findIndex((part) => part === id);
    if (idIndex >= 0 && parts[idIndex + 1]) {
      name = cleanName(decodeURIComponent(parts[idIndex + 1]), name);
    }
  } catch {}

  const { creatorType, creatorId } = parseCreator(line);
  return { id, name, creatorType, creatorId, inputFormat: 'url' };
}

function parseDelimitedLine(line, assetTypeName) {
  if (!/^\s*\d{5,}/.test(line)) return null;
  const parts = line
    .split(/[|,\t]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const idMatch = parts[0].match(ROBLOX_ID_RE);
  if (!idMatch) return null;

  const creatorText = parts.find((part) => /\b(user|group)/i.test(part)) || '';
  const { creatorType, creatorId } = parseCreator(creatorText);

  return {
    id: idMatch[1],
    name: cleanName(parts[1], `${assetTypeName} ${idMatch[1]}`),
    creatorType,
    creatorId,
    inputFormat: 'delimited',
  };
}

function parseRawIdLine(line, assetTypeName) {
  const match = line.match(/^\s*(\d{5,})\s*$/);
  if (!match) return null;
  const id = match[1];
  return {
    id,
    name: `${assetTypeName} ${id}`,
    creatorType: null,
    creatorId: null,
    inputFormat: 'raw-id',
  };
}

function parseAssetTypeDirective(line) {
  const match = cleanString(line).match(
    /^(?:#\s*)?(?:type|asset\s*type|mode)?\s*:?\s*(sound|sounds|audio|animation|animations)\s*$/i,
  );
  if (!match) return null;
  return /sound|audio/i.test(match[1]) ? 'sound' : 'animation';
}

function normalizeAssetEntry(entry, line, lineNumber, assetTypeName) {
  return {
    id: String(entry.id),
    assetId: String(entry.id),
    name: cleanName(entry.name, `${assetTypeName} ${entry.id}`),
    creatorType: entry.creatorType || null,
    creatorId: entry.creatorId ? String(entry.creatorId) : null,
    originalInput: line,
    lineNumber,
    inputFormat: entry.inputFormat || 'unknown',
  };
}

function parseAssetInput(input, options = {}) {
  const assetTypeName = options.assetTypeName || 'Asset';
  const lines = String(input || '')
    .replace(/\r\n/g, '\n')
    .split('\n');

  const entries = [];
  const rejected = [];
  const duplicateEntries = [];
  const seenIds = new Set();
  let declaredAssetType = null;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNumber = index + 1;
    if (!line) return;
    const assetTypeDirective = parseAssetTypeDirective(line);
    if (assetTypeDirective) {
      declaredAssetType = assetTypeDirective;
      return;
    }

    const parsed =
      parseBracketLine(line, assetTypeName) ||
      parseUrlLine(line, assetTypeName) ||
      parseDelimitedLine(line, assetTypeName) ||
      parseRawIdLine(line, assetTypeName);

    if (!parsed || !parsed.id) {
      rejected.push({ lineNumber, input: line, reason: 'Unsupported asset input format.' });
      return;
    }

    const normalized = normalizeAssetEntry(parsed, line, lineNumber, assetTypeName);
    if (seenIds.has(normalized.id)) {
      duplicateEntries.push(normalized);
      return;
    }

    seenIds.add(normalized.id);
    entries.push(normalized);
  });

  const missingCreatorCount = entries.filter(
    (entry) => !entry.creatorType || !entry.creatorId,
  ).length;
  const warnings = [];
  if (missingCreatorCount > 0) {
    warnings.push(
      `${missingCreatorCount} item(s) did not include a User or Group source. The run will use the authenticated account as the source creator fallback.`,
    );
  }
  if (duplicateEntries.length > 0) {
    warnings.push(`${duplicateEntries.length} duplicate item(s) were skipped before processing.`);
  }
  if (rejected.length > 0) {
    warnings.push(`${rejected.length} line(s) could not be parsed and were skipped.`);
  }

  return {
    entries,
    rejected,
    duplicates: duplicateEntries,
    warnings,
    declaredAssetType,
    totalLines: lines.filter((line) => line.trim()).length,
  };
}

function applyDefaultCreator(entries, defaultCreator) {
  const creatorType = defaultCreator && defaultCreator.creatorType;
  const creatorId =
    defaultCreator && defaultCreator.creatorId ? String(defaultCreator.creatorId) : null;
  if (!creatorType || !creatorId) return entries;

  return (entries || []).map((entry) => ({
    ...entry,
    creatorType: entry.creatorType || creatorType,
    creatorId: entry.creatorId || creatorId,
    usedCreatorFallback: !entry.creatorType || !entry.creatorId,
  }));
}

function formatRejectedLines(rejected, maxLines = 8) {
  const items = (rejected || []).slice(0, maxLines);
  const lines = items.map((item) => `Line ${item.lineNumber}: ${item.reason} (${item.input})`);
  if ((rejected || []).length > items.length) {
    lines.push(`...and ${(rejected || []).length - items.length} more invalid line(s).`);
  }
  return lines.join('\n');
}

function formatAssetEntry(entry) {
  if (!entry) return '';
  if (!entry.creatorId)
    return entry.originalInput || `[${entry.id}][${entry.name || `Asset ${entry.id}`}][User]`;
  const creatorPrefix = entry.creatorType === 'group' ? 'Group' : 'User';
  return `[${entry.id}][${entry.name || `Asset ${entry.id}`}][${creatorPrefix}${entry.creatorId}]`;
}

function toPositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function chunkArray(items, chunkSize) {
  const size = Math.max(1, parseInt(chunkSize, 10) || 1);
  const chunks = [];
  for (let index = 0; index < (items || []).length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function groupBatchItemsByCreator(items) {
  const groups = new Map();
  for (const item of items || []) {
    const creatorKey = `${item.creatorType || 'user'}:${item.creatorId || ''}`;
    if (!groups.has(creatorKey)) groups.set(creatorKey, []);
    groups.get(creatorKey).push(item);
  }
  return groups;
}

function getBatchPlan(totalItems, options = {}) {
  const total = Math.max(0, parseInt(totalItems, 10) || 0);
  const requestedChunkSize = parseInt(options.chunkSize, 10);
  let chunkSize;
  if (Number.isFinite(requestedChunkSize) && requestedChunkSize > 0) {
    chunkSize = requestedChunkSize;
  } else if (total >= 500) {
    chunkSize = 8;
  } else if (total >= 150) {
    chunkSize = 10;
  } else if (total >= 50) {
    chunkSize = 15;
  } else {
    chunkSize = 20;
  }
  const safeChunkSize = Math.max(1, Math.min(chunkSize, 25));
  return {
    chunkSize: safeChunkSize,
    maxChunkSize: 25,
    creatorDelayMs: total >= 250 ? 750 : 350,
    metadataConcurrency: total >= 500 ? 4 : total >= 150 ? 3 : 2,
    downloadConcurrencyCap: total >= 500 ? 8 : total >= 150 ? 10 : 12,
    uploadConcurrencyCap: total >= 250 ? 6 : total >= 75 ? 8 : 10,
    splitOnFailure: true,
  };
}

function buildBatchItems(entries, assetTypeName) {
  return (entries || []).map((entry) => ({
    requestId: String(entry.id),
    assetId: parseInt(entry.id, 10),
    assetType: assetTypeName,
    creatorType: entry.creatorType,
    creatorId: entry.creatorId,
  }));
}

function nowMs() {
  return Date.now();
}

function isFreshTimestamp(value, ttlMs) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && nowMs() - time >= 0 && nowMs() - time <= ttlMs;
}

function getRawErrorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || error.raw || error.body || JSON.stringify(error);
}

function buildResolutionKey(assetTypeName, entry) {
  return `${assetTypeName || 'Asset'}:${entry.creatorType || 'user'}:${entry.creatorId || ''}:${String(entry.id)}`;
}

function buildCreatorKeyFromEntry(entry) {
  return `${entry.creatorType || 'user'}:${entry.creatorId || ''}`;
}

function normalizeResolutionCache(cache) {
  if (!cache || typeof cache !== 'object' || cache.version !== RESOLUTION_CACHE_VERSION) {
    return {
      version: RESOLUTION_CACHE_VERSION,
      updatedAt: new Date().toISOString(),
      locations: {},
      creators: {},
    };
  }
  cache.locations = cache.locations && typeof cache.locations === 'object' ? cache.locations : {};
  cache.creators = cache.creators && typeof cache.creators === 'object' ? cache.creators : {};
  return cache;
}

async function loadAssetResolutionCache(cachePath) {
  if (!cachePath) return normalizeResolutionCache(null);
  try {
    return normalizeResolutionCache(JSON.parse(await fs.readFile(cachePath, 'utf8')));
  } catch {
    return normalizeResolutionCache(null);
  }
}

async function saveAssetResolutionCache(cachePath, cache, options = {}) {
  if (!cachePath) return;
  try {
    const normalized = normalizeResolutionCache(cache);
    normalized.updatedAt = new Date().toISOString();
    await fs.writeFile(cachePath, JSON.stringify(normalized, null, 2));
  } catch (err) {
    if (typeof options.onError === 'function') options.onError(err);
  }
}

function getFreshCachedLocation(cache, assetTypeName, entry, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : LOCATION_CACHE_TTL_MS;
  const cached =
    normalizeResolutionCache(cache).locations[buildResolutionKey(assetTypeName, entry)];
  if (!cached || cached.status !== 'success') return null;
  if (!isFreshTimestamp(cached.resolvedAt, ttlMs)) return null;
  if (!cached.location || !cached.location.locations || !cached.location.locations.length)
    return null;
  return cached.location;
}

function rememberCachedLocation(cache, assetTypeName, entry, location, placeId) {
  if (!entry || !location || !location.locations || !location.locations.length) return;
  const normalized = normalizeResolutionCache(cache);
  normalized.locations[buildResolutionKey(assetTypeName, entry)] = {
    status: 'success',
    source: 'roblox_assetdelivery',
    assetType: assetTypeName || 'Asset',
    creatorType: entry.creatorType || 'user',
    creatorId: String(entry.creatorId || ''),
    assetId: String(entry.id),
    placeId: placeId ? String(placeId) : null,
    resolvedAt: new Date().toISOString(),
    location,
  };
}

function getCreatorCache(cache, creatorKey) {
  const normalized = normalizeResolutionCache(cache);
  if (!normalized.creators[creatorKey]) {
    normalized.creators[creatorKey] = {
      lastGoodPlaceId: null,
      badPlaceIds: {},
      updatedAt: new Date().toISOString(),
    };
  }
  const creator = normalized.creators[creatorKey];
  creator.badPlaceIds =
    creator.badPlaceIds && typeof creator.badPlaceIds === 'object' ? creator.badPlaceIds : {};
  return creator;
}

function rememberGoodPlaceId(cache, creatorKey, placeId) {
  if (!creatorKey || !placeId) return;
  const creator = getCreatorCache(cache, creatorKey);
  creator.lastGoodPlaceId = String(placeId);
  delete creator.badPlaceIds[String(placeId)];
  creator.updatedAt = new Date().toISOString();
}

function rememberBadPlaceId(cache, creatorKey, placeId, error, options = {}) {
  if (!creatorKey || !placeId) return;
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : BAD_PLACE_TTL_MS;
  const creator = getCreatorCache(cache, creatorKey);
  creator.badPlaceIds[String(placeId)] = {
    failedAt: new Date().toISOString(),
    expiresAt: new Date(nowMs() + ttlMs).toISOString(),
    error: getRawErrorText(error).slice(0, 500),
  };
  creator.updatedAt = new Date().toISOString();
}

function orderPlaceIdsWithCache(cache, creatorKey, placeIds) {
  const rawPlaceIds = (Array.isArray(placeIds) ? placeIds : [placeIds]).filter(Boolean).map(String);
  const creator = getCreatorCache(cache, creatorKey);
  const good = creator.lastGoodPlaceId ? String(creator.lastGoodPlaceId) : null;
  const activeBad = new Set();
  for (const [placeId, info] of Object.entries(creator.badPlaceIds || {})) {
    const expiresAt = Date.parse((info && info.expiresAt) || '');
    if (Number.isFinite(expiresAt) && expiresAt > nowMs()) activeBad.add(String(placeId));
    else delete creator.badPlaceIds[placeId];
  }
  const ordered = [];
  if (good && rawPlaceIds.includes(good) && !activeBad.has(good)) ordered.push(good);
  for (const placeId of rawPlaceIds) {
    if (!ordered.includes(placeId) && !activeBad.has(placeId)) ordered.push(placeId);
  }
  if (ordered.length === 0) ordered.push(...rawPlaceIds);
  return ordered;
}

module.exports = {
  BAD_PLACE_TTL_MS,
  LOCATION_CACHE_TTL_MS,
  RESOLUTION_CACHE_VERSION,
  applyDefaultCreator,
  buildBatchItems,
  buildCreatorKeyFromEntry,
  buildResolutionKey,
  chunkArray,
  cleanName,
  cleanString,
  formatAssetEntry,
  formatRejectedLines,
  getBatchPlan,
  getFreshCachedLocation,
  groupBatchItemsByCreator,
  isFreshTimestamp,
  loadAssetResolutionCache,
  normalizeResolutionCache,
  orderPlaceIdsWithCache,
  parseAssetTypeDirective,
  parseAssetInput,
  parseCreator,
  rememberBadPlaceId,
  rememberCachedLocation,
  rememberGoodPlaceId,
  saveAssetResolutionCache,
  toPositiveInteger,
};
