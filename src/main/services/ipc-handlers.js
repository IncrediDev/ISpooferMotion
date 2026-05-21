const path = require('path');
const { ipcMain, app, dialog, clipboard } = require('electron');
const crypto = require('crypto');
const {
  DEVELOPER_MODE,
  buildRobloxCookieHeader,
  clearDownloadsDirectory,
  retryAsync,
  sanitizeFilename,
  sanitizeLogMessage,
  getCurrentLogFilePath,
  getLatestLogFilePath,
  readTextFileTail,
} = require('./common');
const {
  getCookieFromRobloxStudio,
  getPlaceIdFromCreator,
  getAuthenticatedUserId,
} = require('./roblox-api');
const {
  downloadAnimationAssetWithProgress,
  publishAnimationRbxmWithProgress,
} = require('./transfer-handlers');
const { runQueue } = require('../../core/queue');
const { animationGrabberTask } = require('../../features/animation-grabber/task');
const { soundGrabberTask } = require('../../features/sound-grabber/task');
const {
  applyDefaultCreator,
  formatRejectedLines,
  parseAssetInput,
  parseAssetTypeDirective,
} = require('../../core/assets');
const {
  formatAssetEntry,
  getFreshCachedLocation,
  loadAssetResolutionCache: loadAssetResolutionCacheFromPath,
  orderPlaceIdsWithCache,
  rememberBadPlaceId,
  rememberCachedLocation,
  rememberGoodPlaceId,
  saveAssetResolutionCache: saveAssetResolutionCacheToPath,
} = require('../../core/assets');
const {
  buildBatchItems,
  chunkArray,
  createBatchLocationFailure,
  createStageFailure,
  createStageSuccess,
  getBatchPlan,
  getLocationErrorText,
  groupBatchItemsByCreator,
  summarizeStageFailures,
  classifyAssetError,
  retryDelayWithJitter,
  toPositiveInteger,
} = require('./asset-pipeline');
const fs = require('fs').promises;
const {
  buildAppDebugInfo,
  buildSupportReport,
  formatSupportReportText,
} = require('../../core/reports');
const { createBufferedSessionSaver, createSessionStore } = require('../../core/session');
const {
  assetHistoryToRows,
  buildHistoryKey,
  clearAssetHistory: clearAssetHistoryFromPath,
  readAssetHistory,
  rememberAssetMappingInObject,
  writeAssetHistory,
} = require('../../core/assets/history');
let _isPaused = false;
let _isCancelled = false;
let _pauseResolvers = [];
let _runAbortController = null;
function pauseSpoofer() {
  _isPaused = true;
}
function resumeSpoofer() {
  _isPaused = false;
  _pauseResolvers.splice(0).forEach((r) => r());
}
function cancelSpoofer() {
  _isCancelled = true;
  if (_runAbortController) _runAbortController.abort();
  resumeSpoofer();
}
function resetRunControls() {
  _isPaused = false;
  _isCancelled = false;
  _runAbortController = null;
  _pauseResolvers.splice(0).forEach((r) => r());
}
function beginRunControls() {
  resetRunControls();
  _runAbortController = new AbortController();
  return _runAbortController.signal;
}
async function checkPaused() {
  if (_isPaused) await new Promise((resolve) => _pauseResolvers.push(resolve));
}
function checkCancelled() {
  if (_isCancelled) {
    const err = new Error('Run canceled by user.');
    err.code = 'SPOOFER_CANCELLED';
    throw err;
  }
}
function isCancelError(err) {
  return (
    err &&
    (err.code === 'SPOOFER_CANCELLED' ||
      err.code === 'QUEUE_CANCELLED' ||
      err.code === 'ABORT_ERR' ||
      err.name === 'QueueCancelledError')
  );
}

const DEFAULT_PLACE_ID_CANDIDATES = Object.freeze([99840799534728]);

function normalizeCreatorKey(creatorType, creatorId) {
  return `${creatorType || 'user'}:${creatorId ? String(creatorId) : ''}`;
}

function normalizePlaceIdCandidates(placeIds, options = {}) {
  const includeDefaults = options.includeDefaults !== false;
  const raw = Array.isArray(placeIds) ? placeIds : placeIds ? [placeIds] : [];
  const values = includeDefaults ? [...raw, ...DEFAULT_PLACE_ID_CANDIDATES] : raw;
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const id = String(value || '').trim();
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized.length > 0 ? normalized : DEFAULT_PLACE_ID_CANDIDATES.map(String);
}

async function waitForRunDelay(ms, stepMs = 250) {
  const endAt = Date.now() + Math.max(0, Number(ms) || 0);
  while (Date.now() < endAt) {
    checkCancelled();
    await checkPaused();
    checkCancelled();
    await delay(Math.min(Math.max(1, stepMs), endAt - Date.now()));
  }
  checkCancelled();
}
function getSessionPath() {
  return path.join(app.getPath('userData'), 'ispoofer_session.json');
}
function getSessionStore() {
  return createSessionStore({
    fs,
    sessionPath: getSessionPath(),
    onError: (err, action) => {
      if (DEVELOPER_MODE) console.warn(`(Dev) Failed to ${action} session:`, err.message);
    },
  });
}
async function saveSession(session) {
  await getSessionStore().save(session);
}
async function loadSession() {
  return getSessionStore().load();
}
async function clearSession() {
  await getSessionStore().clear();
}
function getAssetHistoryPath() {
  return path.join(app.getPath('userData'), 'ispoofer_asset_history.json');
}
async function loadAssetHistory() {
  return readAssetHistory(fs, getAssetHistoryPath());
}
async function saveAssetHistory(history) {
  return writeAssetHistory(fs, getAssetHistoryPath(), history, (err) => {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to save asset history:', err.message);
  });
}
async function clearAssetHistory() {
  return clearAssetHistoryFromPath(fs, getAssetHistoryPath());
}
function getAssetResolutionCachePath() {
  return path.join(app.getPath('userData'), 'ispoofer_asset_resolution_cache.json');
}

async function loadAssetResolutionCache() {
  return loadAssetResolutionCacheFromPath(getAssetResolutionCachePath());
}

async function saveAssetResolutionCache(cache) {
  return saveAssetResolutionCacheToPath(getAssetResolutionCachePath(), cache, {
    onError: (err) => {
      if (DEVELOPER_MODE) console.warn('(Dev) Failed to save asset resolution cache:', err.message);
    },
  });
}

function createCompletedDownloadResult(entry, completed) {
  return createStageSuccess(entry, 'download', {
    filePath: completed.filePath,
    cached: true,
    resumed: true,
    error: '',
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, label = 'request') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new Error(`${label} timed out after ${Math.max(1000, timeoutMs)}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonWithTimeout(response, timeoutMs = 10000, label = 'response') {
  let timeout;
  try {
    return await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`${label} JSON read timed out after ${Math.max(1000, timeoutMs)}ms`)),
          Math.max(1000, timeoutMs),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRobloxAvatarDataUrl(userId) {
  const thumbResponse = await fetchWithTimeout(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(userId)}&size=100x100&format=Png&isCircular=false`,
    { headers: { 'User-Agent': 'ISpooferMotion' } },
    10000,
    'Roblox avatar thumbnail request',
  );
  if (!thumbResponse.ok) return '';
  const thumbData = await readJsonWithTimeout(
    thumbResponse,
    8000,
    'Roblox avatar thumbnail response',
  );
  const imageUrl = thumbData && thumbData.data && thumbData.data[0] && thumbData.data[0].imageUrl;
  if (!imageUrl) return '';

  const imageResponse = await fetchWithTimeout(
    imageUrl,
    { headers: { 'User-Agent': 'ISpooferMotion' } },
    12000,
    'Roblox avatar image request',
  );
  if (!imageResponse.ok) return '';
  const contentType = imageResponse.headers.get('content-type') || 'image/png';
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length) return '';
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

async function fetchRobloxImageDataUrl(imageUrl, label = 'Roblox image request') {
  if (!imageUrl) return '';
  const imageResponse = await fetchWithTimeout(
    imageUrl,
    { headers: { 'User-Agent': 'ISpooferMotion' } },
    12000,
    label,
  );
  if (!imageResponse.ok) return '';
  const contentType = imageResponse.headers.get('content-type') || 'image/png';
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length) return '';
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

async function fetchRobloxGroupDetails(groupId) {
  const cleanGroupId = String(groupId || '').replace(/\D/g, '');
  if (!cleanGroupId) return { name: '', iconDataUrl: '' };

  const [details, iconDataUrl] = await Promise.all([
    fetchWithTimeout(
      `https://groups.roblox.com/v1/groups/${encodeURIComponent(cleanGroupId)}`,
      { headers: { 'User-Agent': 'ISpooferMotion' } },
      10000,
      'Roblox group details request',
    )
      .then(async (response) => {
        if (!response.ok) return {};
        return await readJsonWithTimeout(response, 8000, 'Roblox group details response');
      })
      .catch(() => ({})),
    fetchWithTimeout(
      `https://thumbnails.roblox.com/v1/groups/icons?groupIds=${encodeURIComponent(cleanGroupId)}&size=150x150&format=Png&isCircular=false`,
      { headers: { 'User-Agent': 'ISpooferMotion' } },
      10000,
      'Roblox group icon request',
    )
      .then(async (response) => {
        if (!response.ok) return '';
        const thumbData = await readJsonWithTimeout(response, 8000, 'Roblox group icon response');
        const imageUrl =
          thumbData && thumbData.data && thumbData.data[0] && thumbData.data[0].imageUrl;
        return fetchRobloxImageDataUrl(imageUrl, 'Roblox group icon image request');
      })
      .catch(() => ''),
  ]);

  return {
    name: details && details.name ? String(details.name) : '',
    iconDataUrl,
  };
}

async function getRobloxProfileForRenderer(data = {}) {
  let cookie = data.cookie || '';
  if (!cookie && data.autoDetect) {
    cookie = await getCookieFromRobloxStudio();
  }

  const cookieHeader = buildRobloxCookieHeader(cookie);
  if (!cookieHeader) {
    return { ok: false, username: 'Not connected', displayName: '', userId: '', avatarDataUrl: '' };
  }

  const response = await fetchWithTimeout(
    'https://users.roblox.com/v1/users/authenticated',
    { headers: { Cookie: cookieHeader, 'User-Agent': 'RobloxStudio/WinInet' } },
    10000,
    'Roblox profile request',
  );

  if (!response.ok) {
    return { ok: false, username: 'Not connected', displayName: '', userId: '', avatarDataUrl: '' };
  }

  const profile = await readJsonWithTimeout(response, 8000, 'Roblox profile response');
  const userId = profile && profile.id ? String(profile.id) : '';
  const [avatarDataUrl, groupDetails] = await Promise.all([
    userId ? fetchRobloxAvatarDataUrl(userId).catch(() => '') : '',
    data.groupId
      ? fetchRobloxGroupDetails(data.groupId).catch(() => ({ name: '', iconDataUrl: '' }))
      : { name: '', iconDataUrl: '' },
  ]);
  return {
    ok: Boolean(userId),
    username: profile && profile.name ? String(profile.name) : 'Roblox user',
    displayName: profile && profile.displayName ? String(profile.displayName) : '',
    userId,
    avatarDataUrl,
    groupName: groupDetails.name || '',
    groupIconDataUrl: groupDetails.iconDataUrl || '',
  };
}

async function ensureWritableFolder(folderPath) {
  if (!folderPath || !String(folderPath).trim()) {
    throw new Error('No folder path provided.');
  }
  const resolved = String(folderPath).trim();
  await fs.mkdir(resolved, { recursive: true });
  const testFile = path.join(
    resolved,
    `.ispoofer-write-test-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  await fs.writeFile(testFile, 'test');
  await fs.unlink(testFile).catch(() => {});
  return resolved;
}

function formatPreflightResult(issues, warnings) {
  const issueLines = (issues || []).map((issue) => `• ${issue}`);
  const warningLines = (warnings || []).map((warning) => `• ${warning}`);
  const sections = [];
  if (issueLines.length) {
    sections.push(`Preflight failed. Fix these before running:
${issueLines.join('\n')}`);
  }
  if (warningLines.length) {
    sections.push(`Preflight warnings. You can continue, but these may cause failures:
${warningLines.join('\n')}`);
  }
  if (!sections.length) return 'Preflight complete. Ready to run.';
  const nextStep = issueLines.length
    ? 'Next step: fix the items above, then run again.'
    : 'Tip: if this is a large batch, lower concurrency if Roblox starts rate-limiting requests.';
  return `${sections.join('\n\n')}\n\n${nextStep}`;
}

function getAudioQuotaRemaining(quotaData) {
  if (!quotaData || typeof quotaData !== 'object') return null;
  if (Array.isArray(quotaData.quotas)) {
    const monthQuota =
      quotaData.quotas.find((q) => String(q.duration || '').toLowerCase() === 'month') ||
      quotaData.quotas[0];
    if (
      monthQuota &&
      Number.isFinite(Number(monthQuota.capacity)) &&
      Number.isFinite(Number(monthQuota.usage))
    ) {
      return Math.max(0, Number(monthQuota.capacity) - Number(monthQuota.usage));
    }
  }
  if (quotaData.usage && Number.isFinite(Number(quotaData.usage.remainingQuota))) {
    return Number(quotaData.usage.remainingQuota);
  }
  return null;
}

async function fetchAudioQuotaForPreflight(robloxCookie) {
  const cookieHeader = buildRobloxCookieHeader(robloxCookie);
  if (!cookieHeader) throw new Error('Missing or invalid ROBLOSECURITY cookie');
  const response = await fetchWithTimeout(
    'https://publish.roblox.com/v1/asset-quotas?resourceType=RateLimitUpload&assetType=Audio',
    {
      headers: {
        Cookie: cookieHeader,
        'User-Agent': 'RobloxStudio/WinInet',
      },
    },
    10000,
    'Audio quota check',
  );
  if (!response.ok) {
    throw new Error(`Audio quota check failed (${response.status})`);
  }
  return await readJsonWithTimeout(response, 10000, 'Audio quota response');
}

async function runBasicPreflightChecks({
  data,
  assetEntries,
  isSoundMode,
  downloadsDir,
  robloxCookie,
}) {
  const issues = [];
  const warnings = [];
  let authenticatedUserId = null;

  if (!assetEntries || assetEntries.length === 0) {
    issues.push(`No valid ${isSoundMode ? 'sound' : 'animation'} entries were found.`);
  }

  if (!data.downloadOnly && !data.enableSpoofing) {
    issues.push(
      'Enable Spoofing is off and Download-Only mode is also off. Pick at least one mode.',
    );
  }

  if (data.downloadOnly && (!data.downloadFolder || !String(data.downloadFolder).trim())) {
    issues.push('Download-Only mode needs a download folder.');
  }

  if (!data.downloadOnly && !data.apiKey) {
    issues.push('Uploads need an Open Cloud API key.');
  } else if (!data.downloadOnly) {
    const apiKey = String(data.apiKey || '').trim();
    if (apiKey.length < 20 || /\s/.test(apiKey)) {
      issues.push(
        'Open Cloud API key looks invalid. Paste the full key with no spaces or line breaks.',
      );
    }
  }

  if (data.groupId && !/^\d+$/.test(String(data.groupId).trim())) {
    issues.push('Group ID must be numbers only.');
  }

  if (data.overridePlaceId && !/^\d+$/.test(String(data.overridePlaceId).trim())) {
    issues.push('Override Place ID must be numbers only.');
  }

  try {
    await ensureWritableFolder(downloadsDir);
  } catch (err) {
    issues.push(`Output/download folder is not writable: ${err.message}`);
  }

  try {
    authenticatedUserId = await getAuthenticatedUserId(robloxCookie);
  } catch (err) {
    const classified = classifyError(err, { stage: 'preflight' });
    if (classified.category === 'bad_cookie') {
      issues.push(`Cookie check failed: ${classified.message}`);
    } else {
      warnings.push(
        `Cookie could not be fully verified before the run: ${classified.message}. The run will still try asset access and report per-item failures.`,
      );
    }
  }

  if (!data.downloadOnly && isSoundMode && robloxCookie) {
    try {
      const quotaData = await fetchAudioQuotaForPreflight(robloxCookie);
      const remaining = getAudioQuotaRemaining(quotaData);
      if (remaining !== null && assetEntries.length > remaining) {
        warnings.push(
          `Audio quota may be too low for this run. Remaining: ${remaining}, requested: ${assetEntries.length}. The run will continue and report upload failures per item if Roblox blocks them.`,
        );
      } else if (remaining !== null && remaining - assetEntries.length <= 5) {
        warnings.push(
          `Audio quota will be almost empty after this run. Remaining after run: ${Math.max(0, remaining - assetEntries.length)}.`,
        );
      }
    } catch (err) {
      warnings.push(
        `Audio quota could not be checked before the run: ${classifyError(err, { stage: 'preflight' }).message}`,
      );
    }
  }

  if (assetEntries && assetEntries.length > 100) {
    warnings.push(
      `Large batch detected (${assetEntries.length} items). If Roblox rate-limits you, lower download/upload concurrency and use Retry Failed Only after the run.`,
    );
  }

  return { ok: issues.length === 0, issues, warnings, authenticatedUserId };
}

function extractBatchLocationError(loc) {
  return getLocationErrorText(loc);
}

async function runAssetAccessPreflightChecks({
  batchItems,
  placeIdMap,
  robloxCookieHeader,
  assetTypeName,
  timeoutMs,
}) {
  const issues = [];
  const warnings = [];
  const sampleItems = (batchItems || []).slice(0, Math.min(5, (batchItems || []).length));
  if (sampleItems.length === 0) return { ok: true, issues, warnings };

  let accessibleCount = 0;
  const failures = [];

  for (const item of sampleItems) {
    const creatorKey = normalizeCreatorKey(item.creatorType, item.creatorId);
    const placeIds = placeIdMap[creatorKey] || DEFAULT_PLACE_ID_CANDIDATES;
    const placeIdArray = normalizePlaceIdCandidates(placeIds);
    const itemWithoutCreator = (({ creatorType, creatorId, ...rest }) => rest)(item);
    let itemAccessible = false;
    let lastError = '';

    for (const placeId of placeIdArray.slice(0, 8)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(5000, timeoutMs || 10000));
      try {
        const resp = await fetchWithTimeout(
          'https://assetdelivery.roblox.com/v2/assets/batch',
          {
            method: 'POST',
            headers: {
              'User-Agent': 'RobloxStudio/WinInet',
              'Content-Type': 'application/json',
              Accept: '*/*',
              'Accept-Encoding': 'gzip, deflate',
              Cookie: robloxCookieHeader,
              'Roblox-Place-Id': String(placeId),
            },
            body: JSON.stringify([itemWithoutCreator]),
            signal: controller.signal,
          },
          Math.max(5000, timeoutMs || 10000),
          'Asset access preflight',
        );
        if (!resp.ok) {
          lastError = `HTTP ${resp.status}`;
          continue;
        }
        const body = await readJsonWithTimeout(resp, 8000, 'Asset access preflight response');
        const loc = body && body[0];
        if (loc && loc.locations && loc.locations.length > 0 && loc.locations[0].location) {
          itemAccessible = true;
          break;
        }
        lastError = extractBatchLocationError(loc);
      } catch (err) {
        lastError =
          err && err.name === 'AbortError'
            ? 'Timed out while checking asset access'
            : err.message || String(err);
      } finally {
        clearTimeout(timeout);
      }
    }

    if (itemAccessible) accessibleCount++;
    else failures.push({ id: item.requestId, error: lastError || 'Asset access check failed' });
  }

  if (accessibleCount === 0 && failures.length > 0) {
    const classified = classifyError(failures[0].error);
    warnings.push(
      `${sampleItems.length}/${sampleItems.length} sampled ${assetTypeName.toLowerCase()} assets failed the quick access check. The run will continue and try all discovered creator place IDs plus direct asset fallbacks. Last check: ${classified.message}`,
    );
  } else if (failures.length > 0) {
    warnings.push(
      `${failures.length}/${sampleItems.length} sampled ${assetTypeName.toLowerCase()} assets failed the access check. The run can continue, but some items may fail.`,
    );
  }

  return {
    ok: true,
    issues,
    warnings,
    accessibleCount,
    checked: sampleItems.length,
  };
}

function classifyError(error, context = {}) {
  return classifyAssetError(error, context);
}

async function cooldownWithCountdown(ms, label, onTick, waitForDelay = delay) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  for (let remaining = totalSeconds; remaining > 0; remaining--) {
    if (onTick) onTick(remaining, totalSeconds);
    await waitForDelay(Math.min(1000, Math.max(1, ms || 0)));
  }
}

async function retryWithCooldown(
  fn,
  retries,
  delayMs,
  onAttemptFailure,
  onCooldownTick,
  options = {},
) {
  let lastError;
  const attempts = Math.max(1, retries);
  const stage = options.stage || 'operation';
  const waitForDelay = typeof options.waitForDelay === 'function' ? options.waitForDelay : delay;
  const beforeAttempt = typeof options.beforeAttempt === 'function' ? options.beforeAttempt : null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (beforeAttempt) await beforeAttempt(attempt, attempts);
      return await fn(attempt, attempts);
    } catch (err) {
      lastError = err;
      const classified = classifyError(err, { stage });
      const retryable =
        typeof options.shouldRetry === 'function'
          ? options.shouldRetry(err, classified, attempt, attempts) !== false
          : classified.retryable === true;
      if (onAttemptFailure) onAttemptFailure(attempt, attempts, err, classified, retryable);
      if (!retryable || attempt >= attempts) break;
      const cooldownMs = retryDelayWithJitter(delayMs, attempt, {
        maxDelayMs: options.maxDelayMs || 60000,
      });
      await cooldownWithCountdown(
        cooldownMs,
        `Retry ${attempt + 1}/${attempts}`,
        (remaining, total) => {
          if (onCooldownTick)
            onCooldownTick(remaining, total, attempt + 1, attempts, err, classified);
        },
        waitForDelay,
      );
    }
  }
  const enrichedError = new Error(
    `After ${attempts} attempt(s): ${lastError && lastError.message ? lastError.message : 'Unknown error'}`,
  );
  enrichedError.cause = lastError;
  throw enrichedError;
}

function withTimeout(promiseFactory, timeoutMs, label) {
  const ms = Math.max(1000, Number(timeoutMs) || 30000);
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error(`${label || 'Operation'} timed out after ${Math.round(ms / 1000)}s.`));
    }, ms);
    Promise.resolve()
      .then(promiseFactory)
      .then((value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

function dedupeAssetEntries(entries) {
  const seen = new Set();
  return (entries || []).filter((entry) => {
    const key = String(entry.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createStageMetrics() {
  const startedAt = Date.now();
  const stages = {};
  const slowest = {};

  const ensureStage = (stage) => {
    if (!stages[stage]) {
      stages[stage] = {
        count: 0,
        success: 0,
        failed: 0,
        totalDurationMs: 0,
        totalBytes: 0,
        averageDurationMs: 0,
        averageBytesPerSecond: 0,
      };
    }
    return stages[stage];
  };

  return {
    mark(stage, result = {}) {
      const durationMs = Math.max(0, Number(result.durationMs) || 0);
      const bytes = Math.max(0, Number(result.bytesWritten || result.fileSize || 0));
      const stats = ensureStage(stage);
      stats.count += 1;
      if (result.success === false) stats.failed += 1;
      else stats.success += 1;
      stats.totalDurationMs += durationMs;
      stats.totalBytes += bytes;
      stats.averageDurationMs =
        stats.count > 0 ? Math.round(stats.totalDurationMs / stats.count) : 0;
      stats.averageBytesPerSecond =
        stats.totalDurationMs > 0
          ? Math.round((stats.totalBytes / stats.totalDurationMs) * 1000)
          : 0;

      const name =
        result.name ||
        (result.entry && result.entry.name) ||
        result.id ||
        (result.entry && result.entry.id) ||
        '';
      if (!slowest[stage] || durationMs > slowest[stage].durationMs) {
        slowest[stage] = { name, durationMs, bytes };
      }
    },
    summary() {
      return {
        totalDurationMs: Date.now() - startedAt,
        stages,
        slowest,
      };
    },
  };
}

function getEtaString(startTimeMs, completed, total) {
  if (!completed || completed <= 0 || !total || completed >= total) return '';
  const elapsed = Math.max(0, (Date.now() - startTimeMs) / 1000);
  const avgTimePerItem = elapsed / completed;
  const remaining = Math.max(0, total - completed);
  const etaSeconds = Math.ceil(avgTimePerItem * remaining);
  const etaMin = Math.floor(etaSeconds / 60);
  const etaSec = etaSeconds % 60;
  return ` (ETA: ${etaMin}:${String(etaSec).padStart(2, '0')})`;
}

function isHardUploadStopCategory(category) {
  return [
    'bad_open_cloud_key',
    'bad_cookie',
    'upload_quota',
    'upload_permission',
    'permission_denied',
  ].includes(String(category || ''));
}

function getDownloadPriority(entry, locationsMap) {
  const loc = locationsMap && locationsMap[entry.id];
  if (loc && loc.locations && loc.locations.length > 0 && loc.locations[0].location) return 0;
  if (loc && loc.errors && loc.errors.length > 0) return 2;
  return 1;
}

function getReportDeps() {
  return {
    app,
    fs,
    sanitizeLogMessage,
    getCurrentLogFilePath,
    getLatestLogFilePath,
    readTextFileTail,
    developerMode: DEVELOPER_MODE,
  };
}

function registerIpcHandlers(
  getMainWindowFn,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage,
) {
  ipcMain.on('window-minimize', () => {
    const win = getMainWindowFn && getMainWindowFn();
    if (win && !win.isDestroyed()) win.minimize();
  });

  ipcMain.on('window-close', () => {
    const win = getMainWindowFn && getMainWindowFn();
    if (win && !win.isDestroyed()) {
      win.destroy();
      return;
    }
    app.quit();
  });

  ipcMain.handle('get-app-version', () => {
    try {
      return app.getVersion();
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to get app version:', err);
      return '0.0.0';
    }
  });

  ipcMain.handle('get-roblox-profile', async (_event, data) => {
    try {
      return await getRobloxProfileForRenderer(data || {});
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Failed to load Roblox profile:', err.message);
      return {
        ok: false,
        username: 'Not connected',
        displayName: '',
        userId: '',
        avatarDataUrl: '',
      };
    }
  });

  ipcMain.handle('get-release-source', async () => {
    const defaultSource = {
      id: 'official',
      label: 'Official',
      repo: 'IncrediDev/ISpooferMotion',
    };

    try {
      const filePath = path.join(app.getPath('userData'), 'release-source.json');
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const sourceId = String(parsed.sourceId || parsed.id || '').toLowerCase();

      if (sourceId === 'fork') {
        return {
          id: 'fork',
          label: 'Testing / Fork',
          repo: parsed.repo || 'codycon/ISpooferMotion',
        };
      }

      if (sourceId === 'official') {
        return {
          id: 'official',
          label: 'Official',
          repo: parsed.repo || 'IncrediDev/ISpooferMotion',
        };
      }

      return defaultSource;
    } catch {
      return defaultSource;
    }
  });

  ipcMain.on('open-external', (event, url) => {
    const { shell } = require('electron');

    const isAllowedExternalHost = (hostname) => {
      const host = String(hostname || '').toLowerCase();
      return (
        host === 'github.com' ||
        host.endsWith('.github.com') ||
        host === 'discord.gg' ||
        host.endsWith('.discord.gg') ||
        host === 'discord.com' ||
        host.endsWith('.discord.com') ||
        host === 'incredidev.com' ||
        host.endsWith('.incredidev.com') ||
        host === 'roblox.com' ||
        host.endsWith('.roblox.com')
      );
    };

    try {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.protocol !== 'https:' || !isAllowedExternalHost(parsedUrl.hostname)) {
        if (DEVELOPER_MODE) console.warn('Blocked external URL:', url);
        return;
      }

      shell.openExternal(parsedUrl.href);
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('Failed to open external URL:', err);
    }
  });

  ipcMain.handle('open-logs-folder', async () => {
    const { shell } = require('electron');
    const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
    try {
      await fs.mkdir(logsDir, { recursive: true });
      const error = await shell.openPath(logsDir);
      if (error) throw new Error(error);
      if (DEVELOPER_MODE) console.log('(Dev) Opened logs folder:', logsDir);
      return { success: true, path: logsDir };
    } catch (err) {
      console.error('Failed to open logs folder:', err);
      return {
        success: false,
        error: err && err.message ? err.message : 'Failed to open logs folder.',
      };
    }
  });

  ipcMain.handle('open-plugins-folder', async () => {
    const { shell } = require('electron');
    const pluginsDir = path.join(
      process.env.LOCALAPPDATA || app.getPath('appData'),
      'Roblox',
      'Plugins',
    );
    try {
      await fs.mkdir(pluginsDir, { recursive: true });
      const error = await shell.openPath(pluginsDir);
      if (error) throw new Error(error);
      if (DEVELOPER_MODE) console.log('(Dev) Opened Roblox plugins folder:', pluginsDir);
      return { success: true, path: pluginsDir };
    } catch (err) {
      console.error('Failed to open Roblox plugins folder:', err);
      return {
        success: false,
        error: err && err.message ? err.message : 'Failed to open Roblox plugins folder.',
      };
    }
  });

  ipcMain.on('run-spoofer-action', async (event, data) => {
    let resultSent = false;
    const safeSendResult = (payload) => {
      resultSent = true;
      sendSpooferResultToRenderer(payload);
    };
    try {
      await handleSpooferAction(
        data,
        getMainWindowFn,
        sendTransferUpdate,
        safeSendResult,
        sendStatusMessage,
      );
    } catch (err) {
      const classified = classifyError(err, { stage: 'run' });
      console.error('Spoofer run failed unexpectedly:', classified.raw);
      if (!resultSent) {
        safeSendResult({
          output: `The run stopped unexpectedly: ${classified.message}

Suggested fix: ${classified.suggestedFix || 'Check the support report and retry failed items.'}`,
          success: false,
          failedAnimationIdInput: data && data.animationId ? data.animationId : '',
          failedCount:
            data && data.animationId
              ? String(data.animationId).split(/\r?\n/).filter(Boolean).length
              : 0,
          summary: {
            mode: 'Unexpected error',
            total: 0,
            failures: [
              {
                stage: 'run',
                category: classified.category,
                label: classified.label,
                reason: classified.message,
                raw: classified.raw,
                retryable: classified.retryable === true,
                suggestedFix: classified.suggestedFix,
              },
            ],
            failureCategories: { [classified.category || 'unknown']: 1 },
          },
        });
      }
      sendStatusMessage('Run failed - see Run Report');
    } finally {
      resetRunControls();
    }
  });

  ipcMain.on('spoofer-pause', () => {
    pauseSpoofer();
    sendStatusMessage('Paused after the current item finishes');
  });
  ipcMain.on('spoofer-resume', () => {
    resumeSpoofer();
    sendStatusMessage('Resuming...');
  });
  ipcMain.on('spoofer-cancel', () => {
    cancelSpoofer();
    sendStatusMessage('Canceling after current item finishes...');
  });
  ipcMain.handle('check-session', () => loadSession());
  ipcMain.on('clear-session', () => clearSession());
  ipcMain.handle('clear-app-history', async () => {
    await clearSession();
    return { success: true };
  });
  ipcMain.handle('clear-asset-history', async () => {
    await clearAssetHistory();
    return { success: true };
  });
  ipcMain.handle('copy-debug-info', async (_event, context) => {
    const text = await buildAppDebugInfo(context || {}, getReportDeps());
    clipboard.writeText(text);
    return { success: true, length: text.length };
  });

  ipcMain.handle('export-support-report', async (_event, context) => {
    const report = await buildSupportReport(context || {}, getReportDeps());
    const text = formatSupportReportText(report);
    const result = await dialog.showSaveDialog({
      title: 'Export Support Report',
      defaultPath: `ISpooferMotion-Support-Report-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    await fs.writeFile(result.filePath, text, 'utf8');
    return { success: true, filePath: result.filePath, failureCount: report.run.failures.length };
  });

  ipcMain.handle('export-asset-history', async () => {
    const history = await loadAssetHistory();
    const rows = assetHistoryToRows(history);
    const result = await dialog.showSaveDialog({
      title: 'Export Cached Mappings',
      defaultPath: `ISpooferMotion-Cached-Mappings-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify(rows, null, 2), 'utf8');
    return { success: true, filePath: result.filePath, count: rows.length };
  });

  ipcMain.handle('fetch-audio-quota', async (event, data) => {
    try {
      if (DEVELOPER_MODE)
        console.log('(Dev) Fetching audio quota with data:', {
          hasCookie: !!data.cookie,
          autoDetect: data.autoDetect,
        });

      let cookie = data.cookie;
      if (data.autoDetect && !cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) Auto-detecting cookie...');
        cookie = await getCookieFromRobloxStudio();
        if (DEVELOPER_MODE)
          console.log('(Dev) Auto-detected cookie:', cookie ? 'Found' : 'Not found');
      }
      if (!cookie) {
        if (DEVELOPER_MODE) console.log('(Dev) No cookie available for quota check');
        return { error: 'No cookie provided' };
      }

      const cookieHeader = buildRobloxCookieHeader(cookie);
      if (!cookieHeader) {
        return { error: 'Invalid ROBLOSECURITY cookie format' };
      }

      if (DEVELOPER_MODE) console.log('(Dev) Fetching from Roblox API...');
      const response = await fetchWithTimeout(
        'https://publish.roblox.com/v1/asset-quotas?resourceType=RateLimitUpload&assetType=Audio',
        {
          headers: {
            Cookie: cookieHeader,
            'User-Agent': 'RobloxStudio/WinInet',
          },
        },
        10000,
        'Audio quota check',
      );

      if (DEVELOPER_MODE) console.log('(Dev) Quota API response status:', response.status);
      if (!response.ok) {
        const errorText = await Promise.race([
          response.text(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Quota error response read timed out')), 8000),
          ),
        ]).catch((err) => err.message);
        if (DEVELOPER_MODE) console.log('(Dev) Quota API error:', errorText);
        return { error: `Failed to fetch quota: ${response.status}` };
      }

      const quotaData = await readJsonWithTimeout(response, 10000, 'Audio quota response');
      if (DEVELOPER_MODE) console.log('(Dev) Quota data received:', quotaData);
      return quotaData;
    } catch (err) {
      console.error('Error fetching audio quota:', err);
      return { error: err.message };
    }
  });

  ipcMain.handle('select-folder', async (event) => {
    const { dialog } = require('electron');
    try {
      const result = await dialog.showOpenDialog(getMainWindowFn(), {
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (err) {
      console.error('Error selecting folder:', err);
      return null;
    }
  });
}
async function handleSpooferAction(
  data,
  getMainWindowFn,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage,
) {
  const runSignal = beginRunControls();

  if (DEVELOPER_MODE) {
    const sanitizedData = { ...data };
    if (sanitizedData.robloxCookie) sanitizedData.robloxCookie = '{Cookie:Here}';
    console.log('MAIN_PROCESS (Dev): Received run-spoofer-action with data:', sanitizedData);
  } else {
    console.log('MAIN_PROCESS: Received run-spoofer-action.');
  }
  if (data.resumeSession === true) {
    const savedSession = await loadSession();
    const resumeInput =
      savedSession && (savedSession.retryAnimationIdInput || savedSession.animationIdInput);
    if (resumeInput) {
      data.animationId = resumeInput;
    }
  }

  const isResume = data.resumeSession === true;
  const hasCustomDownloadFolder = !!(
    data.downloadOnly &&
    data.downloadFolder &&
    data.downloadFolder.trim()
  );
  const downloadsDir = hasCustomDownloadFolder
    ? data.downloadFolder.trim()
    : path.join(app.getPath('userData'), 'ispoofer_downloads');
  if (data.downloadOnly && (!data.downloadFolder || !data.downloadFolder.trim())) {
    sendSpooferResultToRenderer({
      output: 'Please select a download folder for Download-Only mode.',
      success: false,
    });
    sendStatusMessage('Error: No download folder selected');
    return;
  }

  if (!hasCustomDownloadFolder && !isResume) {
    const cleared = await clearDownloadsDirectory(downloadsDir);
    if (!cleared) {
      if (DEVELOPER_MODE)
        console.warn('(Dev) Failed to fully clear downloads directory, proceeding anyway.');
      sendStatusMessage('Warning: could not fully clear previous downloads; continuing.');
    }
  } else if (DEVELOPER_MODE) {
    console.log(
      `(Dev) Skipping auto-clear: ${isResume ? 'resuming saved session' : 'using user-selected download folder'}`,
    );
  }

  if (!data.enableSpoofing && !data.downloadOnly) {
    sendSpooferResultToRenderer({
      output: 'Enable Spoofing toggle is OFF and Download-Only mode is not enabled.',
      success: false,
    });
    return;
  }
  if (data.groupId && !/^\d+$/.test(String(data.groupId).trim())) {
    sendSpooferResultToRenderer({
      output: `Invalid Group ID "${data.groupId}" - must be a number only, not a URL or text.`,
      success: false,
    });
    return;
  }
  if (!data.downloadOnly && !data.apiKey) {
    sendSpooferResultToRenderer({
      output:
        'Uploads now require an Open Cloud API key.\n\nTo fix this:\n1. Go to create.roblox.com → Open Cloud → API Keys\n2. Create a key with Assets Read & Write permissions\n3. Paste the key into the "Open Cloud API Key" field',
      success: false,
    });
    return;
  }
  const declaredAssetType = String(data.animationId || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => parseAssetTypeDirective(line))
    .find(Boolean);
  const isSoundMode = declaredAssetType ? declaredAssetType === 'sound' : data.spoofSounds === true;
  const activeTask = isSoundMode ? soundGrabberTask : animationGrabberTask;
  const assetTypeName = activeTask.assetTypeName;
  const taskPlan = activeTask.plan(data);
  const taskValidation = activeTask.validate(data);
  if (!taskValidation.ok) {
    const firstIssue = taskValidation.issues[0];
    sendSpooferResultToRenderer({
      output: firstIssue.message || 'Fix the listed task input issues before running.',
      success: false,
      summary: {
        mode: 'Preflight',
        total: 0,
        failures: taskValidation.issues.map((issue) => ({
          stage: issue.stage || 'preflight',
          category: issue.category || 'invalid_input',
          label: issue.label || '',
          reason: issue.message || 'Invalid input',
          retryable: false,
          suggestedFix: issue.suggestedFix || '',
        })),
        failureCategories: taskValidation.issues.reduce((acc, issue) => {
          const key = issue.category || 'invalid_input';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
      },
    });
    sendStatusMessage('Task input failed validation');
    return;
  }
  const parseResult = taskPlan.parseResult;
  let assetEntries = parseResult.entries;

  if (assetEntries.length === 0) {
    const rejectedText = formatRejectedLines(parseResult.rejected);
    sendSpooferResultToRenderer({
      output: `No valid ${isSoundMode ? 'sound' : 'animation'} entries.${
        rejectedText
          ? `

Skipped input:
${rejectedText}`
          : ''
      }`,
      success: false,
      summary: {
        mode: 'Parse',
        total: 0,
        failures: (parseResult.rejected || []).map((item) => ({
          stage: 'parse',
          category: 'Invalid input',
          reason: `Line ${item.lineNumber}: ${item.reason}`,
          input: item.input,
          retryable: false,
        })),
        failureCategories: { 'Invalid input': (parseResult.rejected || []).length },
      },
    });
    return;
  }

  if (parseResult.warnings.length > 0) {
    sendStatusMessage(parseResult.warnings[0]);
  }
  let animationEntries = assetEntries;
  const firstEntry = animationEntries[0];
  let robloxCookie = data.robloxCookie;
  if (data.autoDetectCookie) {
    try {
      if (firstEntry.creatorType === 'user') {
        robloxCookie = await getCookieFromRobloxStudio(firstEntry.creatorId);
      } else {
        robloxCookie = await getCookieFromRobloxStudio();
      }
      if (!robloxCookie) throw new Error('Auto-detected cookie empty/not found.');
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Error auto-detecting cookie:', err);
      sendSpooferResultToRenderer({
        output: `Failed to auto-detect cookie: ${err.message}`,
        success: false,
      });
      return;
    }
  }
  if (!robloxCookie) {
    sendSpooferResultToRenderer({ output: 'Roblox cookie not provided.', success: false });
    return;
  }

  const robloxCookieHeader = buildRobloxCookieHeader(robloxCookie);
  if (!robloxCookieHeader) {
    sendSpooferResultToRenderer({ output: 'Invalid ROBLOSECURITY cookie format.', success: false });
    return;
  }

  function createMachineId() {
    const parts = [];
    for (let i = 0; i < 4; i++)
      parts.push(
        (crypto.randomBytes
          ? crypto.randomBytes(4)
          : crypto.webcrypto.getRandomValues(new Uint8Array(4))
        )
          .toString('hex')
          .toUpperCase(),
      );
    return parts.join('-');
  }
  const machineId = createMachineId();
  const browserSessionId = crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  const runSessionId = crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');

  let currentCsrfToken = ''; // Global CSRF cache for this run

  // Helper to get headers dynamically per request (prevents WAF caching)
  function getDynamicStudioHeaders() {
    return {
      'User-Agent': 'RobloxStudio/WinInet',
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Requester: 'Client',
      'Sec-CH-UA': '" Not A;Brand";v="99", "Chromium";v="101"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Roblox-Session-Id': runSessionId,
      'Roblox-Browser-Session-Id': browserSessionId,
      'Roblox-Machine-Id': machineId,
      'Roblox-Idempotency-Key': crypto.randomUUID
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString('hex'),
      'Content-Type': 'application/json',
      Cookie: robloxCookieHeader,
    };
  }

  const missingCreatorCount = animationEntries.filter(
    (entry) => !entry.creatorType || !entry.creatorId,
  ).length;
  if (missingCreatorCount > 0) {
    try {
      const fallbackUserId = await getAuthenticatedUserId(robloxCookie);
      animationEntries = applyDefaultCreator(animationEntries, {
        creatorType: 'user',
        creatorId: fallbackUserId,
      });
      assetEntries = animationEntries;
      sendStatusMessage(
        `Using authenticated user ${fallbackUserId} as source fallback for ${missingCreatorCount} item(s).`,
      );
    } catch (err) {
      const rejectedText = formatRejectedLines(parseResult.rejected);
      const classified = classifyError(err, { stage: 'preflight' });
      if (classified.category === 'bad_cookie') {
        sendSpooferResultToRenderer({
          output: `Some entries are missing [User123] or [Group123], and the authenticated user could not be resolved for fallback.

${classified.message}${
            rejectedText
              ? `

Also skipped input:
${rejectedText}`
              : ''
          }`,
          success: false,
          summary: {
            mode: 'Parse',
            total: animationEntries.length,
            failures: animationEntries
              .filter((entry) => !entry.creatorType || !entry.creatorId)
              .map((entry) => ({
                id: entry.id,
                name: entry.name,
                stage: 'parse',
                category: 'Missing source creator',
                reason:
                  'Add [User123] or [Group123] to this line, or use a valid cookie so the app can use your authenticated user as a fallback.',
                retryable: false,
              })),
            failureCategories: { 'Missing source creator': missingCreatorCount },
          },
        });
        return;
      }

      animationEntries = animationEntries.map((entry) =>
        entry.creatorType && entry.creatorId
          ? entry
          : {
              ...entry,
              creatorType: 'user',
              creatorId: '',
              usedUnknownCreatorFallback: true,
            },
      );
      assetEntries = animationEntries;
      sendStatusMessage(
        `Warning: ${missingCreatorCount} item(s) have no source creator. Authenticated user lookup failed, so the run will try generic place/direct fallbacks.`,
      );
    }
  }

  sendStatusMessage('Running preflight checks...');
  const basicPreflight = await runBasicPreflightChecks({
    data,
    assetEntries: animationEntries,
    isSoundMode,
    downloadsDir,
    robloxCookie,
  });
  if (!basicPreflight.ok) {
    sendSpooferResultToRenderer({
      output: formatPreflightResult(basicPreflight.issues, basicPreflight.warnings),
      success: false,
      summary: {
        mode: 'Preflight',
        total: animationEntries.length,
        failures: basicPreflight.issues.map((reason) => ({
          stage: 'Preflight',
          category: 'Fix before running',
          reason,
        })),
        failureCategories: { Preflight: basicPreflight.issues.length },
      },
    });
    sendStatusMessage('Preflight failed - fix the listed items before running');
    return;
  }
  if (basicPreflight.warnings.length > 0) {
    sendStatusMessage(`Preflight warning: ${basicPreflight.warnings[0]}`);
  }
  const preflightAuthenticatedUserId = basicPreflight.authenticatedUserId || null;
  const csrfToken = null;
  try {
    if (!(await fs.stat(downloadsDir).catch(() => null))) {
      await fs.mkdir(downloadsDir, { recursive: true });
      if (DEVELOPER_MODE) console.log('(Dev) Downloads directory created:', downloadsDir);
    }
  } catch (dirError) {
    sendSpooferResultToRenderer({
      output: `Failed to ensure downloads directory exists: ${dirError.message}`,
      success: false,
    });
    return;
  }
  const autoSaveSession = data.autoSaveSession !== false;
  const sessionSaveBuffer = createBufferedSessionSaver({
    save: saveSession,
    minIntervalMs: 2500,
    maxPending: 12,
  });
  const persistSession = async (options = {}) => {
    if (autoSaveSession && session) await sessionSaveBuffer.save(session, options);
  };
  const cancelPendingSessionSave = () => sessionSaveBuffer.cancel();
  let session = isResume ? await loadSession() : null;
  if (isResume && session) {
    const completedIds = new Set((session.completedMappings || []).map((m) => m.originalId));
    animationEntries.splice(
      0,
      animationEntries.length,
      ...animationEntries.filter((e) => !completedIds.has(String(e.id))),
    );

    if (animationEntries.length === 0) {
      const mappingOutput = (session.completedMappings || [])
        .map((m) => `${m.originalId} = ${m.newId},`)
        .join('\n');
      sendSpooferResultToRenderer({ output: mappingOutput.replace(/,$/, ''), success: true });
      sendStatusMessage('Session already complete');
      await clearSession();
      return;
    }

    sendSpooferResultToRenderer({
      output: `Resuming - ${animationEntries.length} asset(s) remaining from previous session.\n`,
      success: true,
    });
  } else {
    session = {
      sessionId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      mode: isSoundMode ? 'Audio' : 'Animation',
      animationIdInput: data.animationId, // stored so resume works even if textarea is empty after crash
      totalCount: animationEntries.length,
      completedMappings: [],
      completedDownloads: [],
      failedEntries: [],
      retryAnimationIdInput: '',
      status: 'running',
    };
    await persistSession({ force: true });
  }

  let verboseOutputMessage = `Processing ${animationEntries.length} ${isSoundMode ? 'sound' : 'animation'}(s)...\n`;
  let successfulUploadCount = 0;
  let downloadedSuccessfullyCount = 0;
  let uploadMappingOutput = (session.completedMappings || [])
    .map((m) => `${m.originalId} = ${m.newId},`)
    .join('\n');
  if (uploadMappingOutput) uploadMappingOutput += '\n';

  const completedDownloadMap = new Map();
  const savedCompletedDownloads = Array.isArray(session.completedDownloads)
    ? session.completedDownloads
    : [];
  const validCompletedDownloads = [];
  for (const completedDownload of savedCompletedDownloads) {
    if (!completedDownload || !completedDownload.originalId || !completedDownload.filePath)
      continue;
    try {
      const stat = await fs.stat(completedDownload.filePath);
      if (stat && stat.isFile() && stat.size > 0) {
        completedDownloadMap.set(String(completedDownload.originalId), completedDownload);
        validCompletedDownloads.push(completedDownload);
      }
    } catch (_) {}
  }
  if (validCompletedDownloads.length !== savedCompletedDownloads.length) {
    session.completedDownloads = validCompletedDownloads;
    session.lastUpdatedAt = new Date().toISOString();
    await persistSession({ force: true });
  }

  const uploadTargetKey =
    data.groupId && String(data.groupId).trim() ? `group:${String(data.groupId).trim()}` : 'user';
  const ignoreResolutionCache = data.ignoreAssetCache === true;
  const resolutionCache = await loadAssetResolutionCache();
  let resolutionCacheDirty = false;
  let cachedHistoryMappings = [];
  let runAssetHistory = null;
  let runAssetHistoryDirty = false;
  const assetHistorySaveBuffer = createBufferedSessionSaver({
    save: saveAssetHistory,
    minIntervalMs: 3000,
    maxPending: 20,
  });
  const getRunAssetHistory = async () => {
    if (!runAssetHistory) runAssetHistory = await loadAssetHistory();
    return runAssetHistory;
  };
  const persistAssetHistory = async (options = {}) => {
    if (!runAssetHistoryDirty || !runAssetHistory) return;
    await assetHistorySaveBuffer.save(runAssetHistory, options);
    if (options.force === true) runAssetHistoryDirty = false;
  };
  if (!data.downloadOnly && !isResume && !data.ignoreAssetCache) {
    const history = await getRunAssetHistory();
    const uncachedEntries = [];
    for (const entry of animationEntries) {
      const cached = history[buildHistoryKey(assetTypeName, uploadTargetKey, entry.id)];
      if (cached && cached.newId) {
        cachedHistoryMappings.push({ entry, newId: String(cached.newId) });
        uploadMappingOutput += `${entry.id} = ${cached.newId},\n`;
      } else {
        uncachedEntries.push(entry);
      }
    }
    if (cachedHistoryMappings.length > 0) {
      animationEntries.splice(0, animationEntries.length, ...uncachedEntries);
      sendStatusMessage(`Skipped ${cachedHistoryMappings.length} cached asset mapping(s)`);
    }
    if (animationEntries.length === 0) {
      sendSpooferResultToRenderer({
        output: uploadMappingOutput.trim().replace(/,$/, ''),
        success: true,
        failedAnimationIdInput: '',
        failedCount: 0,
        summary: {
          total: cachedHistoryMappings.length,
          downloaded: 0,
          uploaded: 0,
          cached: cachedHistoryMappings.length,
          downloadFailures: 0,
          uploadFailures: 0,
          skippedUploads: cachedHistoryMappings.length,
          downloadOnly: false,
          mode: 'Cached mappings',
          durationSeconds: 0,
          failureCategories: {},
          failures: [],
          mappings: (uploadMappingOutput || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          cachedMappings: cachedHistoryMappings.map((item) => ({
            name: item.entry.name,
            originalId: item.entry.id,
            newId: item.newId,
            savedAt: item.savedAt || '',
          })),
        },
      });
      sendStatusMessage('Run complete - cached mappings reused');
      return;
    }
  }

  const initialTransferStates = [];
  for (const entry of animationEntries) {
    const downloadTransferId = crypto.randomUUID();
    initialTransferStates.push({
      id: downloadTransferId,
      name: entry.name,
      originalAssetId: entry.id,
      status: 'queued',
      direction: 'download',
      progress: 0,
      size: 0,
    });
  }
  initialTransferStates.forEach((state) => sendTransferUpdate(state));

  const totalAnimations = animationEntries.length;
  try {
    sendStatusMessage(`0/${totalAnimations} spoofed`);
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send initial status message', e);
  }

  let hasAuthError = false;
  const stageMetrics = createStageMetrics();
  const maxPlaceIds = data.maxPlaceIds || 10;
  const maxPlaceIdRetries = data.maxPlaceIdRetries || 3;
  const overridePlaceId = data.overridePlaceId ? parseInt(data.overridePlaceId) : null;
  const placeIdMap = {};
  if (overridePlaceId) {
    if (DEVELOPER_MODE)
      console.log(
        `(Dev) Override Place ID provided: ${overridePlaceId}. Using this for all creators instead of fetching.`,
      );
    const uniqueCreators = [
      ...new Set(animationEntries.map((e) => normalizeCreatorKey(e.creatorType, e.creatorId))),
    ];
    for (const creatorKey of uniqueCreators) {
      placeIdMap[creatorKey] = normalizePlaceIdCandidates([overridePlaceId]);
    }
    if (DEVELOPER_MODE) console.log(`(Dev) Resolved placeIdMap with override:`, placeIdMap);
  } else if (animationEntries.length > 0) {
    if (DEVELOPER_MODE)
      console.log(
        `(Dev) Found ${animationEntries.length > 0 ? [...new Set(animationEntries.map((e) => normalizeCreatorKey(e.creatorType, e.creatorId)))].length : 0} unique creators. Fetching placeIds (max ${maxPlaceIds} per creator, ${maxPlaceIdRetries} retries)...`,
      );

    const uniqueCreators = [
      ...new Set(animationEntries.map((e) => normalizeCreatorKey(e.creatorType, e.creatorId))),
    ];
    if (DEVELOPER_MODE)
      console.log(`(Dev) Fetching placeIds for ${uniqueCreators.length} creator(s) in parallel...`);

    await Promise.all(
      uniqueCreators.map(async (creatorKey) => {
        const [creatorType, creatorId] = creatorKey.split(':');
        if (!creatorId) {
          placeIdMap[creatorKey] = normalizePlaceIdCandidates([]);
          sendStatusMessage(
            'Some input rows have no source creator. Trying generic place/direct fallbacks for those items.',
          );
          return;
        }
        try {
          const placeIds = await retryAsync(
            () => getPlaceIdFromCreator(creatorType, creatorId, robloxCookie, maxPlaceIds),
            maxPlaceIdRetries,
            1000,
            (attempt, max, err) => {
              if (DEVELOPER_MODE)
                console.warn(`(Dev) Attempt ${attempt}/${max} for ${creatorKey}: ${err.message}`);
            },
          );
          placeIdMap[creatorKey] = normalizePlaceIdCandidates(
            Array.isArray(placeIds) ? placeIds : [placeIds],
          );
          if (DEVELOPER_MODE)
            console.log(`(Dev) Got ${placeIdMap[creatorKey].length} placeIds for ${creatorKey}`);
        } catch (error) {
          if (DEVELOPER_MODE)
            console.warn(`(Dev) Could not get placeIds for ${creatorKey}: ${error.message}`);
          placeIdMap[creatorKey] = normalizePlaceIdCandidates([]);
        }
      }),
    );

    if (DEVELOPER_MODE) console.log('(Dev) Resolved placeIdMap:', placeIdMap);
  }

  if (!ignoreResolutionCache) {
    for (const creatorKey of Object.keys(placeIdMap)) {
      placeIdMap[creatorKey] = orderPlaceIdsWithCache(
        resolutionCache,
        creatorKey,
        normalizePlaceIdCandidates(placeIdMap[creatorKey]),
      );
    }
  }
  const locationsMap = {};
  let batchItems = buildBatchItems(animationEntries, assetTypeName);
  if (!ignoreResolutionCache) {
    const uncachedBatchItems = [];
    for (const item of batchItems) {
      const entry = animationEntries.find(
        (candidate) => String(candidate.id) === String(item.requestId),
      );
      const cachedLocation = entry
        ? getFreshCachedLocation(resolutionCache, assetTypeName, entry)
        : null;
      if (cachedLocation) {
        locationsMap[item.requestId] = cachedLocation;
      } else {
        uncachedBatchItems.push(item);
      }
    }
    if (uncachedBatchItems.length !== batchItems.length) {
      const reusedCount = batchItems.length - uncachedBatchItems.length;
      sendStatusMessage(`Reused ${reusedCount} cached location lookup(s)`);
      batchItems = uncachedBatchItems;
    }
  }
  const BATCH_MAX_RETRIES = parseInt(data.batchRetries, 10) || 3;
  const BATCH_RETRY_DELAY_MS = parseInt(data.batchRetryDelay, 10) || 2000;
  const BATCH_TIMEOUT_MS = parseInt(data.batchTimeoutMs, 10) || 15000; // 15s per batch
  const batchPlan = getBatchPlan(batchItems.length, { chunkSize: data.batchChunkSize });
  const BATCH_CREATOR_DELAY_MS = toPositiveInteger(
    data.batchCreatorDelayMs,
    batchPlan.creatorDelayMs,
    0,
    5000,
  );
  let chunkSize = batchPlan.chunkSize;

  const assetAccessPreflight = await runAssetAccessPreflightChecks({
    batchItems,
    placeIdMap,
    robloxCookieHeader,
    assetTypeName,
    timeoutMs: BATCH_TIMEOUT_MS,
  });
  if (!assetAccessPreflight.ok) {
    sendSpooferResultToRenderer({
      output: formatPreflightResult(assetAccessPreflight.issues, assetAccessPreflight.warnings),
      success: false,
      failedAnimationIdInput: animationEntries.slice(0, 5).map(formatAssetEntry).join('\n'),
      failedCount: animationEntries.length,
      summary: {
        mode: 'Preflight',
        total: animationEntries.length,
        failures: assetAccessPreflight.issues.map((reason) => ({
          stage: 'Preflight',
          category: 'permission_denied',
          label: 'Permission denied',
          reason,
        })),
        failureCategories: { permission_denied: assetAccessPreflight.issues.length },
      },
    });
    sendStatusMessage(
      'Preflight failed - source assets are not accessible with this account/place',
    );
    return;
  }
  if (assetAccessPreflight.warnings.length > 0) {
    sendStatusMessage(`Preflight warning: ${assetAccessPreflight.warnings[0]}`);
  } else {
    sendStatusMessage('Preflight complete - starting batch');
  }

  async function fetchBatchRequest(items, placeId, creatorKey) {
    const itemsWithoutCreator = items.map(({ creatorType, creatorId, ...rest }) => rest);

    for (let attempt = 1; attempt <= BATCH_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
      let resp;
      let caughtErr = null;
      try {
        const headers = {
          ...getDynamicStudioHeaders(),
          'Roblox-Place-Id': String(placeId),
        };
        if (currentCsrfToken) headers['x-csrf-token'] = currentCsrfToken;

        resp = await fetchWithTimeout(
          'https://assetdelivery.roblox.com/v2/assets/batch',
          {
            method: 'POST',
            headers,
            body: JSON.stringify(itemsWithoutCreator),
            signal: controller.signal,
          },
          BATCH_TIMEOUT_MS,
          'Batch asset location request',
        );
      } catch (err) {
        caughtErr = err;
      } finally {
        clearTimeout(timeout);
      }

      if (resp && resp.status === 403) {
        const newToken = resp.headers.get('x-csrf-token');
        if (newToken) {
          currentCsrfToken = newToken;
          if (DEVELOPER_MODE)
            console.log('(Dev) [Batch] Extracted new CSRF token. Retrying request...');
          attempt--; // Do not count CSRF negotiation against max retries
          continue;
        }
      }

      if (resp && resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
        let backoffMs =
          retryAfter > 0 ? retryAfter * 1000 : BATCH_RETRY_DELAY_MS * Math.pow(1.5, attempt - 1);

        // Add random jitter between 10% and 30% to avoid synchronized retry waves (WAF detection)
        const jitter = backoffMs * (0.1 + Math.random() * 0.2);
        backoffMs = Math.min(backoffMs + jitter, 45000); // Cap at 45 seconds

        if (DEVELOPER_MODE)
          console.log(
            `(Dev) [Batch] Rate limited. Backing off for ${Math.round(backoffMs)}ms (Attempt ${attempt}/${BATCH_MAX_RETRIES})`,
          );

        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      if (caughtErr || (resp && !resp.ok)) {
        if (attempt < BATCH_MAX_RETRIES) {
          const backoffMs = BATCH_RETRY_DELAY_MS * attempt + Math.random() * 500;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw caughtErr || new Error(`Batch request failed with status ${resp?.status}`);
      }

      const bodyText = await readTextWithTimeout(resp, 8000, 'Batch asset location response');
      try {
        const parsedBody = JSON.parse(bodyText);
        // Ghost Error filtering: if body contains top-level errors and NO locations, reject it
        if (
          parsedBody &&
          parsedBody.errors &&
          Array.isArray(parsedBody.errors) &&
          parsedBody.errors.length > 0
        ) {
          if (!parsedBody.locations || parsedBody.locations.length === 0) {
            throw new Error(
              `Roblox returned 200 OK but body contains errors: ${JSON.stringify(parsedBody.errors)}`,
            );
          }
        }
        return parsedBody;
      } catch (err) {
        throw new Error(`Failed to parse batch response. Body: ${bodyText.substring(0, 100)}`);
      }
    }
  }

  function isUsableLocation(loc) {
    if (!loc) return false;
    // also reject locations where the body itself signals an error (Roblox returns 200 with error JSON sometimes)
    if (
      loc.parseError ||
      (loc.errors && loc.errors.length > 0 && !(loc.locations && loc.locations.length > 0))
    )
      return false;
    return !!(loc.locations && loc.locations.length > 0 && loc.locations[0].location);
  }

  async function resolveBatchChunkWithSplit(items, creatorKey, depth = 0) {
    if (!items || items.length === 0) return;
    const placeIdArray = normalizePlaceIdCandidates(placeIdMap[creatorKey]);
    let unresolved = items.slice();
    let lastErrorsById = new Map();

    for (let placeIndex = 0; placeIndex < placeIdArray.length; placeIndex++) {
      const placeId = placeIdArray[placeIndex];
      if (unresolved.length === 0) break;
      await checkPaused();
      checkCancelled();
      try {
        if (DEVELOPER_MODE)
          console.log(
            `(Dev) Batch request for ${creatorKey}: ${unresolved.length} item(s) with placeId ${placeId}`,
          );
        const locations = await fetchBatchRequest(unresolved, placeId, creatorKey);
        const locationById = new Map((locations || []).map((loc) => [String(loc.requestId), loc]));
        const stillUnresolved = [];

        for (const item of unresolved) {
          const loc = locationById.get(String(item.requestId));
          if (isUsableLocation(loc)) {
            locationsMap[item.requestId] = loc;
            if (!ignoreResolutionCache) {
              const entryForCache = animationEntries.find(
                (entry) => String(entry.id) === String(item.requestId),
              );
              if (entryForCache)
                rememberCachedLocation(resolutionCache, assetTypeName, entryForCache, loc, placeId);
              rememberGoodPlaceId(resolutionCache, creatorKey, placeId);
              resolutionCacheDirty = true;
            }
          } else {
            const errorText =
              extractBatchLocationError(loc) || 'No downloadable location returned.';
            lastErrorsById.set(String(item.requestId), errorText);
            stillUnresolved.push(item);
          }
        }

        unresolved = stillUnresolved;
      } catch (err) {
        const classified = err.classified || classifyError(err, { stage: 'download' });
        if (/\b401\b|\b403\b/.test(classified.raw || err.message || '')) hasAuthError = true;
        if (
          placeIndex < placeIdArray.length - 1 &&
          classified.category !== 'bad_cookie' &&
          classified.category !== 'canceled'
        ) {
          sendStatusMessage(
            `Batch lookup failed for place ${placeId}; trying another place candidate...`,
          );
          continue;
        }
        if (items.length > 1) {
          const nextSize = Math.max(1, Math.ceil(items.length / 2));
          sendStatusMessage(
            `Batch lookup failed; splitting ${items.length} item(s) into smaller groups...`,
          );
          for (const split of chunkArray(items, nextSize)) {
            await resolveBatchChunkWithSplit(split, creatorKey, depth + 1);
          }
          return;
        }
        locationsMap[items[0].requestId] = createBatchLocationFailure(
          items[0],
          classified.raw || classified.message || err.message,
          { stage: 'download' },
        );
        return;
      }
    }

    for (const item of unresolved) {
      await checkPaused();
      checkCancelled();
      const transfer = initialTransferStates.find((t) => t.originalAssetId === item.requestId);
      if (transfer)
        sendTransferUpdate({
          id: transfer.id,
          status: 'processing',
          message: 'Trying single-asset lookup fallback',
        });
      const singleLoc = await fetchSingleBatchLocation(item);
      if (!isUsableLocation(singleLoc) && lastErrorsById.has(String(item.requestId))) {
        locationsMap[item.requestId] = createBatchLocationFailure(
          item,
          `Batch lookup failed: ${lastErrorsById.get(String(item.requestId))}. Single lookup: ${extractBatchLocationError(singleLoc)}`,
          { stage: 'download' },
        );
      } else {
        locationsMap[item.requestId] = singleLoc;
        if (isUsableLocation(singleLoc) && !ignoreResolutionCache) {
          const entryForCache = animationEntries.find(
            (entry) => String(entry.id) === String(item.requestId),
          );
          if (entryForCache)
            rememberCachedLocation(resolutionCache, assetTypeName, entryForCache, singleLoc, null);
          resolutionCacheDirty = true;
        }
      }
      if (transfer && singleLoc.errors && singleLoc.errors.length) {
        const errMsg =
          singleLoc.errors[0].message ||
          singleLoc.errors[0].Message ||
          'Single-asset lookup failed';
        sendTransferUpdate({
          id: transfer.id,
          status: 'queued',
          error: errMsg,
          message: 'Will try direct download fallback',
        });
      }
    }
  }

  const METADATA_CONCURRENCY = toPositiveInteger(
    data.metadataConcurrency,
    batchPlan.metadataConcurrency || 2,
    1,
    6,
  );
  if (DEVELOPER_MODE)
    console.log(
      `(Dev) Fetching batch locations for ${batchItems.length} ${isSoundMode ? 'sounds' : 'animations'} with creator-specific placeIds, chunk size ${chunkSize}, metadata concurrency ${METADATA_CONCURRENCY}`,
    );
  const creatorGroups = groupBatchItemsByCreator(batchItems);
  let creatorGroupIndex = 0;
  for (const [creatorKey, items] of creatorGroups.entries()) {
    if (creatorGroupIndex > 0 && BATCH_CREATOR_DELAY_MS > 0)
      await waitForRunDelay(BATCH_CREATOR_DELAY_MS);
    creatorGroupIndex++;

    function randomizedChunkArray(arr, baseSize) {
      const chunks = [];
      let i = 0;
      while (i < arr.length) {
        // Randomize chunk size between 70% and 100% of baseSize
        const vary = Math.max(1, Math.floor(baseSize * (0.7 + Math.random() * 0.3)));
        chunks.push(arr.slice(i, i + vary));
        i += vary;
      }
      return chunks;
    }
    const chunks = randomizedChunkArray(items, chunkSize);

    await runQueue(chunks, {
      concurrency: Math.min(METADATA_CONCURRENCY, chunks.length),
      signal: runSignal,
      worker: async (chunk) => {
        await checkPaused();
        checkCancelled();
        await resolveBatchChunkWithSplit(chunk, creatorKey);
        return { success: true };
      },
      isCancelError,
      createErrorResult: (err) => {
        const classified = classifyError(err, { stage: 'resolve_location' });
        if (DEVELOPER_MODE)
          console.warn(`(Dev) Metadata chunk failed for ${creatorKey}: ${classified.raw}`);
        return { success: false, error: classified.message, category: classified.category };
      },
    });
  }

  if (resolutionCacheDirty) {
    await saveAssetResolutionCache(resolutionCache);
    resolutionCacheDirty = false;
  }

  const UPLOAD_RETRIES = parseInt(data.uploadRetries, 10) || 3;
  const UPLOAD_RETRY_DELAY_MS = parseInt(data.uploadRetryDelay, 10) || 5000;
  const UPLOAD_TIMEOUT_MS = parseInt(data.uploadTimeoutMs, 10) || 120000;
  const DOWNLOAD_RETRIES = parseInt(data.downloadRetries, 10) || 2;
  const DOWNLOAD_RETRY_DELAY_MS = parseInt(data.downloadRetryDelayMs, 10) || 2000;
  const DOWNLOAD_TIMEOUT_MS = parseInt(data.downloadTimeoutMs, 10) || 15000;
  const runWithConcurrency = async (items, limit, worker, queueOptions = {}) =>
    runQueue(items, {
      concurrency: limit,
      worker,
      signal: runSignal,
      beforeItem: async () => {
        await checkPaused();
        checkCancelled();
      },
      shouldContinue: queueOptions.shouldContinue,
      onItemComplete: queueOptions.onItemComplete,
      onItemError: queueOptions.onItemError,
      isCancelError,
      createCancelResult: (_err, item) => ({
        entry: item.entry || item,
        success: false,
        canceled: true,
        error: 'Canceled',
      }),
      createErrorResult: (err, item) => {
        const entry = item.entry || item;
        const stage = item.stage || (item.filePath ? 'upload' : 'download');
        const classified = classifyError(err, { stage });
        return createStageFailure(entry, stage, classified.raw, {
          category: classified.category,
          userMessage: classified.message,
          retryable: classified.retryable === true,
        });
      },
    });
  sendStatusMessage(`Downloading ${isSoundMode ? 'sounds' : 'animations'}...`);
  let downloadCompleted = 0;
  const downloadStartTime = Date.now();
  const batchProblemCount = animationEntries.reduce((count, entry) => {
    const loc = locationsMap[entry.id];
    return (
      count +
      (!loc || (loc.errors && loc.errors.length > 0) || !loc.locations || loc.locations.length === 0
        ? 1
        : 0)
    );
  }, 0);
  const resumedDownloadResults = [];
  const downloadQueue = [];
  for (const entry of animationEntries) {
    const completed = completedDownloadMap.get(String(entry.id));
    if (completed) {
      const transfer = initialTransferStates.find((t) => t.originalAssetId === entry.id);
      if (transfer)
        sendTransferUpdate({
          id: transfer.id,
          status: 'complete',
          progress: 100,
          message: 'Using saved download from previous session',
        });
      resumedDownloadResults.push(createCompletedDownloadResult(entry, completed));
    } else {
      downloadQueue.push(entry);
    }
  }
  if (resumedDownloadResults.length > 0) {
    sendStatusMessage(
      `Reused ${resumedDownloadResults.length} completed download(s) from the saved session`,
    );
  }

  downloadQueue.sort(
    (a, b) => getDownloadPriority(a, locationsMap) - getDownloadPriority(b, locationsMap),
  );
  const baseDownloadConcurrency = Math.min(
    parseInt(data.downloadConcurrency, 10) || 10,
    Math.max(1, downloadQueue.length),
  );
  const plannedDownloadCap = batchPlan.downloadConcurrencyCap || 10;
  const DOWNLOAD_CONCURRENCY =
    batchProblemCount > 0
      ? Math.max(
          1,
          Math.min(baseDownloadConcurrency, Math.ceil(Math.max(1, downloadQueue.length) / 12) || 1),
        )
      : Math.max(1, Math.min(baseDownloadConcurrency, plannedDownloadCap));
  if (downloadQueue.length > 0 && DOWNLOAD_CONCURRENCY < baseDownloadConcurrency) {
    sendStatusMessage(
      `Adaptive mode: download concurrency set to ${DOWNLOAD_CONCURRENCY} for this batch`,
    );
  }

  const downloadOne = async (entry) => {
    checkCancelled();
    const itemStartedAt = Date.now();
    const sanitizedName = sanitizeFilename(entry.name);
    const fileExtension = isSoundMode ? '.ogg' : '.rbxm';
    const fileName = `${sanitizedName}_${entry.id}${fileExtension}`;
    const filePath = path.join(downloadsDir, fileName);
    const downloadTransfer = initialTransferStates.find((t) => t.originalAssetId === entry.id);
    const downloadTransferId = downloadTransfer.id;
    sendTransferUpdate({ id: downloadTransferId, status: 'processing' });
    const creatorKey = normalizeCreatorKey(entry.creatorType, entry.creatorId);
    const entryPlaceIds = normalizePlaceIdCandidates(
      placeIdMap[creatorKey] || DEFAULT_PLACE_ID_CANDIDATES,
    );
    const entryPlaceId = entryPlaceIds[0];

    const tryDownloadUrl = async (url, reason) => {
      await checkPaused();
      checkCancelled();
      if (reason) {
        sendTransferUpdate({ id: downloadTransferId, status: 'processing', message: reason });
      }
      return downloadAnimationAssetWithProgress(
        url,
        robloxCookie,
        filePath,
        downloadTransferId,
        entry.name,
        entry.id,
        sendTransferUpdate,
        entryPlaceId,
        {
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          retries: DOWNLOAD_RETRIES,
          retryDelayMs: DOWNLOAD_RETRY_DELAY_MS,
          signal: runSignal,
          waitForRetry: waitForRunDelay,
          isCancelError,
        },
      );
    };

    const loc = locationsMap[entry.id];
    let batchErrorMessage = '';
    let result = null;
    if (loc && loc.locations && loc.locations.length > 0 && loc.locations[0].location) {
      result = await tryDownloadUrl(loc.locations[0].location);
    } else {
      if (loc && loc.errors && loc.errors.length > 0) {
        const errorObj = loc.errors[0];
        batchErrorMessage =
          errorObj.Message || errorObj.message || JSON.stringify(errorObj) || 'Unknown batch error';
        if (DEVELOPER_MODE) console.log('Batch error for', entry.id, ':', errorObj);
      } else {
        batchErrorMessage = 'No location in batch response';
      }
      const directUrlSet = new Set();
      for (const placeId of entryPlaceIds) {
        directUrlSet.add(
          `https://assetdelivery.roblox.com/v1/asset?id=${encodeURIComponent(entry.id)}&placeId=${encodeURIComponent(String(placeId || ''))}`,
        );
        directUrlSet.add(
          `https://assetdelivery.roblox.com/v1/asset/?id=${encodeURIComponent(entry.id)}&placeId=${encodeURIComponent(String(placeId || ''))}`,
        );
      }
      directUrlSet.add(
        `https://assetdelivery.roblox.com/v1/asset?id=${encodeURIComponent(entry.id)}`,
      );
      directUrlSet.add(
        `https://assetdelivery.roblox.com/v1/asset/?id=${encodeURIComponent(entry.id)}`,
      );
      const directUrls = [...directUrlSet];
      let directAttemptIndex = 0;
      for (const directUrl of directUrls) {
        await checkPaused();
        checkCancelled();
        directAttemptIndex++;
        result = await tryDownloadUrl(
          directUrl,
          `Batch lookup failed; trying direct asset download fallback ${directAttemptIndex}/${directUrls.length}`,
        );
        if (result && result.success) break;
      }
      if (!result || !result.success) {
        downloadCompleted++;
        const etaStr = getEtaString(downloadStartTime, downloadCompleted, downloadQueue.length);
        sendStatusMessage(
          `Downloaded ${downloadCompleted + resumedDownloadResults.length}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`,
        );
        const classified = classifyError(
          `Batch error: ${batchErrorMessage}. Direct fallback: ${result && result.error ? result.error : 'failed'}`,
          { stage: 'download' },
        );
        const failure = createStageFailure(entry, 'download', classified.raw, {
          category: classified.category,
          userMessage: classified.message,
          rawError: batchErrorMessage,
          retryable: classified.retryable === true,
        });
        failure.durationMs = Date.now() - itemStartedAt;
        stageMetrics.mark('download', failure);
        return failure;
      }
    }
    downloadCompleted++;
    const etaStr = getEtaString(downloadStartTime, downloadCompleted, downloadQueue.length);
    sendStatusMessage(
      `Downloaded ${downloadCompleted + resumedDownloadResults.length}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`,
    );
    if (!result.success) {
      const classified = classifyError(result.error || 'Download failed', { stage: 'download' });
      const failure = createStageFailure(entry, 'download', classified.raw, {
        category: classified.category,
        userMessage: classified.message,
        retryable: classified.retryable === true,
      });
      failure.durationMs = Date.now() - itemStartedAt;
      stageMetrics.mark('download', failure);
      return failure;
    }
    if (!session.completedDownloads.some((item) => String(item.originalId) === String(entry.id))) {
      session.completedDownloads.push({
        originalId: String(entry.id),
        filePath,
        name: entry.name,
        bytesWritten: result.bytesWritten || 0,
        downloadedAt: new Date().toISOString(),
      });
      session.lastUpdatedAt = new Date().toISOString();
      await persistSession();
    }
    const success = createStageSuccess(entry, 'download', {
      filePath,
      error: result.error,
      bytesWritten: result.bytesWritten || 0,
      durationMs: Date.now() - itemStartedAt,
    });
    stageMetrics.mark('download', success);
    return success;
  };
  const downloadResults = [
    ...resumedDownloadResults,
    ...(downloadQueue.length > 0
      ? await runWithConcurrency(downloadQueue, DOWNLOAD_CONCURRENCY, downloadOne)
      : []),
  ];
  if (_isCancelled) {
    sendSpooferResultToRenderer({
      output: 'Run canceled.',
      success: false,
      failedAnimationIdInput: animationEntries.map(formatAssetEntry).join('\n'),
      failedCount: animationEntries.length,
      summary: {
        total: animationEntries.length + cachedHistoryMappings.length,
        downloaded: downloadResults.filter((r) => r && r.success).length,
        uploaded: 0,
        cached: cachedHistoryMappings.length,
        downloadFailures: downloadResults.filter((r) => r && !r.success && !r.canceled).length,
        uploadFailures: 0,
        skippedUploads: Math.max(
          0,
          animationEntries.length - downloadResults.filter((r) => r && r.success).length,
        ),
        downloadOnly: !!data.downloadOnly,
        mode: 'Canceled',
        failureCategories: { Canceled: 1 },
        failures: [],
        mappings: (uploadMappingOutput || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      },
    });
    session.status = 'incomplete';
    session.lastUpdatedAt = new Date().toISOString();
    await persistSession({ force: true });
    await persistAssetHistory({ force: true });
    sendStatusMessage('Run canceled');
    resetRunControls();
    return;
  }
  let authenticatedUserId = null;
  if (!data.downloadOnly && data.apiKey && !data.groupId) {
    try {
      authenticatedUserId =
        preflightAuthenticatedUserId || (await getAuthenticatedUserId(robloxCookie));
      if (DEVELOPER_MODE)
        console.log(`(Dev) Resolved authenticated user ID for upload: ${authenticatedUserId}`);
    } catch (err) {
      if (DEVELOPER_MODE)
        console.warn(`(Dev) Could not resolve authenticated user ID: ${err.message}`);
      const classified = classifyError(err, { stage: 'upload' });
      if (classified.category === 'bad_cookie') {
        sendSpooferResultToRenderer({
          output: `Failed to resolve your Roblox user ID: ${classified.message}\n\nMake sure your cookie is valid.`,
          success: false,
        });
        return;
      }
      sendStatusMessage(
        `Warning: could not resolve user ID before upload (${classified.message}). The app will try Open Cloud upload without an explicit user creator.`,
      );
    }
  }
  let uploadResults = [];
  if (data.downloadOnly) {
    sendStatusMessage('Download-only mode: Skipping uploads');
    if (DEVELOPER_MODE) console.log('(Dev) Download-only mode enabled, skipping all uploads');
  } else {
    sendStatusMessage(`Uploading ${isSoundMode ? 'sounds' : 'animations'}...`);
    let uploadCompleted = 0;
    const uploadStartTime = Date.now();
    const successfulDownloads = downloadResults.filter((r) => r.success);
    const plannedUploadCap = batchPlan.uploadConcurrencyCap || 10;
    const UPLOAD_CONCURRENCY = Math.min(
      parseInt(data.uploadConcurrency, 10) || 10,
      plannedUploadCap,
      successfulDownloads.length || 1,
    );
    let hardUploadStop = null;
    if (UPLOAD_CONCURRENCY < (parseInt(data.uploadConcurrency, 10) || 10)) {
      sendStatusMessage(
        `Adaptive mode: upload concurrency set to ${UPLOAD_CONCURRENCY} for this batch`,
      );
    }

    const uploadOne = async (downloadResult) => {
      if (hardUploadStop) {
        return createStageFailure(downloadResult.entry, 'upload', hardUploadStop.message, {
          category: hardUploadStop.category,
          userMessage: hardUploadStop.message,
          retryable: false,
          suggestedFix: hardUploadStop.suggestedFix,
        });
      }
      const itemStartedAt = Date.now();
      const entry = downloadResult.entry;
      const filePath = downloadResult.filePath;
      const uploadTransferId = crypto.randomUUID();
      const fileSize = (await fs.stat(filePath).catch(() => ({ size: 0 }))).size;
      sendTransferUpdate({
        id: uploadTransferId,
        name: entry.name,
        originalAssetId: entry.id,
        status: 'queued',
        direction: 'upload',
        progress: 0,
        size: fileSize,
      });

      const uploadFn = async () => {
        await checkPaused();
        checkCancelled();
        const result = await withTimeout(
          () =>
            publishAnimationRbxmWithProgress(
              filePath,
              entry.name,
              robloxCookie,
              csrfToken,
              data.groupId && String(data.groupId).trim() ? data.groupId : null,
              uploadTransferId,
              sendTransferUpdate,
              assetTypeName,
              data.apiKey || null,
              authenticatedUserId || null,
              {
                signal: runSignal,
                waitForDelay: waitForRunDelay,
                beforeNetwork: async () => {
                  await checkPaused();
                  checkCancelled();
                },
                isCancelError,
              },
            ),
          UPLOAD_TIMEOUT_MS,
          `Upload for ${entry.name}`,
        );
        if (!result.success) throw new Error(result.error || 'Upload failed');
        return result;
      };

      const onAttemptFailure = (attempt, maxAttempts, err, classifiedFromRetry, willRetry) => {
        const classified = classifiedFromRetry || classifyError(err, { stage: 'upload' });
        const isFinal = attempt >= maxAttempts || willRetry === false;
        if (DEVELOPER_MODE && classified.category === 'rate_limited') {
          console.warn(`(Dev) [RATE LIMIT DETECTED] ${entry.name}: ${classified.raw}`);
        }
        sendTransferUpdate({
          id: uploadTransferId,
          status: isFinal ? 'error' : 'cooldown',
          message: `${classified.label || classified.category}: ${isFinal || classified.retryable !== true ? 'No more retries.' : 'Waiting before retry...'}`,
          error: classified.message,
          errorCategory: classified.category,
        });
      };

      const onCooldownTick = (remainingSeconds, totalSeconds, nextAttempt, maxAttempts, err) => {
        const classified = classifyError(err, { stage: 'upload' });
        sendTransferUpdate({
          id: uploadTransferId,
          status: 'cooldown',
          progress: Math.max(
            0,
            Math.min(99, Math.round(((totalSeconds - remainingSeconds) / totalSeconds) * 100)),
          ),
          message: `${classified.label || classified.category}: retrying in ${remainingSeconds}s (${nextAttempt}/${maxAttempts})`,
          error: classified.message,
          errorCategory: classified.category,
          cooldownRemaining: remainingSeconds,
        });
        sendStatusMessage(`Paused for cooldown: retrying ${entry.name} in ${remainingSeconds}s`);
      };

      try {
        const uploadResult = await retryWithCooldown(
          uploadFn,
          UPLOAD_RETRIES,
          UPLOAD_RETRY_DELAY_MS,
          onAttemptFailure,
          onCooldownTick,
          {
            stage: 'upload',
            maxDelayMs: 60000,
            waitForDelay: waitForRunDelay,
            beforeAttempt: async () => {
              await checkPaused();
              checkCancelled();
            },
          },
        );
        if (uploadResult.success && uploadResult.assetId) {
          if (!session.completedMappings.some((m) => String(m.originalId) === String(entry.id))) {
            session.completedMappings.push({
              originalId: String(entry.id),
              newId: uploadResult.assetId,
            });
          }
          const history = await getRunAssetHistory();
          rememberAssetMappingInObject(history, {
            assetTypeName,
            targetKey: uploadTargetKey,
            originalId: entry.id,
            newId: uploadResult.assetId,
            name: entry.name,
          });
          runAssetHistoryDirty = true;
          await persistAssetHistory();
          session.lastUpdatedAt = new Date().toISOString();
          await persistSession();
        }
        uploadCompleted++;
        const etaStr = getEtaString(uploadStartTime, uploadCompleted, successfulDownloads.length);
        sendStatusMessage(
          `Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`,
        );
        const success = createStageSuccess(entry, 'upload', {
          assetId: uploadResult.assetId,
          error: uploadResult.error,
          fileSize,
          durationMs: Date.now() - itemStartedAt,
        });
        stageMetrics.mark('upload', success);
        return success;
      } catch (finalRetryError) {
        const classified = classifyError(finalRetryError, { stage: 'upload' });
        sendTransferUpdate({
          id: uploadTransferId,
          status: 'error',
          error: classified.message,
          errorCategory: classified.category,
          message: `All upload attempts failed: ${classified.label || classified.category}`,
        });
        if (isHardUploadStopCategory(classified.category)) {
          hardUploadStop = classified;
          sendStatusMessage(
            `${classified.label || 'Upload stopped'} - remaining uploads were skipped to avoid wasting requests`,
          );
        }
        uploadCompleted++;
        const etaStr = getEtaString(uploadStartTime, uploadCompleted, successfulDownloads.length);
        sendStatusMessage(
          `Uploaded ${uploadCompleted}/${successfulDownloads.length} ${isSoundMode ? 'sounds' : 'animations'}${etaStr}`,
        );
        const failure = createStageFailure(entry, 'upload', classified.raw, {
          category: classified.category,
          userMessage: classified.message,
          retryable: classified.retryable === true,
        });
        failure.durationMs = Date.now() - itemStartedAt;
        failure.fileSize = fileSize;
        stageMetrics.mark('upload', failure);
        return failure;
      }
    };
    uploadResults = await runWithConcurrency(successfulDownloads, UPLOAD_CONCURRENCY, uploadOne, {
      shouldContinue: () => !hardUploadStop,
    });
    if (hardUploadStop) {
      const attemptedIds = new Set(
        uploadResults.map((result) => (result && result.entry ? String(result.entry.id) : '')),
      );
      for (const downloadResult of successfulDownloads) {
        if (attemptedIds.has(String(downloadResult.entry.id))) continue;
        const skipped = createStageFailure(
          downloadResult.entry,
          'upload',
          hardUploadStop.raw || hardUploadStop.message,
          {
            category: hardUploadStop.category,
            userMessage: `Skipped after ${hardUploadStop.label || 'a hard upload failure'}: ${hardUploadStop.message}`,
            retryable: false,
            suggestedFix: hardUploadStop.suggestedFix,
          },
        );
        skipped.skipped = true;
        uploadResults.push(skipped);
      }
    }
    if (_isCancelled) sendStatusMessage('Run canceled after current upload finished');
  }

  const uploadResultByEntryId = new Map(
    (uploadResults || []).map((u) => [String(u.entry && u.entry.id), u]),
  );
  for (const downloadResult of downloadResults) {
    const entry = downloadResult.entry;
    verboseOutputMessage += `\n--- Processing: ${entry.name} (ID: ${entry.id}) ---\n`;
    if (downloadResult.success) {
      downloadedSuccessfullyCount++;
      verboseOutputMessage += `✓ Downloaded: ${entry.name} (ID: ${entry.id}) to ${downloadResult.filePath}\n`;
      if (!data.downloadOnly) {
        const uploadResult = uploadResultByEntryId.get(String(entry.id));
        if (uploadResult) {
          if (uploadResult.success) {
            successfulUploadCount++;
            uploadMappingOutput += `${entry.id} = ${uploadResult.assetId},\n`;
            verboseOutputMessage += `✓ Uploaded ${isSoundMode ? 'Sound' : 'Animation'}: ${entry.name} (Original ID: ${entry.id}) -> New Asset ID: ${uploadResult.assetId}\n`;
          } else {
            console.error(
              `[${isSoundMode ? 'SOUND' : 'ANIMATION'} UPLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}`,
            );
            verboseOutputMessage += `✗ ${isSoundMode ? 'Sound' : 'Animation'} Upload Failed: ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}\n`;
          }
        } else {
          console.error(`[UPLOAD SKIPPED] ${entry.name} (ID: ${entry.id}): Download failed.`);
          verboseOutputMessage += `! Skipped Upload for ${entry.name}: Download failed.\n`;
        }
      }
    } else {
      console.error(`[DOWNLOAD FAILED] ${entry.name} (ID: ${entry.id}): ${downloadResult.error}`);
      verboseOutputMessage += `✗ Download Failed: ${entry.name} (ID: ${entry.id}) - ${downloadResult.error}\n`;
    }
  }

  verboseOutputMessage += `\n--- Summary ---\nTotal ${isSoundMode ? 'sounds' : 'animations'}: ${animationEntries.length}\nDownloaded: ${downloadedSuccessfullyCount}\n`;
  if (!data.downloadOnly) {
    verboseOutputMessage += `Uploaded: ${successfulUploadCount}\n\n--- Output Mapping ---\n${uploadMappingOutput}`;
  } else {
    verboseOutputMessage += `Uploads: Skipped (Download-Only Mode)\n`;
  }

  try {
    if (data.downloadOnly) {
      sendStatusMessage('Run complete - see Run Report');
    } else {
      sendStatusMessage('Run complete - see Run Report');
    }
  } catch (e) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to send final status message', e);
  }

  const finishedAt = new Date().toISOString();
  const durationSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(session.startedAt || Date.now()).getTime()) / 1000),
  );
  const downloadFailures = downloadResults
    .filter((r) => !r.success)
    .map((r) => {
      const classified = classifyError(r.rawError || r.error || 'Unknown error');
      return {
        id: r.entry.id,
        name: r.entry.name,
        creator: `${r.entry.creatorType}:${r.entry.creatorId}`,
        stage: r.stage || 'download',
        reason: r.error || classified.message,
        category: r.errorCategory || classified.category,
        label: r.errorLabel || classified.label,
        raw: r.rawError || classified.raw,
        retryable: r.retryable === true,
        suggestedFix: r.suggestedFix || classified.suggestedFix,
      };
    });
  const uploadFailures = data.downloadOnly
    ? []
    : (uploadResults || [])
        .filter((u) => !u.success)
        .map((u) => {
          const classified = classifyError(u.rawError || u.error || 'Unknown error');
          return {
            id: u.entry.id,
            name: u.entry.name,
            creator: `${u.entry.creatorType}:${u.entry.creatorId}`,
            stage: u.stage || 'upload',
            reason: u.error || classified.message,
            category: u.errorCategory || classified.category,
            label: u.errorLabel || classified.label,
            raw: u.rawError || classified.raw,
            retryable: u.retryable === true,
            suggestedFix: u.suggestedFix || classified.suggestedFix,
          };
        });
  const rateLimitFailures = uploadFailures.filter(
    (f) =>
      f.category === 'rate_limited' ||
      (f.reason || '').includes('429') ||
      (f.reason || '').includes('Rate limit'),
  );

  const skippedUploadsCount = data.downloadOnly ? 0 : downloadFailures.length;

  const listFailures = (label, items) => {
    if (!items || items.length === 0) return '';
    const maxItems = 5;
    const lines = items
      .slice(0, maxItems)
      .map(
        (it) =>
          `- ${it.name} (ID: ${it.id}) - ${it.label || it.category ? `[${it.label || it.category}] ` : ''}${it.reason}${it.suggestedFix ? ` (${it.suggestedFix})` : ''}`,
      );
    const remaining = items.length - maxItems;
    return `${label}:\n${lines.join('\n')}${remaining > 0 ? `\n(+${remaining} more…)` : ''}\n`;
  };

  let runSummary =
    `\n--- Summary ---\n` +
    `Mode: ${data.downloadOnly ? 'Download-Only' : 'Download + Upload'}\n` +
    `Total ${isSoundMode ? 'sounds' : 'animations'}: ${animationEntries.length}\n` +
    `Downloaded: ${downloadedSuccessfullyCount}/${animationEntries.length}${downloadFailures.length ? ` (Failed: ${downloadFailures.length})` : ''}\n` +
    (!data.downloadOnly
      ? `Uploaded: ${successfulUploadCount}/${downloadResults.filter((r) => r.success).length}${uploadFailures.length ? ` (Failed: ${uploadFailures.length}, Skipped: ${skippedUploadsCount})` : skippedUploadsCount ? ` (Skipped: ${skippedUploadsCount})` : ''}\n`
      : '');

  const groupedFailureCounts = [...downloadFailures, ...uploadFailures].reduce((acc, failure) => {
    const key = failure.category || 'Unknown error';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  if (Object.keys(groupedFailureCounts).length > 0) {
    runSummary +=
      `\nFailure groups:\n` +
      Object.entries(groupedFailureCounts)
        .map(([category, count]) => `- ${count} ${category}`)
        .join('\n') +
      `\n`;
  }
  if (downloadFailures.length) {
    runSummary += `\n` + listFailures('Download failures', downloadFailures);
  }
  if (!data.downloadOnly && uploadFailures.length) {
    runSummary += `\n` + listFailures('Upload failures', uploadFailures);
  }
  if (rateLimitFailures.length > 0) {
    const suggestedDelay = Math.min(Math.max(UPLOAD_RETRY_DELAY_MS * 2, 10000), 60000);
    runSummary += `\nRATE LIMIT DETECTED (429): ${rateLimitFailures.length} upload(s) hit rate limits.\n`;
    runSummary += `   Recommendation: Try again with higher "Retry Delay" (current: ${UPLOAD_RETRY_DELAY_MS}ms, suggested: ${suggestedDelay}ms)\n`;
    runSummary += `   Or increase "Upload Retries" for more attempts.\n`;
  }
  let finalOutput = '';
  if (data.downloadOnly) {
    const successfulDownloadsList = downloadResults
      .filter((r) => r.success)
      .map((r) => `${r.entry.name} (ID: ${r.entry.id})`)
      .join('\n');

    if (successfulDownloadsList) {
      finalOutput = `Downloaded ${downloadedSuccessfullyCount}/${animationEntries.length} ${isSoundMode ? 'sounds' : 'animations'} to:\n${downloadsDir}\n\nFiles:\n${successfulDownloadsList}`;
    } else {
      finalOutput = `No ${isSoundMode ? 'sounds' : 'animations'} were successfully downloaded.`;
    }
  } else if (uploadMappingOutput.trim()) {
    finalOutput = uploadMappingOutput.trim().replace(/,$/, '');
  } else {
    if (downloadedSuccessfullyCount > 0 && successfulUploadCount === 0) {
      finalOutput = `Downloads successful (${downloadedSuccessfullyCount}/${animationEntries.length}), but no ${isSoundMode ? 'sounds' : 'animations'} were successfully uploaded.`;
    } else if (animationEntries.length > 0) {
      finalOutput = hasAuthError
        ? 'Authentication failed. Please check your Roblox cookie.'
        : `No ${isSoundMode ? 'sounds' : 'animations'} were successfully processed to provide mappings.`;
    } else {
      finalOutput = 'No operations performed.';
    }
  }
  try {
    if (DEVELOPER_MODE) {
      console.log('(Dev) Run Summary:\n' + runSummary);
    } else {
      console.log('Run Summary:\n' + runSummary);
    }
  } catch {}

  const failedEntriesForRetry = dedupeAssetEntries([
    ...downloadFailures
      .map((failure) => animationEntries.find((entry) => String(entry.id) === String(failure.id)))
      .filter(Boolean),
    ...uploadFailures
      .map((failure) => animationEntries.find((entry) => String(entry.id) === String(failure.id)))
      .filter(Boolean),
  ]);
  const failedAnimationIdInput = failedEntriesForRetry.map(formatAssetEntry).join('\n');

  if (failedEntriesForRetry.length > 0) {
    session.status = 'incomplete';
    session.lastUpdatedAt = new Date().toISOString();
    const failuresById = new Map(
      [...downloadFailures, ...uploadFailures].map((failure) => [String(failure.id), failure]),
    );
    session.failedEntries = failedEntriesForRetry.map((entry) => {
      const failure = failuresById.get(String(entry.id)) || {};
      return {
        id: String(entry.id),
        name: entry.name,
        creatorType: entry.creatorType,
        creatorId: String(entry.creatorId),
        stage: failure.stage || 'unknown',
        category: failure.category || 'unknown',
        label: failure.label || '',
        reason: failure.reason || '',
        retryable: failure.retryable === true,
        suggestedFix: failure.suggestedFix || '',
      };
    });
    session.retryAnimationIdInput = failedAnimationIdInput;
    session.totalCount = animationEntries.length;
    await persistSession({ force: true });
  } else {
    session.status = 'complete';
    cancelPendingSessionSave();
    await sessionSaveBuffer.settle();
    await clearSession();
  }

  await persistAssetHistory({ force: true });

  sendSpooferResultToRenderer({
    output: finalOutput,
    success: downloadedSuccessfullyCount > 0 || successfulUploadCount > 0,
    failedAnimationIdInput,
    failedCount: failedEntriesForRetry.length,
    summary: {
      total: animationEntries.length + cachedHistoryMappings.length,
      downloaded: downloadedSuccessfullyCount,
      uploaded: successfulUploadCount,
      downloadFailures: downloadFailures.length,
      uploadFailures: uploadFailures.length,
      cached: cachedHistoryMappings.length,
      skippedUploads: skippedUploadsCount,
      downloadOnly: !!data.downloadOnly,
      mode: data.downloadOnly ? 'Download-Only' : 'Download + Upload',
      startedAt: session.startedAt,
      finishedAt,
      durationSeconds,
      failureCategories: [...downloadFailures, ...uploadFailures].reduce((acc, f) => {
        acc[f.category || 'Unknown error'] = (acc[f.category || 'Unknown error'] || 0) + 1;
        return acc;
      }, {}),
      failures: [...downloadFailures, ...uploadFailures],
      stageFailures: [
        ...summarizeStageFailures(downloadResults, 'download'),
        ...summarizeStageFailures(uploadResults, 'upload'),
      ],
      performance: stageMetrics.summary(),
      mappings: (uploadMappingOutput || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      successfulMappings: (uploadResults || [])
        .filter((item) => item && item.success && item.assetId && item.entry)
        .map((item) => ({
          name: item.entry.name,
          originalId: item.entry.id,
          newId: item.assetId,
          creator: `${item.entry.creatorType}:${item.entry.creatorId}`,
          assetType: assetTypeName,
        })),
      cachedMappings: cachedHistoryMappings.map((item) => ({
        name: item.entry.name,
        originalId: item.entry.id,
        newId: item.newId,
        savedAt: item.savedAt || '',
      })),
    },
  });
  if (!data.downloadOnly) {
    try {
      await clearDownloadsDirectory(downloadsDir, false);
      if (DEVELOPER_MODE) console.log('(Dev) Downloads directory cleared after operation');
    } catch (err) {
      if (DEVELOPER_MODE)
        console.warn('(Dev) Failed to clear downloads directory after operation:', err.message);
    }
  } else {
    if (DEVELOPER_MODE) console.log('(Dev) Download-only mode: keeping files in', downloadsDir);
  }
}

module.exports = {
  registerIpcHandlers,
};
