(() => {
  const api = window.electronAPI || {};
  const appShell = document.getElementById('app-shell');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const minimizeBtn = document.getElementById('minimize-btn');
  const closeBtn = document.getElementById('close-btn');
  const profilePicker = document.querySelector('.profile-picker');
  const profileTrigger = document.getElementById('profile-trigger');
  const profileTriggerLabel = document.getElementById('profile-trigger-label');
  const profileMenu = document.getElementById('profile-menu');
  let profileOptions = Array.from(document.querySelectorAll('.profile-option'));
  const notificationStack = document.getElementById('app-notifications');
  const tooltip = document.getElementById('settings-tooltip');
  const accentSwatch = document.getElementById('accent-swatch');
  const accentPicker = document.getElementById('accent-picker');
  const spooferInput = document.getElementById('spoofer-input');
  const spooferInputLabel = document.getElementById('spoofer-input-label');
  const spooferDownloadOnly = document.getElementById('spoofer-download-only');
  const spooferEnableSpoofing = document.getElementById('spoofer-enable-spoofing');
  const spooferCookieInput = document.getElementById('spoofer-cookie-input');
  const spooferOverridePlace = document.getElementById('spoofer-override-place');
  const spooferMaxPlaceIds = document.getElementById('spoofer-max-place-ids');
  const spooferPlaceRetries = document.getElementById('spoofer-place-retries');
  const spooferUploadRetries = document.getElementById('spoofer-upload-retries');
  const spooferStart = document.getElementById('spoofer-start');
  const spooferPause = document.getElementById('spoofer-pause');
  const spooferResume = document.getElementById('spoofer-resume');
  const spooferCancel = document.getElementById('spoofer-cancel');
  const spooferProfileName = document.getElementById('spoofer-profile-name');
  const spooferTargetSummary = document.getElementById('spoofer-target-summary');
  const spooferApiSummary = document.getElementById('spoofer-api-summary');
  const spooferCookieSummary = document.getElementById('spoofer-cookie-summary');
  const spooferLimitsSummary = document.getElementById('spoofer-limits-summary');
  const spooferDetectedType = document.getElementById('spoofer-detected-type');
  const spooferParsedCount = document.getElementById('spoofer-parsed-count');
  const spooferDuplicateCount = document.getElementById('spoofer-duplicate-count');
  const spooferInvalidCount = document.getElementById('spoofer-invalid-count');
  const spooferReadyCount = document.getElementById('spoofer-ready-count');
  const spooferPreflightNote = document.getElementById('spoofer-preflight-note');
  const spooferLivePopup = document.getElementById('spoofer-live-popup');
  const spooferLiveProgress = document.getElementById('spoofer-live-progress');
  const spooferLiveProgressLabel = document.getElementById('spoofer-live-progress-label');
  const spooferLiveStage = document.getElementById('spoofer-live-stage');
  const spooferLiveElapsed = document.getElementById('spoofer-live-elapsed');
  const spooferOutputState = document.getElementById('spoofer-output-state');
  const spooferOutput = document.getElementById('spoofer-output');
  const spooferCopyOutput = document.getElementById('spoofer-copy-output');
  const spooferCopyRetry = document.getElementById('spoofer-copy-retry');
  const spooferOpenActivity = document.getElementById('spoofer-open-activity');
  const spooferSoundToggle = document.getElementById('spoofer-sound-toggle');
  const soundToggleAuto = document.getElementById('sound-toggle-auto');
  const quotaInfoBtn = document.getElementById('quota-info-btn');
  const quotaPopup = document.getElementById('quota-popup');
  const quotaPopupText = document.getElementById('quota-popup-text');
  const identityPreview = document.getElementById('identity-preview');
  const identityUserAvatar = document.getElementById('identity-user-avatar');
  const identityGroupAvatar = document.getElementById('identity-group-avatar');
  const identityUserName = document.getElementById('identity-user-name');
  const identityGroupName = document.getElementById('identity-group-name');
  const identityUserMeta = document.getElementById('identity-user-meta');
  const identityGroupMeta = document.getElementById('identity-group-meta');
  const buildVersion = document.getElementById('build-version');
  const buildSource = document.getElementById('build-source');
  const profilesList = document.getElementById('profiles-list');
  const profileCreate = document.getElementById('profile-create');
  const profileDuplicate = document.getElementById('profile-duplicate');
  const profileRename = document.getElementById('profile-rename');
  const profileDelete = document.getElementById('profile-delete');
  const profileGroupId = document.getElementById('profile-group-id');
  const profileAutoCookie = document.getElementById('profile-auto-cookie');
  const profileApiKeyInput = document.getElementById('profile-api-key-input');
  const profileApiKeyGet = document.getElementById('profile-api-key-get');
  const profileApiStatus = document.getElementById('profile-api-status');
  const profileRefreshRoblox = document.getElementById('profile-refresh-roblox');
  const profileReset = document.getElementById('profile-reset');
  const profileClearCredentials = document.getElementById('profile-clear-credentials');
  const confirmGate = document.getElementById('confirm-gate');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmCancel = document.getElementById('confirm-cancel');
  const confirmAccept = document.getElementById('confirm-accept');
  const renameGate = document.getElementById('rename-gate');
  const renameProfileInput = document.getElementById('rename-profile-input');
  const renameCancel = document.getElementById('rename-cancel');
  const renameSave = document.getElementById('rename-save');
  const queueStatus = document.getElementById('queue-status');
  const queueMode = document.getElementById('queue-mode');
  const queueMetricTotal = document.getElementById('queue-metric-total');
  const queueMetricActive = document.getElementById('queue-metric-active');
  const queueMetricQueued = document.getElementById('queue-metric-queued');
  const queueMetricCompleted = document.getElementById('queue-metric-completed');
  const queueMetricFailed = document.getElementById('queue-metric-failed');
  const queueMetricProgress = document.getElementById('queue-metric-progress');
  const queueFilters = document.getElementById('queue-filters');
  const queueSearch = document.getElementById('queue-search');
  const queueRows = document.getElementById('queue-rows');
  const queueEmpty = document.getElementById('queue-empty');
  const queueDetailList = document.getElementById('queue-detail-list');
  const queueDetailError = document.getElementById('queue-detail-error');
  const queueDetailMessage = document.getElementById('queue-detail-message');
  const queuePause = document.getElementById('queue-pause');
  const queueResume = document.getElementById('queue-resume');
  const queueCancel = document.getElementById('queue-cancel');
  const queueClearDone = document.getElementById('queue-clear-done');
  const queueClearAll = document.getElementById('queue-clear-all');
  const queueOpenLogs = document.getElementById('queue-open-logs');
  const runReportStatus = document.getElementById('run-report-status');
  const runReportMode = document.getElementById('run-report-mode');
  const runMetricTotal = document.getElementById('run-metric-total');
  const runMetricSuccess = document.getElementById('run-metric-success');
  const runMetricFailed = document.getElementById('run-metric-failed');
  const runMetricSkipped = document.getElementById('run-metric-skipped');
  const runMetricDuration = document.getElementById('run-metric-duration');
  const runMetricFinished = document.getElementById('run-metric-finished');
  const runReportFilters = document.getElementById('run-report-filters');
  const runReportSearch = document.getElementById('run-report-search');
  const runReportRows = document.getElementById('run-report-rows');
  const runReportEmpty = document.getElementById('run-report-empty');
  const runDetailList = document.getElementById('run-detail-list');
  const runDetailRaw = document.getElementById('run-detail-raw');
  const runDetailFix = document.getElementById('run-detail-fix');
  const runDetailMapping = document.getElementById('run-detail-mapping');
  const runCopyFailed = document.getElementById('run-copy-failed');
  const runCopyMappings = document.getElementById('run-copy-mappings');
  const runExportReport = document.getElementById('run-export-report');
  const runOpenLogs = document.getElementById('run-open-logs');
  const runRetryFailed = document.getElementById('run-retry-failed');
  const runClearReport = document.getElementById('run-clear-report');
  const apiKeyGate = document.getElementById('api-key-gate');
  const apiKeyEntryStep = document.getElementById('api-key-entry-step');
  const apiKeySuccessStep = document.getElementById('api-key-success-step');
  const apiKeyInput = document.getElementById('api-key-input');
  const apiKeyError = document.getElementById('api-key-error');
  const apiKeyDone = document.getElementById('api-key-done');
  const apiKeyGet = document.getElementById('api-key-get');
  const activityTabs = document.querySelector('.activity-tabs');
  const activityReportPanel = document.querySelector('[data-activity-panel="report"]');
  let activeTooltipAnchor = null;
  let reportFilter = 'all';
  let selectedReportRowId = '';
  let queueFilter = 'all';
  let selectedQueueItemId = '';
  let spooferRunStartedAt = 0;
  let spooferElapsedTimer = null;
  let spooferLastRetryInput = '';
  let spooferRunStatus = 'idle';
  let latestStatusMessage = '';
  let soundModeManualOverride = null;
  let runStartTime = null;
  const queueStateCache = new Map();
  const queuePersistTimers = new Map();

  if (tooltip && tooltip.parentElement !== document.body) {
    document.body.appendChild(tooltip);
  }
  if (notificationStack && notificationStack.parentElement !== document.body) {
    document.body.appendChild(notificationStack);
  }
  const legacyRunReportView = document.querySelector('[data-view-panel="run-report"]');
  const runReportPage = legacyRunReportView?.querySelector('.run-report-page');
  if (activityReportPanel && runReportPage) {
    activityReportPanel.appendChild(runReportPage);
    legacyRunReportView?.remove();
  }

  const settingsKey = 'ispoofermotion:settings';
  const notificationTextCache = new Map();
  const defaultAccent = '#4caf50';
  const numericDefaults = {
    queueBatchSize: '20',
    downloadWorkers: '10',
  };
  const profileSyncedSettings = new Set([
    'accentColour',
    'queueBatchSize',
    'downloadWorkers',
    'saveRunReports',
    'downloadsFolder',
    'reportsFolder',
  ]);

  const loadSavedSettings = () => {
    try {
      return JSON.parse(localStorage.getItem(settingsKey) || '{}');
    } catch {
      return {};
    }
  };

  const saveSetting = (key, value) => {
    if (!key) return;
    const next = { ...loadSavedSettings(), [key]: value };
    localStorage.setItem(settingsKey, JSON.stringify(next));
    if (profileSyncedSettings.has(key)) writeActiveProfileSettingFromSettingsPage(key, value);
  };

  const saveAllSettings = (settings) => {
    localStorage.setItem(settingsKey, JSON.stringify(settings || {}));
  };

  const savedSettings = loadSavedSettings();

  const createProfileId = () =>
    `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const sanitizeProfileName = (value, fallback = 'Profile') => {
    const clean = String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 32);
    return clean || fallback;
  };
  const normalizeProfile = (profile, index = 0) => ({
    id: String(profile?.id || createProfileId()),
    name: sanitizeProfileName(profile?.name, `Profile ${index + 1}`),
    groupId: String(profile?.groupId || '').replace(/\D/g, ''),
    autoDetectCookie: profile?.autoDetectCookie !== false,
    robloxCookie: String(profile?.robloxCookie || ''),
    apiKey: String(profile?.apiKey || ''),
    robloxUserId: String(profile?.robloxUserId || ''),
    robloxUserName: String(profile?.robloxUserName || ''),
    robloxGroupName: String(profile?.robloxGroupName || ''),
    robloxUserAvatar: String(profile?.robloxUserAvatar || ''),
    robloxGroupAvatar: String(profile?.robloxGroupAvatar || ''),
    accentColour: String(profile?.accentColour || defaultAccent),
    queueBatchSize: String(profile?.queueBatchSize || numericDefaults.queueBatchSize),
    downloadWorkers: String(profile?.downloadWorkers || numericDefaults.downloadWorkers),
    saveRunReports: profile?.saveRunReports !== false,
    downloadsFolder: String(profile?.downloadsFolder || ''),
    reportsFolder: String(profile?.reportsFolder || ''),
    runReports: Array.isArray(profile?.runReports) ? profile.runReports.slice(0, 20) : [],
    queueItems: Array.isArray(profile?.queueItems) ? profile.queueItems.slice(0, 400) : [],
    queueStatus: String(profile?.queueStatus || ''),
    queueUpdatedAt: String(profile?.queueUpdatedAt || ''),
    lastRunAt: profile?.lastRunAt || '',
  });
  const normalizeProfileState = (settings) => {
    const source = settings || {};
    const profiles =
      Array.isArray(source.profiles) && source.profiles.length
        ? source.profiles.map(normalizeProfile)
        : [
            normalizeProfile({
              id: 'profile-1',
              name: 'Profile 1',
              groupId: source.groupId || '',
              autoDetectCookie: source.autoDetectCookie !== false,
              robloxCookie: source.robloxCookie || '',
              apiKey: source.profile1ApiKey || source.apiKey || '',
              robloxUserId: source.robloxUserId || '',
              robloxUserName: source.robloxUserName || '',
              robloxGroupName: source.robloxGroupName || '',
              robloxUserAvatar: source.robloxUserAvatar || '',
              robloxGroupAvatar: source.robloxGroupAvatar || '',
              accentColour: source.accentColour || defaultAccent,
              queueBatchSize: source.queueBatchSize || numericDefaults.queueBatchSize,
              downloadWorkers: source.downloadWorkers || numericDefaults.downloadWorkers,
              saveRunReports: source.saveRunReports !== false,
              downloadsFolder: source.downloadsFolder || '',
              reportsFolder: source.reportsFolder || '',
              lastRunAt: source.lastRunAt || '',
            }),
          ];
    const activeProfileId = profiles.some((profile) => profile.id === source.activeProfileId)
      ? source.activeProfileId
      : profiles[0].id;
    return { ...source, profiles, activeProfileId };
  };
  const getProfileState = () => normalizeProfileState(loadSavedSettings());
  const getActiveProfile = () => {
    const state = getProfileState();
    return (
      state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0]
    );
  };
  const syncActiveProfileToLegacy = (settings) => {
    const active =
      settings.profiles.find((profile) => profile.id === settings.activeProfileId) ||
      settings.profiles[0];
    return {
      ...settings,
      groupId: active.groupId,
      autoDetectCookie: active.autoDetectCookie,
      robloxCookie: active.robloxCookie,
      profile1ApiKey: active.apiKey,
      apiKeySetupDone: Boolean(active.apiKey) || settings.apiKeySetupDone === true,
      robloxUserName: active.robloxUserName,
      robloxUserId: active.robloxUserId,
      robloxGroupName: active.robloxGroupName,
      robloxUserAvatar: active.robloxUserAvatar,
      robloxGroupAvatar: active.robloxGroupAvatar,
      accentColour: active.accentColour,
      queueBatchSize: active.queueBatchSize,
      downloadWorkers: active.downloadWorkers,
      saveRunReports: active.saveRunReports,
      downloadsFolder: active.downloadsFolder,
      reportsFolder: active.reportsFolder,
      lastRunAt: active.lastRunAt,
    };
  };
  const saveProfileState = (state) => {
    const normalized = syncActiveProfileToLegacy(normalizeProfileState(state));
    saveAllSettings(normalized);
    return normalized;
  };
  saveProfileState(savedSettings);

  const cleanNumberInput = (input) => {
    if (!input) return;
    const cleanValue = String(input.value || '').replace(/\D/g, '');
    input.value =
      cleanValue ||
      String(
        input.dataset.defaultValue ||
          numericDefaults[input.dataset.setting] ||
          input.defaultValue ||
          '0',
      );
  };

  const normalizeNotice = (payload, fallbackType = 'warning') => {
    if (!payload) return null;
    if (typeof payload === 'string') return { type: fallbackType, message: payload };
    const message = String(payload.message || payload.text || '').trim();
    if (!message) return null;
    const rawType = String(payload.type || fallbackType).toLowerCase();
    const type = ['success', 'status', 'info', 'warning', 'error'].includes(rawType)
      ? rawType
      : fallbackType;
    return { type: type === 'info' ? 'status' : type, message };
  };

  const MAX_TOASTS = 4;

  const showNotice = (payload, fallbackType = 'warning') => {
    const notice = normalizeNotice(payload, fallbackType);
    if (!notice || !notificationStack) return;

    const cacheKey = `${notice.type}:${notice.message}`;
    const now = Date.now();
    if (notificationTextCache.has(cacheKey) && now - notificationTextCache.get(cacheKey) < 900)
      return;
    notificationTextCache.set(cacheKey, now);

    const existing = notificationStack.querySelectorAll('.app-notification.show');
    if (existing.length >= MAX_TOASTS) {
      const oldest = existing[0];
      oldest.classList.remove('show');
      window.setTimeout(() => oldest.remove(), 110);
    }

    const item = document.createElement('button');
    item.type = 'button';
    item.className = `app-notification ui-toast ${notice.type}`;
    item.setAttribute('aria-label', `Dismiss ${notice.type} notification`);
    const kind = document.createElement('span');
    kind.className = 'notice-kind';
    kind.textContent =
      notice.type === 'error'
        ? 'Error'
        : notice.type === 'warning'
          ? 'Warning'
          : notice.type === 'success'
            ? 'Success'
            : 'Status';
    const message = document.createElement('span');
    message.className = 'notice-message';
    message.textContent = notice.message;
    const timer = document.createElement('span');
    timer.className = 'notice-timer';
    timer.setAttribute('aria-hidden', 'true');
    item.append(kind, message, timer);

    const dismiss = () => {
      item.classList.remove('show');
      window.setTimeout(() => item.remove(), 110);
    };

    item.addEventListener('click', dismiss);
    notificationStack.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    const autoMs =
      notice.type === 'error'
        ? 5000
        : notice.type === 'status'
          ? 2000
          : notice.type === 'warning'
            ? 4000
            : 2500;
    window.setTimeout(dismiss, autoMs);
  };

  const getNoticeTypeFromStatus = (message) => {
    const text = String(message || '').trim();
    if (!text) return null;
    if (/^\d+\s*\/\s*\d+/.test(text) || /\bETA\b/i.test(text)) return null;
    if (
      /\b(error|failed|failure|invalid|blocked|denied|timed out|timeout|crash|unexpected)\b/i.test(
        text,
      )
    ) {
      return 'error';
    }
    if (/\b(warn|warning|canceled|cancelled|retry|paused|missing|skipped)\b/i.test(text)) {
      return 'warning';
    }
    if (
      /\b(complete|completed|success|successful|ready|opened|exported|copied|cleared|refreshed|selected|saved|loaded|started|starting)\b/i.test(
        text,
      )
    ) {
      return 'success';
    }
    if (/\b(preflight|running|resuming|canceling|download-only|using saved|reused)\b/i.test(text)) {
      return 'status';
    }
    return null;
  };

  const openUrl = (url) => {
    if (!url || typeof api.openExternal !== 'function') return;
    api.openExternal(url);
  };

  const setButtonBusy = (button, busy, label = 'Working') => {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.dataset.previousDisabled = String(button.disabled === true);
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = label;
      return;
    }
    button.classList.remove('is-loading');
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    button.disabled = button.dataset.previousDisabled === 'true';
    delete button.dataset.previousDisabled;
  };

  const runButtonTask = async (button, task, options = {}) => {
    const busyLabel = options.busyLabel || 'Working';
    let result = null;
    let taskError = null;
    try {
      setButtonBusy(button, true, busyLabel);
      result = await task();
    } catch (err) {
      taskError = err;
    } finally {
      setButtonBusy(button, false);
    }
    if (taskError) {
      pulseButton(button, options.failedLabel || 'Failed');
      showNotice(
        taskError && taskError.message
          ? taskError.message
          : options.errorMessage || 'Action failed. Try again.',
        'error',
      );
      return null;
    }
    if (options.doneLabel) {
      pulseButton(button, options.doneLabel);
      showNotice(options.successMessage || options.doneLabel, 'success');
    }
    return result;
  };

  const setActiveView = (view) => {
    const targetPanel = document.querySelector(`[data-view-panel="${CSS.escape(view)}"]`);
    if (!targetPanel) return;

    document.querySelectorAll('.side-link').forEach((entry) => {
      entry.classList.toggle('active', entry.dataset.view === view);
    });

    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel === targetPanel);
    });
  };

  const closeProfileMenu = () => {
    profilePicker?.classList.remove('open');
    profileTrigger?.setAttribute('aria-expanded', 'false');
  };

  const openProfileMenu = () => {
    profilePicker?.classList.add('open');
    profileTrigger?.setAttribute('aria-expanded', 'true');
    const selectedOption = profileOptions.find((option) => option.classList.contains('selected'));
    selectedOption?.focus();
  };

  const toggleProfileMenu = () => {
    if (profilePicker?.classList.contains('open')) closeProfileMenu();
    else openProfileMenu();
  };

  const maskSecret = (value) => {
    const text = String(value || '');
    if (!text) return 'Not saved';
    return `Saved ...${text.slice(-4)}`;
  };
  const formatLastRun = (value) => {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };
  const formatDuration = (seconds) => {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${Math.round(value)}s`;
    const minutes = Math.floor(value / 60);
    const remainder = Math.round(value % 60);
    return `${minutes}m ${remainder}s`;
  };
  const clearElement = (element) => {
    element?.replaceChildren();
  };
  const appendDefinition = (list, key, value) => {
    const term = document.createElement('dt');
    term.textContent = key;
    const description = document.createElement('dd');
    description.textContent = value;
    list.append(term, description);
  };
  const renderDefinitionList = (list, items) => {
    if (!list) return;
    clearElement(list);
    items.forEach(([key, value]) => appendDefinition(list, key, value));
  };
  const appendTableCell = (row, value) => {
    const cell = document.createElement('td');
    cell.textContent = value || '-';
    row.appendChild(cell);
    return cell;
  };
  const getDisplayAssetName = (item = {}, fallbackType = 'Asset') => {
    const id = String(item.assetId || item.originalAssetId || item.id || '').trim();
    const rawName = String(item.name || '').trim();
    if (!rawName || rawName === id || /^\d+$/.test(rawName))
      return id ? `${fallbackType} ${id}` : fallbackType;
    if (new RegExp(`^${fallbackType}\\s+${id}$`, 'i').test(rawName)) return rawName;
    return rawName;
  };
  const appendAssetCell = (row, item = {}, fallbackType = 'Asset') => {
    const cell = document.createElement('td');
    const name = document.createElement('strong');
    const id = String(item.assetId || item.originalAssetId || item.id || '').trim();
    name.textContent = getDisplayAssetName(item, fallbackType);
    cell.className = 'ui-asset-cell';
    cell.appendChild(name);
    if (id) {
      const meta = document.createElement('small');
      meta.textContent = id;
      cell.appendChild(meta);
    }
    row.appendChild(cell);
    return cell;
  };
  const toCssToken = (value) =>
    String(value || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown';
  const createStatusPill = (baseClassName, status, label = status) => {
    const pill = document.createElement('span');
    pill.className = `${baseClassName} ${toCssToken(status)}`;
    pill.textContent = label || 'Unknown';
    return pill;
  };
  const createProgressBar = (value) => {
    const progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const wrap = document.createElement('span');
    wrap.className = 'queue-progress ui-progress';
    const fill = document.createElement('i');
    fill.style.width = `${progress}%`;
    const label = document.createElement('b');
    label.textContent = `${progress}%`;
    wrap.append(fill, label);
    return wrap;
  };
  const inferAssetType = (summary, item = {}) => {
    const text =
      `${summary?.mode || ''} ${item.assetType || ''} ${item.type || ''} ${item.name || ''}`.toLowerCase();
    if (text.includes('sound') || text.includes('audio')) return 'Sound';
    return 'Animation';
  };
  const parseMappingLine = (line) => {
    const match = String(line || '').match(/(\d+)\s*(?:=|:|->|=>)\s*(\d+)/);
    if (!match) return null;
    return { oldId: match[1], newId: match[2], mapping: `${match[1]} = ${match[2]}` };
  };
  const normalizeReportRows = (result, summary) => {
    const rows = [];
    const failures = Array.isArray(summary.failures) ? summary.failures : [];
    failures.forEach((failure, index) => {
      rows.push({
        id: `failure-${failure.id || index}-${failure.stage || 'unknown'}`,
        assetId: String(failure.id || ''),
        name: failure.name || '',
        type: inferAssetType(summary, failure),
        creator: String(failure.creator || ''),
        result: 'Failed',
        reason: failure.reason || failure.label || failure.category || 'Failed',
        newId: '',
        action: failure.retryable ? 'Retry eligible' : 'Review',
        stage: failure.stage || '',
        raw: failure.raw || failure.reason || '',
        suggestedFix:
          failure.suggestedFix ||
          'Check the failed item and export a support report if it repeats.',
        retryable: failure.retryable === true,
        mapping: '',
      });
    });

    const successfulMappings = Array.isArray(summary.successfulMappings)
      ? summary.successfulMappings
      : [];
    if (successfulMappings.length) {
      successfulMappings.forEach((item, index) => {
        if (!item?.originalId || !item?.newId) return;
        rows.push({
          id: `mapping-${item.originalId}-${item.newId}-${index}`,
          assetId: String(item.originalId),
          name: item.name || '',
          type: inferAssetType(summary, item),
          creator: item.creator || '',
          result: 'Successful',
          reason: 'Uploaded',
          newId: String(item.newId),
          action: 'Copy mapping',
          stage: 'upload',
          raw: '',
          suggestedFix: '',
          retryable: false,
          mapping: `${item.originalId} = ${item.newId}`,
        });
      });
    } else {
      (Array.isArray(summary.mappings) ? summary.mappings : []).forEach((line, index) => {
        const parsed = parseMappingLine(line);
        if (!parsed) return;
        rows.push({
          id: `mapping-${parsed.oldId}-${parsed.newId}-${index}`,
          assetId: parsed.oldId,
          name: '',
          type: inferAssetType(summary),
          creator: '',
          result: 'Successful',
          reason: 'Uploaded',
          newId: parsed.newId,
          action: 'Copy mapping',
          stage: 'upload',
          raw: '',
          suggestedFix: '',
          retryable: false,
          mapping: parsed.mapping,
        });
      });
    }

    (Array.isArray(summary.cachedMappings) ? summary.cachedMappings : []).forEach((item, index) => {
      rows.push({
        id: `cached-${item.originalId || index}`,
        assetId: String(item.originalId || ''),
        name: item.name || '',
        type: inferAssetType(summary, item),
        creator: '',
        result: 'Skipped',
        reason: 'Cached mapping reused',
        newId: String(item.newId || ''),
        action: 'Copy mapping',
        stage: 'cache',
        raw: '',
        suggestedFix: '',
        retryable: false,
        mapping: item.originalId && item.newId ? `${item.originalId} = ${item.newId}` : '',
      });
    });

    if (!rows.length && result?.output) {
      rows.push({
        id: 'output-summary',
        assetId: '',
        type: inferAssetType(summary),
        creator: '',
        result: result.success ? 'Successful' : 'Failed',
        reason: String(result.output).split('\n')[0].slice(0, 160),
        newId: '',
        action: result.success ? 'Review' : 'Review',
        stage: 'summary',
        raw: String(result.output),
        suggestedFix: result.success
          ? ''
          : 'Review the output and export a support report if it repeats.',
        retryable: false,
        mapping: '',
      });
    }
    return rows;
  };
  const createRunReport = (result) => {
    const summary = result?.summary || {};
    const rows = normalizeReportRows(result, summary);
    const failed = rows.filter((row) => row.result === 'Failed').length;
    const successful = rows.filter((row) => row.result === 'Successful').length;
    const skipped =
      Number(summary.skippedUploads || 0) + rows.filter((row) => row.result === 'Skipped').length;
    return {
      id: `report-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      status: failed
        ? successful
          ? 'Completed with failures'
          : 'Failed'
        : rows.length
          ? 'Completed'
          : 'No items',
      mode: summary.mode || 'Run',
      summary: {
        ...summary,
        total: Number(summary.total || rows.length || 0),
        successful,
        failed,
        skipped,
      },
      failedRetryInput: result?.failedAnimationIdInput || '',
      output: result?.output || '',
      rows,
    };
  };
  const getActiveReport = () => {
    const profile = getActiveProfile();
    return Array.isArray(profile.runReports) && profile.runReports.length
      ? profile.runReports[0]
      : null;
  };
  const saveRunReportForActiveProfile = (report) => {
    const active = getActiveProfile();
    writeActiveProfilePatch({
      runReports: [report, ...(active.runReports || [])].slice(0, 20),
      lastRunAt: report.createdAt,
    });
  };
  const writeActiveProfilePatch = (patch) => {
    const state = getProfileState();
    state.profiles = state.profiles.map((profile) =>
      profile.id === state.activeProfileId ? normalizeProfile({ ...profile, ...patch }) : profile,
    );
    const saved = saveProfileState(state);
    renderSettingsControls(saved);
    renderProfiles();
  };
  const writeActiveProfileSettingFromSettingsPage = (key, value) => {
    if (!profileSyncedSettings.has(key)) return;
    const state = getProfileState();
    state.profiles = state.profiles.map((profile) =>
      profile.id === state.activeProfileId
        ? normalizeProfile({ ...profile, [key]: value })
        : profile,
    );
    saveProfileState(state);
    renderProfiles();
  };
  const renderSettingsControls = (settings = loadSavedSettings()) => {
    if (settings.accentColour) applyAccent(settings.accentColour, { save: false });
    document.querySelectorAll('input[data-setting][inputmode="numeric"]').forEach((input) => {
      if (settings[input.dataset.setting] !== undefined)
        input.value = settings[input.dataset.setting];
    });
    document.querySelectorAll('input[type="checkbox"][data-setting]').forEach((input) => {
      if (settings[input.dataset.setting] !== undefined)
        input.checked = settings[input.dataset.setting] === true;
    });
  };
  const uniqueProfileName = (profiles) => {
    const used = new Set(profiles.map((profile) => profile.name.toLowerCase()));
    let index = profiles.length + 1;
    let name = `Profile ${index}`;
    while (used.has(name.toLowerCase())) {
      index += 1;
      name = `Profile ${index}`;
    }
    return name;
  };
  const setActiveProfileId = (profileId) => {
    const state = getProfileState();
    if (!state.profiles.some((profile) => profile.id === profileId)) return;
    state.activeProfileId = profileId;
    const saved = saveProfileState(state);
    renderSettingsControls(saved);
    renderProfiles();
  };
  const renderProfilePicker = (state) => {
    const active =
      state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
    if (profileTriggerLabel) profileTriggerLabel.textContent = active?.name || 'Profile';
    if (!profileMenu) return;
    clearElement(profileMenu);
    state.profiles.forEach((profile) => {
      const option = document.createElement('button');
      option.className = `profile-option ui-button${profile.id === active.id ? ' selected' : ''}`;
      option.type = 'button';
      option.role = 'option';
      option.dataset.profileId = profile.id;
      option.dataset.profile = profile.name;
      option.setAttribute('aria-selected', String(profile.id === active.id));
      option.title = `Switch to ${profile.name}`;
      const label = document.createElement('span');
      label.textContent = profile.name;
      option.appendChild(label);
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        selectProfile(profile.id);
      });
      profileMenu.appendChild(option);
    });
    profileOptions = Array.from(document.querySelectorAll('.profile-option'));
  };
  const renderProfilesList = (state) => {
    if (!profilesList) return;
    clearElement(profilesList);
    state.profiles.forEach((profile) => {
      const button = document.createElement('button');
      button.className = `profile-list-item ui-button${profile.id === state.activeProfileId ? ' active' : ''}`;
      button.type = 'button';
      button.role = 'option';
      button.dataset.profileId = profile.id;
      button.setAttribute('aria-selected', String(profile.id === state.activeProfileId));
      button.title = `Edit ${profile.name}`;
      const copy = document.createElement('span');
      copy.className = 'profile-list-copy';
      const title = document.createElement('strong');
      title.textContent = profile.name;
      const meta = document.createElement('small');
      meta.textContent = profile.groupId ? `Group ${profile.groupId}` : 'User target';
      copy.append(title, meta);
      button.appendChild(copy);
      button.addEventListener('click', () => setActiveProfileId(profile.id));
      profilesList.appendChild(button);
    });
  };
  const renderProfileEditor = (state) => {
    const active =
      state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
    if (!active) return;
    if (profileGroupId && profileGroupId.value !== active.groupId)
      profileGroupId.value = active.groupId;
    if (profileAutoCookie) profileAutoCookie.checked = active.autoDetectCookie;
    if (profileApiKeyInput && profileApiKeyInput.value !== active.apiKey)
      profileApiKeyInput.value = active.apiKey;
    if (profileApiStatus) profileApiStatus.textContent = maskSecret(active.apiKey);
    updateIdentityPreview(active);
  };
  const renderProfiles = () => {
    const state = getProfileState();
    renderProfilePicker(state);
    renderProfilesList(state);
    renderProfileEditor(state);
    renderRunReport();
    renderQueue();
    renderSpooferPreflight();
  };
  const selectProfile = (profileName) => {
    if (!profileName) return;
    const state = getProfileState();
    const target = state.profiles.find(
      (profile) => profile.id === profileName || profile.name === profileName,
    );
    if (target) setActiveProfileId(target.id);
    closeProfileMenu();
    profileTrigger?.focus();
  };

  const confirmAction = ({
    title = 'Confirm action',
    message = 'This action cannot be undone.',
    accept = 'Confirm',
  }) =>
    new Promise((resolve) => {
      if (!confirmGate || !confirmAccept || !confirmCancel) {
        resolve(window.confirm(message));
        return;
      }
      confirmTitle.textContent = title;
      confirmMessage.textContent = message;
      confirmAccept.textContent = accept;
      confirmGate.setAttribute('aria-hidden', 'false');
      confirmGate.classList.add('show');
      const cleanup = (value) => {
        confirmGate.classList.remove('show');
        confirmGate.setAttribute('aria-hidden', 'true');
        confirmAccept.removeEventListener('click', onAccept);
        confirmCancel.removeEventListener('click', onCancel);
        resolve(value);
      };
      const onAccept = () => cleanup(true);
      const onCancel = () => cleanup(false);
      confirmAccept.addEventListener('click', onAccept);
      confirmCancel.addEventListener('click', onCancel);
      confirmCancel.focus();
    });
  const openRenameDialog = () => {
    const active = getActiveProfile();
    if (!active || !renameGate || !renameProfileInput) return;
    renameProfileInput.value = active.name;
    renameGate.setAttribute('aria-hidden', 'false');
    renameGate.classList.add('show');
    setTimeout(() => {
      renameProfileInput.focus();
      renameProfileInput.select();
    }, 60);
  };
  const closeRenameDialog = () => {
    renameGate?.classList.remove('show');
    renameGate?.setAttribute('aria-hidden', 'true');
  };
  const saveRenameDialog = () => {
    const name = sanitizeProfileName(renameProfileInput?.value, getActiveProfile().name);
    writeActiveProfilePatch({ name });
    closeRenameDialog();
  };
  const rowMatchesFilter = (row) => {
    if (reportFilter === 'all') return true;
    if (reportFilter === 'failed') return row.result === 'Failed';
    if (reportFilter === 'successful') return row.result === 'Successful';
    if (reportFilter === 'skipped') return row.result === 'Skipped';
    if (reportFilter === 'animation') return String(row.type).toLowerCase() === 'animation';
    if (reportFilter === 'sound') return String(row.type).toLowerCase() === 'sound';
    return true;
  };
  const getVisibleReportRows = (report = getActiveReport()) => {
    if (!report) return [];
    const query = String(runReportSearch?.value || '')
      .trim()
      .toLowerCase();
    return (report.rows || []).filter((row) => {
      if (!rowMatchesFilter(row)) return false;
      if (!query) return true;
      return [
        row.assetId,
        row.type,
        row.creator,
        row.result,
        row.reason,
        row.newId,
        row.raw,
        row.suggestedFix,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  };
  const selectReportRow = (rowId) => {
    selectedReportRowId = rowId || '';
    renderRunReport();
  };
  const renderReportDetail = (row) => {
    if (!runDetailList || !runDetailRaw || !runDetailFix || !runDetailMapping) return;
    if (!row) {
      renderDefinitionList(runDetailList, [['Status', 'No item selected']]);
      runDetailRaw.textContent = 'Select a run item.';
      runDetailFix.textContent = 'Select a run item.';
      runDetailMapping.textContent = 'None';
      return;
    }
    const items = [
      ['Asset ID', row.assetId || 'None'],
      ['Type', row.type || 'Unknown'],
      ['Creator', row.creator || 'Unknown'],
      ['Result', row.result || 'Unknown'],
      ['Stage', row.stage || 'Unknown'],
      ['Retry', row.retryable ? 'Eligible' : 'Not eligible'],
    ];
    renderDefinitionList(runDetailList, items);
    runDetailRaw.textContent = row.raw || row.reason || 'None';
    runDetailFix.textContent =
      row.suggestedFix ||
      (row.result === 'Failed' ? 'Review this item and retry if eligible.' : 'No fix needed.');
    runDetailMapping.textContent = row.mapping || 'None';
  };
  const setReportActionsEnabled = (enabled, report) => {
    const rows = Array.isArray(report?.rows) ? report.rows : [];
    const failedIds = rows.some((row) => row.result === 'Failed' && row.assetId);
    const mappings = rows.some((row) => row.mapping);
    if (runReportSearch) runReportSearch.disabled = !enabled;
    if (runCopyFailed) runCopyFailed.disabled = !enabled || !failedIds;
    if (runCopyMappings) runCopyMappings.disabled = !enabled || !mappings;
    if (runExportReport) runExportReport.disabled = !enabled;
    if (runRetryFailed) runRetryFailed.disabled = !enabled || !report?.failedRetryInput;
    if (runClearReport) runClearReport.disabled = !enabled;
    if (runOpenLogs) runOpenLogs.disabled = false;
  };
  const renderRunReport = () => {
    const report = getActiveReport();
    const hasReport = Boolean(report);
    if (runReportStatus) runReportStatus.textContent = report?.status || 'No run report yet';
    if (runReportMode) runReportMode.textContent = report?.mode || 'Waiting for a completed run';
    if (runMetricTotal) runMetricTotal.textContent = String(report?.summary?.total || 0);
    if (runMetricSuccess)
      runMetricSuccess.textContent = String(
        report?.summary?.successful || report?.summary?.uploaded || 0,
      );
    if (runMetricFailed)
      runMetricFailed.textContent = String(
        report?.summary?.failed ||
          (report?.summary?.downloadFailures || 0) + (report?.summary?.uploadFailures || 0),
      );
    if (runMetricSkipped)
      runMetricSkipped.textContent = String(
        report?.summary?.skipped || report?.summary?.skippedUploads || 0,
      );
    if (runMetricDuration)
      runMetricDuration.textContent = formatDuration(report?.summary?.durationSeconds || 0);
    if (runMetricFinished)
      runMetricFinished.textContent = report?.summary?.finishedAt
        ? formatLastRun(report.summary.finishedAt)
        : 'Never';
    setReportActionsEnabled(hasReport, report);

    const rows = getVisibleReportRows(report);
    if (runReportRows) {
      clearElement(runReportRows);
      const fragment = document.createDocumentFragment();
      rows.forEach((item) => {
        const row = document.createElement('tr');
        row.className = `ui-table-row${item.id === selectedReportRowId ? ' selected' : ''}`;
        row.dataset.reportRow = item.id;
        appendAssetCell(row, item, item.type || 'Asset');
        appendTableCell(row, item.type || '-');
        appendTableCell(row, item.creator || '-');
        const resultCell = document.createElement('td');
        resultCell.appendChild(
          createStatusPill('run-result ui-pill ui-status-pill', item.result, item.result),
        );
        row.appendChild(resultCell);
        appendTableCell(row, item.reason || '-');
        appendTableCell(row, item.newId || '-');
        appendTableCell(row, item.action || '-');
        fragment.appendChild(row);
      });
      runReportRows.appendChild(fragment);
    }
    if (runReportEmpty) {
      runReportEmpty.hidden = hasReport && rows.length > 0;
      runReportEmpty.textContent = hasReport
        ? 'No rows match the current filter.'
        : 'No run report yet.';
    }
    const selected =
      (report?.rows || []).find((row) => row.id === selectedReportRowId) || rows[0] || null;
    if (selected && selected.id !== selectedReportRowId) selectedReportRowId = selected.id;
    renderReportDetail(selected);
  };
  const writeClipboardText = async (text) => {
    const value = String(text || '');
    if (!value) return false;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    return false;
  };
  const exportReportJson = (report) => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ISpooferMotion-Run-Report-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const buildDiagnosticContext = () => {
    const report = getActiveReport();
    const queueState = getQueueStateForProfile();
    const active = getActiveProfile();
    return {
      mode: report?.summary?.mode || 'renderer',
      assetType:
        report?.rows?.[0]?.type ||
        (parseSpooferInput().assetType === 'sound' ? 'sound' : 'animation'),
      assetCount: report?.summary?.total || parseSpooferInput().readyCount || 0,
      lastStatus: latestStatusMessage || queueState.status || '',
      summary: report?.summary || {},
      report: report || {},
      failedRetryInputPreview: report?.failedRetryInput || spooferLastRetryInput || '',
      settings: {
        ...loadSavedSettings(),
        activeProfile: {
          id: active.id,
          name: active.name,
          groupId: active.groupId,
          autoDetectCookie: active.autoDetectCookie,
          hasApiKey: Boolean(active.apiKey),
          hasCookie: Boolean(active.robloxCookie),
          downloadWorkers: active.downloadWorkers,
          queueBatchSize: active.queueBatchSize,
          downloadsFolder: active.downloadsFolder,
          reportsFolder: active.reportsFolder,
        },
      },
      queue: {
        status: queueState.status,
        updatedAt: queueState.updatedAt,
        summary: summarizeQueue(queueState.items),
        items: queueState.items.slice(0, 80),
      },
    };
  };
  const getActiveProfileId = () => getProfileState().activeProfileId;
  const normalizeQueueStatus = (status) => String(status || 'queued').toLowerCase();
  const isQueueActiveStatus = (status) =>
    ['processing', 'downloading', 'uploading', 'cooldown'].includes(normalizeQueueStatus(status));
  const isQueueQueuedStatus = (status) => normalizeQueueStatus(status) === 'queued';
  const isQueueCompletedStatus = (status) =>
    ['completed', 'complete', 'success', 'done'].includes(normalizeQueueStatus(status));
  const isQueueFailedStatus = (status) =>
    ['error', 'failed', 'failure', 'canceled', 'cancelled'].includes(normalizeQueueStatus(status));
  const queueStatusLabel = (status) => {
    const normalized = normalizeQueueStatus(status);
    if (normalized === 'cooldown') return 'Cooldown';
    if (normalized === 'processing') return 'Processing';
    if (normalized === 'queued') return 'Queued';
    if (isQueueCompletedStatus(normalized)) return 'Completed';
    if (isQueueFailedStatus(normalized))
      return normalized.startsWith('cancel') ? 'Canceled' : 'Failed';
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Queued';
  };
  const formatBytes = (value) => {
    const bytes = Number(value) || 0;
    if (bytes <= 0) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
  };
  const normalizeQueueItem = (payload = {}, existing = {}) => {
    const id = String(
      payload.id ||
        existing.id ||
        `${payload.direction || existing.direction || 'item'}-${payload.originalAssetId || existing.originalAssetId || Date.now()}`,
    );
    const progress = Math.max(
      0,
      Math.min(100, Number(payload.progress ?? existing.progress ?? 0) || 0),
    );
    const status = normalizeQueueStatus(payload.status || existing.status || 'queued');
    return {
      ...existing,
      id,
      name: String(payload.name ?? existing.name ?? 'Untitled asset'),
      originalAssetId: String(payload.originalAssetId ?? existing.originalAssetId ?? ''),
      direction: String(payload.direction ?? existing.direction ?? 'transfer').toLowerCase(),
      status,
      progress,
      size: Number(payload.size ?? existing.size ?? 0) || 0,
      message: String(payload.message ?? existing.message ?? ''),
      error: String(payload.error ?? existing.error ?? ''),
      errorCategory: String(payload.errorCategory ?? existing.errorCategory ?? ''),
      cooldownRemaining: payload.cooldownRemaining ?? existing.cooldownRemaining ?? null,
      updatedAt: new Date().toISOString(),
    };
  };
  const getQueueStateForProfile = (profile = getActiveProfile()) => {
    const profileId = profile?.id || getActiveProfileId();
    if (!queueStateCache.has(profileId)) {
      queueStateCache.set(profileId, {
        items: Array.isArray(profile?.queueItems)
          ? profile.queueItems.map((item) => normalizeQueueItem(item))
          : [],
        status: profile?.queueStatus || '',
        updatedAt: profile?.queueUpdatedAt || '',
      });
    }
    return queueStateCache.get(profileId);
  };
  const persistQueueStateForProfile = (profileId) => {
    clearTimeout(queuePersistTimers.get(profileId));
    queuePersistTimers.set(
      profileId,
      setTimeout(() => {
        const queueState = queueStateCache.get(profileId);
        if (!queueState) return;
        const state = getProfileState();
        state.profiles = state.profiles.map((profile) =>
          profile.id === profileId
            ? normalizeProfile({
                ...profile,
                queueItems: queueState.items.slice(0, 400),
                queueStatus: queueState.status,
                queueUpdatedAt: queueState.updatedAt,
              })
            : profile,
        );
        saveProfileState(state);
      }, 250),
    );
  };
  const queueMatchesFilter = (item) => {
    if (queueFilter === 'all') return true;
    if (queueFilter === 'active')
      return isQueueActiveStatus(item.status) || item.status === 'cooldown';
    if (queueFilter === 'queued') return isQueueQueuedStatus(item.status);
    if (queueFilter === 'completed') return isQueueCompletedStatus(item.status);
    if (queueFilter === 'failed') return isQueueFailedStatus(item.status);
    if (queueFilter === 'download') return item.direction === 'download';
    if (queueFilter === 'upload') return item.direction === 'upload';
    return true;
  };
  const getVisibleQueueItems = () => {
    const queueState = getQueueStateForProfile();
    const query = String(queueSearch?.value || '')
      .trim()
      .toLowerCase();
    return queueState.items.filter((item) => {
      if (!queueMatchesFilter(item)) return false;
      if (!query) return true;
      return [
        item.originalAssetId,
        item.name,
        item.direction,
        item.status,
        item.message,
        item.error,
        item.errorCategory,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  };
  const summarizeQueue = (items) => {
    const total = items.length;
    const completed = items.filter((item) => isQueueCompletedStatus(item.status)).length;
    const failed = items.filter((item) => isQueueFailedStatus(item.status)).length;
    const queued = items.filter((item) => isQueueQueuedStatus(item.status)).length;
    const active = items.filter((item) => isQueueActiveStatus(item.status)).length;
    const progress = total
      ? Math.round(
          items.reduce(
            (sum, item) =>
              sum + (Number(item.progress) || (isQueueCompletedStatus(item.status) ? 100 : 0)),
            0,
          ) / total,
        )
      : 0;
    return { total, completed, failed, queued, active, progress };
  };
  const renderQueueDetail = (item) => {
    if (!queueDetailList || !queueDetailError || !queueDetailMessage) return;
    if (!item) {
      renderDefinitionList(queueDetailList, [['Status', 'No item selected']]);
      queueDetailError.textContent = 'Select a queue item.';
      queueDetailMessage.textContent = 'Select a queue item.';
      return;
    }
    const items = [
      ['Asset ID', item.originalAssetId || 'None'],
      ['Name', item.name || 'Untitled asset'],
      ['Direction', item.direction || 'Transfer'],
      ['Status', queueStatusLabel(item.status)],
      ['Progress', `${Math.round(Number(item.progress) || 0)}%`],
      ['Size', formatBytes(item.size)],
      ['Updated', formatLastRun(item.updatedAt)],
    ];
    renderDefinitionList(queueDetailList, items);
    queueDetailError.textContent = item.error || item.errorCategory || 'None';
    queueDetailMessage.textContent =
      item.message ||
      (item.cooldownRemaining ? `Retrying in ${item.cooldownRemaining}s` : 'No message.');
  };
  const renderQueue = () => {
    const queueState = getQueueStateForProfile();
    const summary = summarizeQueue(queueState.items);
    const hasItems = summary.total > 0;
    const hasOpenItems = summary.active > 0 || summary.queued > 0;
    const hasDoneItems = summary.completed > 0 || summary.failed > 0;
    if (queueStatus)
      queueStatus.textContent = queueState.status || (hasItems ? 'Queue ready' : 'No active queue');
    if (queueMode)
      queueMode.textContent = hasItems
        ? `${summary.progress}% overall progress`
        : 'Waiting for a run';
    if (queueMetricTotal) queueMetricTotal.textContent = String(summary.total);
    if (queueMetricActive) queueMetricActive.textContent = String(summary.active);
    if (queueMetricQueued) queueMetricQueued.textContent = String(summary.queued);
    if (queueMetricCompleted) queueMetricCompleted.textContent = String(summary.completed);
    if (queueMetricFailed) queueMetricFailed.textContent = String(summary.failed);
    if (queueMetricProgress) queueMetricProgress.textContent = `${summary.progress}%`;

    if (hasOpenItems && summary.completed > 0 && runStartTime) {
      const elapsed = Date.now() - runStartTime;
      const msPerItem = elapsed / summary.completed;
      const remainingMs = msPerItem * (summary.total - summary.completed);
      const mins = Math.floor(remainingMs / 60000);
      const secs = Math.floor((remainingMs % 60000) / 1000);
      const etaStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      if (queueMode)
        queueMode.textContent = `${summary.progress}% overall progress (ETA: ${etaStr})`;
    } else {
      if (queueMode)
        queueMode.textContent = hasItems
          ? `${summary.progress}% overall progress`
          : 'Waiting for a run';
    }

    if (queuePause) queuePause.disabled = !hasOpenItems || spooferRunStatus === 'paused';
    if (queueResume) queueResume.disabled = !hasOpenItems || spooferRunStatus !== 'paused';
    if (queueCancel) queueCancel.disabled = !hasOpenItems;
    if (queueClearDone) queueClearDone.disabled = !hasDoneItems;
    if (queueClearAll) queueClearAll.disabled = !hasItems;

    const visibleItems = getVisibleQueueItems();
    if (queueRows) {
      clearElement(queueRows);
      const fragment = document.createDocumentFragment();
      visibleItems.forEach((item) => {
        const row = document.createElement('tr');
        row.className = `ui-table-row${item.id === selectedQueueItemId ? ' selected' : ''}`;
        row.dataset.queueRow = item.id;
        appendAssetCell(row, item, item.direction === 'upload' ? 'Upload' : 'Asset');
        appendTableCell(row, item.direction || '-');
        const statusCell = document.createElement('td');
        statusCell.appendChild(
          createStatusPill(
            'queue-pill ui-pill ui-status-pill',
            normalizeQueueStatus(item.status),
            queueStatusLabel(item.status),
          ),
        );
        row.appendChild(statusCell);
        const progressCell = document.createElement('td');
        progressCell.appendChild(createProgressBar(item.progress));
        row.appendChild(progressCell);
        appendTableCell(row, item.message || item.error || '-');
        fragment.appendChild(row);
      });
      queueRows.appendChild(fragment);
    }
    if (queueEmpty) {
      queueEmpty.hidden = hasItems && visibleItems.length > 0;
      queueEmpty.textContent = hasItems
        ? 'No queue items match the current filter.'
        : 'No queue yet.';
    }
    const selected =
      queueState.items.find((item) => item.id === selectedQueueItemId) || visibleItems[0] || null;
    if (selected && selected.id !== selectedQueueItemId) selectedQueueItemId = selected.id;
    renderQueueDetail(selected);
  };
  const updateQueueStatus = (message) => {
    const queueState = getQueueStateForProfile();
    latestStatusMessage = String(message || '').trim() || latestStatusMessage;
    queueState.status = latestStatusMessage || queueState.status;
    queueState.updatedAt = new Date().toISOString();
    if (spooferLiveStage && message) spooferLiveStage.textContent = String(message).slice(0, 80);
    persistQueueStateForProfile(getActiveProfileId());
    renderQueue();
  };
  const applyTransferUpdate = (payload) => {
    if (!payload || !payload.id) return;
    const profileId = getActiveProfileId();
    const queueState = getQueueStateForProfile();
    const existingIndex = queueState.items.findIndex((item) => item.id === String(payload.id));
    const existing = existingIndex >= 0 ? queueState.items[existingIndex] : null;
    const hasOpenItems = queueState.items.some(
      (item) => isQueueActiveStatus(item.status) || isQueueQueuedStatus(item.status),
    );
    if (
      !existing &&
      normalizeQueueStatus(payload.status) === 'queued' &&
      queueState.items.length &&
      !hasOpenItems
    ) {
      queueState.items = [];
      selectedQueueItemId = '';
    }
    const item = normalizeQueueItem(payload, existing || {});
    const nextExistingIndex = queueState.items.findIndex((entry) => entry.id === item.id);
    if (nextExistingIndex >= 0) queueState.items[nextExistingIndex] = item;
    else queueState.items.push(item);
    queueState.items.sort((a, b) => {
      const aTime = new Date(a.updatedAt || 0).getTime();
      const bTime = new Date(b.updatedAt || 0).getTime();
      if (isQueueQueuedStatus(a.status) !== isQueueQueuedStatus(b.status))
        return isQueueQueuedStatus(a.status) ? -1 : 1;
      if (isQueueActiveStatus(a.status) !== isQueueActiveStatus(b.status))
        return isQueueActiveStatus(a.status) ? -1 : 1;
      return bTime - aTime;
    });
    queueState.status = 'Running';
    queueState.updatedAt = item.updatedAt;
    if (isQueueActiveStatus(item.status) || isQueueQueuedStatus(item.status))
      spooferRunStatus = 'running';
    persistQueueStateForProfile(profileId);
    renderQueue();
    updateSpooferFromQueue();
  };
  const clearCompletedQueueItems = () => {
    const profileId = getActiveProfileId();
    const queueState = getQueueStateForProfile();
    queueState.items = queueState.items.filter(
      (item) => !isQueueCompletedStatus(item.status) && !isQueueFailedStatus(item.status),
    );
    selectedQueueItemId = '';
    queueState.updatedAt = new Date().toISOString();
    persistQueueStateForProfile(profileId);
    renderQueue();
  };
  const clearQueueItems = () => {
    const profileId = getActiveProfileId();
    const queueState = getQueueStateForProfile();
    queueState.items = [];
    queueState.status = '';
    queueState.updatedAt = new Date().toISOString();
    selectedQueueItemId = '';
    persistQueueStateForProfile(profileId);
    renderQueue();
    updateSpooferFromQueue();
  };
  const clearRunReportsForActiveProfile = () => {
    selectedReportRowId = '';
    writeActiveProfilePatch({ runReports: [] });
    renderRunReport();
  };
  const parseSpooferInput = () => {
    const text = String(spooferInput?.value || '');
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const ids = [];
    const seen = new Set();
    let duplicateCount = 0;
    let invalidCount = 0;
    let assetType = soundModeManualOverride !== null ? soundModeManualOverride : 'animation';
    let explicitType = soundModeManualOverride !== null;
    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      const typeMatch = line.match(
        /^(?:#\s*)?(?:type|asset\s*type|mode)?\s*:?\s*(sound|sounds|audio|animation|animations)\s*$/i,
      );
      if (typeMatch) {
        if (soundModeManualOverride === null) {
          assetType = /sound|audio/i.test(typeMatch[1]) ? 'sound' : 'animation';
          explicitType = true;
        }
        return;
      }
      if (soundModeManualOverride === null && !explicitType) {
        if (/\/audio\//i.test(line) || /\bSoundId\b/i.test(line) || /\baudio\b/i.test(line)) {
          assetType = 'sound';
        }
      }
      const idMatch = line.match(
        /(?:rbxassetid:\/\/|[?&]id=|\/(?:library|catalog|audio|marketplace\/asset)\/|^|\D)(\d{3,})/i,
      );
      const id = idMatch && idMatch[1];
      if (!id) {
        invalidCount += 1;
        return;
      }
      if (seen.has(id)) {
        duplicateCount += 1;
        return;
      }
      seen.add(id);
      ids.push(id);
    });
    return {
      ids,
      duplicateCount,
      invalidCount,
      readyCount: ids.length,
      normalizedInput: ids.join('\n'),
      assetType,
      explicitType,
    };
  };
  const setSpooferProgress = (progress) => {
    const value = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    if (spooferLiveProgress) spooferLiveProgress.style.width = `${value}%`;
    if (spooferLiveProgressLabel) spooferLiveProgressLabel.textContent = `${value}%`;
  };
  const setSpooferLiveVisible = (visible) => {
    if (!spooferLivePopup) return;
    spooferLivePopup.classList.toggle('is-visible', Boolean(visible));
    spooferLivePopup.setAttribute('aria-hidden', visible ? 'false' : 'true');
  };
  const renderSpooferButtons = (parsed = parseSpooferInput()) => {
    const active =
      spooferRunStatus === 'running' ||
      spooferRunStatus === 'paused' ||
      spooferRunStatus === 'canceling';
    if (spooferStart) spooferStart.disabled = active || !parsed.readyCount;
    if (spooferPause) spooferPause.disabled = spooferRunStatus !== 'running';
    if (spooferResume) spooferResume.disabled = spooferRunStatus !== 'paused';
    if (spooferCancel) spooferCancel.disabled = !active || spooferRunStatus === 'canceling';
    if (spooferCopyOutput) spooferCopyOutput.disabled = !String(spooferOutput?.value || '').trim();
    if (spooferCopyRetry) spooferCopyRetry.disabled = !String(spooferLastRetryInput || '').trim();
  };
  const startSpooferElapsedTimer = () => {
    clearInterval(spooferElapsedTimer);
    spooferRunStartedAt = Date.now();
    if (spooferLiveElapsed) spooferLiveElapsed.textContent = '0s';
    setSpooferLiveVisible(true);
    spooferElapsedTimer = setInterval(() => {
      if (spooferLiveElapsed)
        spooferLiveElapsed.textContent = formatDuration((Date.now() - spooferRunStartedAt) / 1000);
    }, 500);
  };
  const stopSpooferElapsedTimer = () => {
    clearInterval(spooferElapsedTimer);
    spooferElapsedTimer = null;
    setSpooferLiveVisible(false);
  };
  const finishSpooferRun = () => {
    spooferRunStatus = 'idle';
    renderSpooferButtons();
  };
  const renderSpooferPreflight = () => {
    const active = getActiveProfile();
    const parsed = parseSpooferInput();
    if (spooferInputLabel) spooferInputLabel.textContent = 'Asset IDs';
    if (spooferDetectedType)
      spooferDetectedType.textContent = parsed.assetType === 'sound' ? 'Sounds' : 'Animations';
    if (soundToggleAuto) {
      soundToggleAuto.style.display = soundModeManualOverride === null ? '' : 'none';
    }
    if (spooferSoundToggle && soundModeManualOverride === null)
      spooferSoundToggle.checked = parsed.assetType === 'sound';
    else if (spooferSoundToggle) spooferSoundToggle.checked = soundModeManualOverride === 'sound';

    if (spooferParsedCount)
      spooferParsedCount.textContent = String(parsed.ids.length + parsed.duplicateCount);
    if (spooferDuplicateCount) spooferDuplicateCount.textContent = String(parsed.duplicateCount);
    if (spooferInvalidCount) spooferInvalidCount.textContent = String(parsed.invalidCount);
    if (spooferReadyCount) spooferReadyCount.textContent = String(parsed.readyCount);
    if (spooferPreflightNote) {
      if (!parsed.readyCount) spooferPreflightNote.textContent = 'Paste asset IDs to begin.';
      else if (parsed.invalidCount || parsed.duplicateCount)
        spooferPreflightNote.textContent = `${parsed.readyCount} ready, ${parsed.duplicateCount} duplicate, ${parsed.invalidCount} invalid.`;
      else
        spooferPreflightNote.textContent = `${parsed.readyCount} ${parsed.assetType === 'sound' ? 'sound' : 'animation'} item(s) ready${parsed.explicitType ? ' from plugin type marker' : ''}.`;
    }
    if (spooferProfileName) spooferProfileName.textContent = active?.name || 'Profile';
    if (spooferTargetSummary)
      spooferTargetSummary.textContent = active?.groupId
        ? `Group ${active.groupId}`
        : 'User target';
    if (spooferApiSummary) spooferApiSummary.textContent = maskSecret(active?.apiKey);
    if (spooferCookieSummary)
      spooferCookieSummary.textContent = active?.autoDetectCookie
        ? 'Auto detect'
        : active?.robloxCookie
          ? 'Saved cookie'
          : 'No cookie';
    if (spooferCookieInput) {
      const manualCookieEnabled = active?.autoDetectCookie === false;
      spooferCookieInput.disabled = !manualCookieEnabled;
      spooferCookieInput.placeholder = manualCookieEnabled
        ? 'Paste .ROBLOSECURITY cookie'
        : 'Turn off auto detect in Profiles';
      if (spooferCookieInput.value !== (active?.robloxCookie || ''))
        spooferCookieInput.value = active?.robloxCookie || '';
    }
    if (spooferLimitsSummary)
      spooferLimitsSummary.textContent = `${active?.queueBatchSize || numericDefaults.queueBatchSize} batch / ${active?.downloadWorkers || numericDefaults.downloadWorkers} workers`;
    renderSpooferButtons(parsed);
    return parsed;
  };
  const buildSpooferPayload = () => {
    const active = getActiveProfile();
    const parsed = renderSpooferPreflight();
    return {
      animationId: parsed.normalizedInput,
      spoofSounds: parsed.assetType === 'sound',
      enableSpoofing: spooferEnableSpoofing?.checked !== false,
      downloadOnly: spooferDownloadOnly?.checked === true,
      downloadFolder: active.downloadsFolder || '',
      groupId: active.groupId || '',
      apiKey: active.apiKey || '',
      robloxCookie: active.autoDetectCookie
        ? ''
        : spooferCookieInput?.value.trim() || active.robloxCookie || '',
      autoDetectCookie: active.autoDetectCookie,
      downloadConcurrency: active.downloadWorkers || numericDefaults.downloadWorkers,
      batchChunkSize: active.queueBatchSize || numericDefaults.queueBatchSize,
      maxPlaceIds: spooferMaxPlaceIds?.value || '10',
      maxPlaceIdRetries: spooferPlaceRetries?.value || '3',
      uploadRetries: spooferUploadRetries?.value || '3',
      overridePlaceId: spooferOverridePlace?.value || '',
      autoSaveSession: true,
    };
  };
  const startSpooferRun = () => {
    const parsed = renderSpooferPreflight();
    if (!parsed.readyCount) {
      showNotice('Paste at least one asset ID before starting.', 'warning');
      spooferInput?.focus();
      return;
    }
    const payload = buildSpooferPayload();
    if (payload.downloadOnly && !payload.downloadFolder) {
      showNotice('Download-only mode needs a downloads folder in Settings or Profiles.', 'warning');
      return;
    }
    if (!payload.downloadOnly && !payload.apiKey) {
      showNotice('Uploads need an Open Cloud API key saved on the active profile.', 'warning');
      return;
    }
    if (spooferOutput) spooferOutput.value = '';
    if (spooferOutputState) spooferOutputState.textContent = 'Running';
    if (spooferLiveStage) spooferLiveStage.textContent = 'Starting';
    runStartTime = Date.now();

    spooferRunStatus = 'running';
    renderSpooferButtons(parsed);
    setSpooferProgress(0);
    startSpooferElapsedTimer();
    api.runSpooferAction?.(payload);
    setActiveView('queue');
  };
  const updateSpooferFromQueue = () => {
    const queueState = getQueueStateForProfile();
    const summary = summarizeQueue(queueState.items);
    if (summary.active || summary.queued) setSpooferLiveVisible(true);
    setSpooferProgress(summary.progress);
  };

  const positionTooltip = (anchor) => {
    if (!tooltip || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 10;
    const gap = 8;
    const tooltipRect = tooltip.getBoundingClientRect();

    let side = 'bottom';
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    let top = rect.bottom + gap;

    if (top + tooltipRect.height + margin > window.innerHeight) {
      side = 'top';
      top = rect.top - tooltipRect.height - gap;
    }

    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

    tooltip.dataset.side = side;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  };

  const showTooltip = (anchor) => {
    if (!tooltip || !anchor) return;
    const title = anchor.dataset.tipTitle || 'Help';
    const body = anchor.dataset.tipBody || '';
    const lines = body
      .split(/(?<=\.)\s+/)
      .map((line) => line.trim())
      .filter(Boolean);
    clearElement(tooltip);
    const titleNode = document.createElement('strong');
    titleNode.textContent = title;
    const lineWrap = document.createElement('div');
    lineWrap.className = 'tooltip-lines';
    tooltip.append(titleNode, lineWrap);
    lines.forEach((line) => {
      const row = document.createElement('span');
      row.textContent = line;
      lineWrap.appendChild(row);
    });
    tooltip.setAttribute('aria-hidden', 'false');
    tooltip.classList.add('show');
    activeTooltipAnchor = anchor;
    positionTooltip(anchor);
  };

  const hideTooltip = () => {
    tooltip?.classList.remove('show');
    tooltip?.setAttribute('aria-hidden', 'true');
    activeTooltipAnchor = null;
  };

  const pulseButton = (button, label = 'Done') => {
    if (!button) return;
    const originalHtml = button.dataset.originalHtml || button.innerHTML;
    button.dataset.originalHtml = originalHtml;
    button.classList.add('is-done');
    button.textContent = label;
    clearTimeout(button._resetTimer);
    button._resetTimer = setTimeout(() => {
      button.innerHTML = originalHtml;
      button.classList.remove('is-done');
    }, 1200);
  };

  const isHexColour = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  const hexToRgbParts = (hex) => {
    const clean = String(hex || defaultAccent).replace('#', '');
    return [0, 2, 4].map((start) => parseInt(clean.slice(start, start + 2), 16));
  };
  const setAccentPickerUi = (hex) => {
    const safeHex = isHexColour(hex) ? hex.toLowerCase() : defaultAccent;
    if (accentPicker) accentPicker.value = safeHex;
  };
  const setAccentCssVars = (hex) => {
    const safeHex = isHexColour(hex) ? hex.toLowerCase() : defaultAccent;
    const [r, g, b] = hexToRgbParts(safeHex);
    document.documentElement.style.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
    document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.10)`);
    document.documentElement.style.setProperty('--accent-line', `rgba(${r}, ${g}, ${b}, 0.26)`);
    document.documentElement.style.setProperty(
      '--state-selected-bg',
      `rgba(${r}, ${g}, ${b}, 0.08)`,
    );
    document.documentElement.style.setProperty(
      '--state-selected-line',
      `rgba(${r}, ${g}, ${b}, 0.24)`,
    );
    document.documentElement.style.setProperty(
      '--state-focus-ring',
      `rgba(${r}, ${g}, ${b}, 0.18)`,
    );
    document.documentElement.style.setProperty(
      '--state-success-bg',
      `rgba(${r}, ${g}, ${b}, 0.08)`,
    );
    document.documentElement.style.setProperty(
      '--state-success-line',
      `rgba(${r}, ${g}, ${b}, 0.22)`,
    );
    return safeHex;
  };
  let pendingAccentFrame = 0;
  const previewAccent = (hex) => {
    const safeHex = isHexColour(hex) ? hex.toLowerCase() : defaultAccent;
    cancelAnimationFrame(pendingAccentFrame);
    pendingAccentFrame = requestAnimationFrame(() => {
      setAccentCssVars(safeHex);
    });
  };
  const applyAccent = (hex, options = {}) => {
    const safeHex = setAccentCssVars(hex);
    setAccentPickerUi(safeHex);
    if (options.save !== false) saveSetting('accentColour', safeHex);
  };
  const updateIdentityPreview = (profile = getActiveProfile()) => {
    if (!identityPreview) return;
    const hasUser = true;
    const hasGroup = true;

    identityPreview.hidden = false;
    identityPreview.setAttribute('aria-hidden', 'false');

    const fallbackUser = profile.robloxUserName || 'Roblox profile';
    const fallbackGroup = profile.groupId
      ? profile.robloxGroupName || `Group ${profile.groupId}`
      : 'Authenticated user';
    identityUserName.textContent = fallbackUser;
    identityGroupName.textContent = fallbackGroup;
    identityGroupName.hidden = !fallbackGroup;
    if (identityUserMeta) {
      identityUserMeta.textContent = profile.robloxUserId
        ? `User ID ${profile.robloxUserId}`
        : profile.autoDetectCookie
          ? 'Auto detect cookie enabled'
          : profile.robloxCookie
            ? 'Saved cookie available'
            : 'No cookie saved';
    }
    if (identityGroupMeta) {
      identityGroupMeta.textContent = profile.groupId
        ? `Group ID ${profile.groupId}`
        : 'Uploads use the connected Roblox account';
    }

    if (identityUserAvatar) {
      identityUserAvatar.hidden = !profile.robloxUserAvatar;
      if (profile.robloxUserAvatar) identityUserAvatar.src = profile.robloxUserAvatar;
      identityUserAvatar
        .closest('.identity-row')
        ?.classList.toggle('has-image', Boolean(profile.robloxUserAvatar));
    }
    if (identityGroupAvatar) {
      identityGroupAvatar.hidden = !profile.robloxGroupAvatar;
      if (profile.robloxGroupAvatar) identityGroupAvatar.src = profile.robloxGroupAvatar;
      identityGroupAvatar
        .closest('.identity-row')
        ?.classList.toggle('has-image', Boolean(profile.robloxGroupAvatar));
    }
    identityPreview.classList.toggle('has-group', hasGroup && hasUser);
  };
  const triggerIdentityPop = (kind) => {
    const row = document.querySelector(`[data-identity-row="${CSS.escape(kind)}"]`);
    if (!row) return;
    row.classList.remove('pop');
    void row.offsetWidth;
    row.classList.add('pop');
  };

  const looksLikeApiKey = (value) => {
    const key = String(value || '').trim();
    return (
      key.length >= 40 && key.length <= 8192 && !/\s/.test(key) && /^[A-Za-z0-9._~+/=-]+$/.test(key)
    );
  };

  const showApiKeyGate = () => {
    if (!apiKeyGate) return;
    apiKeyGate.setAttribute('aria-hidden', 'false');
    apiKeyGate.classList.add('show');
    document.body.classList.add('setup-locked');
    setTimeout(() => apiKeyInput?.focus(), 120);
  };

  const hideApiKeyGate = () => {
    apiKeyGate?.classList.remove('show');
    apiKeyGate?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('setup-locked');
  };

  const completeApiKeySetup = () => {
    const key = String(apiKeyInput?.value || '').trim();
    if (!looksLikeApiKey(key)) {
      if (apiKeyError)
        apiKeyError.textContent =
          'Paste the full Roblox Open Cloud API key. It should be one long key with no spaces or line breaks.';
      apiKeyInput?.focus();
      return;
    }
    writeActiveProfilePatch({ apiKey: key });
    saveSetting('apiKeySetupDone', true);
    if (apiKeyError) apiKeyError.textContent = '';
    apiKeyEntryStep?.classList.remove('active');
    apiKeyEntryStep?.setAttribute('aria-hidden', 'true');
    apiKeySuccessStep?.removeAttribute('aria-hidden');
    requestAnimationFrame(() => apiKeySuccessStep?.classList.add('active'));
    setTimeout(hideApiKeyGate, 1900);
  };

  apiKeyGet?.addEventListener('click', () =>
    openUrl('https://create.roblox.com/dashboard/credentials'),
  );
  apiKeyDone?.addEventListener('click', completeApiKeySetup);
  apiKeyInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') completeApiKeySetup();
  });
  apiKeyInput?.addEventListener('input', () => {
    if (apiKeyError) apiKeyError.textContent = '';
  });

  if (!savedSettings.apiKeySetupDone && !getActiveProfile().apiKey) showApiKeyGate();

  minimizeBtn?.addEventListener('click', () => api.minimize?.());
  closeBtn?.addEventListener('click', () => api.close?.());
  sidebarToggle?.addEventListener('click', () => appShell?.classList.toggle('sidebar-collapsed'));

  profileTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleProfileMenu();
  });

  profileOptions.forEach((option) => {
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      selectProfile(
        option.dataset.profileId || option.dataset.profile || option.textContent.trim(),
      );
    });
  });

  profileCreate?.addEventListener('click', () => {
    const state = getProfileState();
    const profile = normalizeProfile({
      id: createProfileId(),
      name: uniqueProfileName(state.profiles),
      queueBatchSize: state.queueBatchSize || numericDefaults.queueBatchSize,
      downloadWorkers: state.downloadWorkers || numericDefaults.downloadWorkers,
      saveRunReports: state.saveRunReports !== false,
      downloadsFolder: state.downloadsFolder || '',
      reportsFolder: state.reportsFolder || '',
    });
    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    saveProfileState(state);
    renderProfiles();
    openRenameDialog();
  });

  profileDuplicate?.addEventListener('click', () => {
    const state = getProfileState();
    const active =
      state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
    if (!active) return;
    const profile = normalizeProfile({
      ...active,
      id: createProfileId(),
      name: `${active.name} copy`.slice(0, 32),
      lastRunAt: '',
    });
    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    saveProfileState(state);
    renderProfiles();
  });

  profileRename?.addEventListener('click', () => {
    openRenameDialog();
  });

  profileDelete?.addEventListener('click', async () => {
    const state = getProfileState();
    const active =
      state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
    if (!active || state.profiles.length <= 1) {
      showNotice('Keep at least one profile.', 'warning');
      return;
    }
    const ok = await confirmAction({
      title: 'Delete profile',
      message: `Delete "${active.name}"? This removes only this local profile entry.`,
      accept: 'Delete',
    });
    if (!ok) return;
    state.profiles = state.profiles.filter((profile) => profile.id !== active.id);
    state.activeProfileId = state.profiles[0].id;
    saveProfileState(state);
    renderProfiles();
  });

  profileGroupId?.addEventListener('input', () => {
    const clean = profileGroupId.value.replace(/\D/g, '');
    if (profileGroupId.value !== clean) profileGroupId.value = clean;
    const active = getActiveProfile();
    const sameGroup = clean && clean === active.groupId;
    writeActiveProfilePatch({
      groupId: clean,
      robloxGroupName: sameGroup ? active.robloxGroupName : '',
      robloxGroupAvatar: sameGroup ? active.robloxGroupAvatar : '',
    });
    if (clean) triggerIdentityPop('group');
  });

  profileAutoCookie?.addEventListener('change', () => {
    writeActiveProfilePatch({ autoDetectCookie: profileAutoCookie.checked });
  });

  profileApiKeyInput?.addEventListener('input', () => {
    writeActiveProfilePatch({ apiKey: profileApiKeyInput.value.trim() });
  });

  profileApiKeyGet?.addEventListener('click', () =>
    openUrl('https://create.roblox.com/dashboard/credentials'),
  );

  profileRefreshRoblox?.addEventListener('click', async () => {
    await runButtonTask(
      profileRefreshRoblox,
      async () => {
        const active = getActiveProfile();
        const result = await api.getRobloxProfile?.({
          cookie: active.robloxCookie,
          autoDetect: active.autoDetectCookie,
          groupId: active.groupId,
        });
        if (!result?.ok) throw new Error('Could not refresh Roblox profile.');
        writeActiveProfilePatch({
          robloxUserId: result.userId || '',
          robloxUserName: result.displayName || result.username || 'Roblox profile',
          robloxUserAvatar: result.avatarDataUrl || active.robloxUserAvatar,
          robloxGroupName: result.groupName || active.robloxGroupName,
          robloxGroupAvatar: result.groupIconDataUrl || active.robloxGroupAvatar,
        });
        triggerIdentityPop('user');
        if (active.groupId && (result.groupName || result.groupIconDataUrl))
          triggerIdentityPop('group');
        return 'Roblox profile refreshed';
      },
      {
        busyLabel: 'Refreshing',
        doneLabel: 'Refreshed',
        successMessage: 'Roblox profile refreshed',
      },
    );
  });

  profileReset?.addEventListener('click', async () => {
    const active = getActiveProfile();
    const ok = await confirmAction({
      title: 'Reset profile settings',
      message: `Reset non-secret settings for "${active.name}"? Saved credentials will stay.`,
      accept: 'Reset',
    });
    if (!ok) return;
    writeActiveProfilePatch({
      groupId: '',
      autoDetectCookie: true,
      robloxGroupName: '',
      robloxGroupAvatar: '',
      lastRunAt: '',
    });
  });

  renameCancel?.addEventListener('click', closeRenameDialog);
  renameSave?.addEventListener('click', saveRenameDialog);
  renameProfileInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveRenameDialog();
    if (event.key === 'Escape') closeRenameDialog();
  });

  profileClearCredentials?.addEventListener('click', async () => {
    const active = getActiveProfile();
    const ok = await confirmAction({
      title: 'Clear saved credentials',
      message: `Clear saved cookie and API key for "${active.name}"? This cannot be undone.`,
      accept: 'Clear',
    });
    if (!ok) return;
    writeActiveProfilePatch({ robloxCookie: '', apiKey: '' });
  });

  document.addEventListener('click', (event) => {
    if (!profilePicker?.contains(event.target)) closeProfileMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeProfileMenu();
      hideTooltip();
      profileTrigger?.focus();
      return;
    }

    if (!profilePicker?.classList.contains('open')) return;
    const activeIndex = profileOptions.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      profileOptions[Math.min(activeIndex + 1, profileOptions.length - 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      profileOptions[Math.max(activeIndex - 1, 0)]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      const activeOption = document.activeElement;
      if (activeOption?.classList?.contains('profile-option')) {
        event.preventDefault();
        selectProfile(
          activeOption.dataset.profileId ||
            activeOption.dataset.profile ||
            activeOption.textContent.trim(),
        );
      }
    }
  });

  document.querySelectorAll('[data-url]').forEach((item) => {
    item.addEventListener('click', () => openUrl(item.dataset.url));
  });

  document.querySelectorAll('.side-link').forEach((item) => {
    item.addEventListener('click', () => setActiveView(item.dataset.view || 'spoofer'));
  });

  document.querySelectorAll('.help-dot').forEach((item) => {
    item.addEventListener('mouseenter', () => showTooltip(item));
    item.addEventListener('focus', () => showTooltip(item));
    item.addEventListener('mouseleave', hideTooltip);
    item.addEventListener('blur', hideTooltip);
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (tooltip?.classList.contains('show') && activeTooltipAnchor !== item) hideTooltip();
      showTooltip(item);
    });
  });

  window.addEventListener('resize', hideTooltip);
  window.addEventListener('scroll', hideTooltip, true);

  document.querySelectorAll('input[data-setting][inputmode="numeric"]').forEach((input) => {
    if (savedSettings[input.dataset.setting] !== undefined)
      input.value = savedSettings[input.dataset.setting];

    const commit = () => {
      cleanNumberInput(input);
      saveSetting(input.dataset.setting, input.value);
    };

    input.addEventListener('input', () => {
      const cleanValue = input.value.replace(/\D/g, '');
      if (input.value !== cleanValue) input.value = cleanValue;
      saveSetting(input.dataset.setting, input.value);
    });
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    commit();
  });

  document.querySelectorAll('[data-reset-setting]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.resetSetting;
      const input = document.querySelector(`input[data-setting="${CSS.escape(key)}"]`);
      if (!input) return;
      input.value = input.dataset.defaultValue || numericDefaults[key] || input.defaultValue || '0';
      input.focus();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  document.querySelectorAll('input[type="checkbox"][data-setting]').forEach((input) => {
    if (savedSettings[input.dataset.setting] !== undefined)
      input.checked = savedSettings[input.dataset.setting] === true;
    input.addEventListener('change', () => {
      saveSetting(input.dataset.setting, input.checked);
    });
    saveSetting(input.dataset.setting, input.checked);
  });

  spooferInput?.addEventListener('input', renderSpooferPreflight);
  spooferCookieInput?.addEventListener('input', () => {
    if (spooferCookieInput.disabled) return;
    writeActiveProfilePatch({ robloxCookie: spooferCookieInput.value.trim() });
  });
  [
    spooferDownloadOnly,
    spooferEnableSpoofing,
    spooferOverridePlace,
    spooferMaxPlaceIds,
    spooferPlaceRetries,
    spooferUploadRetries,
  ].forEach((control) => {
    control?.addEventListener('input', renderSpooferPreflight);
    control?.addEventListener('change', renderSpooferPreflight);
  });
  [spooferOverridePlace, spooferMaxPlaceIds, spooferPlaceRetries, spooferUploadRetries].forEach(
    (input) => {
      input?.addEventListener('input', () => {
        const clean = input.value.replace(/\D/g, '');
        if (input.value !== clean) input.value = clean;
      });
    },
  );
  spooferSoundToggle?.addEventListener('change', () => {
    soundModeManualOverride = spooferSoundToggle.checked ? 'sound' : 'animation';
    if (soundToggleAuto) soundToggleAuto.style.display = 'none';
    renderSpooferPreflight();
  });

  spooferStart?.addEventListener('click', startSpooferRun);
  spooferPause?.addEventListener('click', () => {
    api.pauseSpoofer?.();
    spooferRunStatus = 'paused';
    if (spooferLiveStage) spooferLiveStage.textContent = 'Paused';
    setSpooferLiveVisible(true);
    renderSpooferButtons();
  });
  spooferResume?.addEventListener('click', () => {
    api.resumeSpoofer?.();
    spooferRunStatus = 'running';
    if (spooferLiveStage) spooferLiveStage.textContent = 'Running';
    setSpooferLiveVisible(true);
    renderSpooferButtons();
  });
  spooferCancel?.addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Cancel run',
      message: 'Cancel the active run after the current item finishes?',
      accept: 'Cancel run',
    });
    if (!ok) return;
    api.cancelSpoofer?.();
    spooferRunStatus = 'canceling';
    if (spooferLiveStage) spooferLiveStage.textContent = 'Canceling';
    setSpooferLiveVisible(true);
    renderSpooferButtons();
  });
  spooferCopyOutput?.addEventListener('click', async () => {
    if (spooferCopyOutput.disabled) return;
    if (await writeClipboardText(spooferOutput?.value || ''))
      pulseButton(spooferCopyOutput, 'Copied');
  });
  spooferCopyRetry?.addEventListener('click', async () => {
    if (spooferCopyRetry.disabled) return;
    if (await writeClipboardText(spooferLastRetryInput)) pulseButton(spooferCopyRetry, 'Copied');
  });
  spooferOpenActivity?.addEventListener('click', () => setActiveView('queue'));

  activityTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-activity-tab]');
    if (!button) return;
    const tab = button.dataset.activityTab || 'queue';
    activityTabs.querySelectorAll('[data-activity-tab]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-activity-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.activityPanel === tab);
    });
    if (tab === 'report') renderRunReport();
    else renderQueue();
  });

  queueFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-queue-filter]');
    if (!button) return;
    queueFilter = button.dataset.queueFilter || 'all';
    queueFilters.querySelectorAll('[data-queue-filter]').forEach((item) => {
      item.classList.toggle('active', item === button);
    });
    selectedQueueItemId = '';
    renderQueue();
  });

  queueSearch?.addEventListener('input', () => {
    selectedQueueItemId = '';
    renderQueue();
  });

  queueRows?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-queue-row]');
    if (!row) return;
    selectedQueueItemId = row.dataset.queueRow || '';
    renderQueue();
  });

  queuePause?.addEventListener('click', () => {
    if (queuePause.disabled) return;
    api.pauseSpoofer?.();
    spooferRunStatus = 'paused';
    renderSpooferButtons();
    pulseButton(queuePause, 'Paused');
    updateQueueStatus('Paused after the current item finishes');
  });

  queueResume?.addEventListener('click', () => {
    if (queueResume.disabled) return;
    api.resumeSpoofer?.();
    spooferRunStatus = 'running';
    renderSpooferButtons();
    pulseButton(queueResume, 'Resuming');
    updateQueueStatus('Resuming...');
  });

  queueCancel?.addEventListener('click', async () => {
    if (queueCancel.disabled) return;
    const ok = await confirmAction({
      title: 'Cancel queue',
      message: 'Cancel the active run after the current item finishes?',
      accept: 'Cancel run',
    });
    if (!ok) return;
    api.cancelSpoofer?.();
    spooferRunStatus = 'canceling';
    renderSpooferButtons();
    pulseButton(queueCancel, 'Canceling');
    updateQueueStatus('Canceling after current item finishes...');
  });

  queueClearDone?.addEventListener('click', () => {
    if (queueClearDone.disabled) return;
    clearCompletedQueueItems();
    pulseButton(queueClearDone, 'Cleared');
  });

  queueClearAll?.addEventListener('click', async () => {
    if (queueClearAll.disabled) return;
    const ok = await confirmAction({
      title: 'Clear queue',
      message: 'Clear every queue item for this profile? This does not cancel a running job.',
      accept: 'Clear queue',
    });
    if (!ok) return;
    clearQueueItems();
    pulseButton(queueClearAll, 'Cleared');
  });

  queueOpenLogs?.addEventListener('click', async () => {
    await runButtonTask(
      queueOpenLogs,
      async () => {
        const result = await api.openLogsFolder?.();
        if (result && result.success === false)
          throw new Error(result.error || 'Could not open logs folder.');
      },
      { busyLabel: 'Opening', doneLabel: 'Opened' },
    );
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      await runButtonTask(
        button,
        async () => {
          if (action === 'openLogs') {
            const result = await api.openLogsFolder?.();
            if (result && result.success === false)
              throw new Error(result.error || 'Could not open logs folder.');
            return 'Opened';
          }

          if (action === 'openPlugins') {
            const result = await api.openPluginsFolder?.();
            if (result && result.success === false)
              throw new Error(result.error || 'Could not open plugins folder.');
            return 'Opened';
          }

          if (action === 'copyDebugInfo') {
            const result = await api.copyDebugInfo?.(buildDiagnosticContext());
            if (result && result.success === false)
              throw new Error(result.error || 'Could not copy debug info.');
            return 'Copied';
          }

          if (action === 'exportSupportReport') {
            const result = await api.exportSupportReport?.(buildDiagnosticContext());
            if (result && result.success === false && !result.canceled) {
              throw new Error(result.error || 'Could not export support report.');
            }
            if (!result || result.canceled) return '';
            return 'Exported';
          }

          if (action === 'clearCache') {
            const result = await api.clearCache?.();
            if (result && result.success === false)
              throw new Error(result.error || 'Could not clear cache.');
            return 'Cache cleared';
          }

          if (action === 'clearSession') {
            const result = await api.clearSession?.();
            if (result && result.success === false)
              throw new Error(result.error || 'Could not clear session.');
            return 'Session cleared';
          }

          if (action === 'chooseDownloads' || action === 'chooseReports') {
            const folder = await api.selectFolder?.();
            if (!folder) {
              return '';
            }
            const key = action === 'chooseDownloads' ? 'downloadsFolder' : 'reportsFolder';
            saveSetting(key, folder);
            const label = button.querySelector('strong');
            if (label) label.textContent = 'Selected';
            button.title = folder;
            button.classList.add('is-done');
            setTimeout(() => button.classList.remove('is-done'), 1000);
            return 'Selected';
          }
          return '';
        },
        { busyLabel: 'Working', doneLabel: null },
      ).then((label) => {
        if (label) {
          pulseButton(button, label);
          showNotice(label, 'success');
        }
      });
    });
  });

  runReportFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-report-filter]');
    if (!button) return;
    reportFilter = button.dataset.reportFilter || 'all';
    runReportFilters.querySelectorAll('[data-report-filter]').forEach((item) => {
      item.classList.toggle('active', item === button);
    });
    selectedReportRowId = '';
    renderRunReport();
  });

  runReportSearch?.addEventListener('input', () => {
    selectedReportRowId = '';
    renderRunReport();
  });

  runReportRows?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-report-row]');
    if (row) selectReportRow(row.dataset.reportRow);
  });

  runCopyFailed?.addEventListener('click', async () => {
    if (runCopyFailed.disabled) return;
    const report = getActiveReport();
    const ids = (report?.rows || [])
      .filter((row) => row.result === 'Failed')
      .map((row) => row.assetId)
      .filter(Boolean);
    if (await writeClipboardText(ids.join('\n'))) pulseButton(runCopyFailed, 'Copied');
  });

  runCopyMappings?.addEventListener('click', async () => {
    if (runCopyMappings.disabled) return;
    const report = getActiveReport();
    const mappings = (report?.rows || []).map((row) => row.mapping).filter(Boolean);
    if (await writeClipboardText(mappings.join('\n'))) pulseButton(runCopyMappings, 'Copied');
  });

  runExportReport?.addEventListener('click', () => {
    if (runExportReport.disabled) return;
    exportReportJson(getActiveReport());
    pulseButton(runExportReport, 'Exported');
  });

  runOpenLogs?.addEventListener('click', async () => {
    await runButtonTask(
      runOpenLogs,
      async () => {
        const result = await api.openLogsFolder?.();
        if (result && result.success === false)
          throw new Error(result.error || 'Could not open logs folder.');
      },
      { busyLabel: 'Opening', doneLabel: 'Opened' },
    );
  });

  runRetryFailed?.addEventListener('click', async () => {
    if (runRetryFailed.disabled) return;
    const report = getActiveReport();
    if (!report?.failedRetryInput) return;
    if (spooferInput) spooferInput.value = report.failedRetryInput;
    spooferLastRetryInput = report.failedRetryInput;
    setActiveView('spoofer');
    renderSpooferPreflight();
    spooferInput?.focus();
    pulseButton(runRetryFailed, 'Loaded');
    showNotice('Failed items loaded into Spoofer. Press Start to retry them.', 'success');
  });

  runClearReport?.addEventListener('click', async () => {
    if (runClearReport.disabled) return;
    const ok = await confirmAction({
      title: 'Clear run reports',
      message: 'Clear all saved run reports for this profile?',
      accept: 'Clear reports',
    });
    if (!ok) return;
    clearRunReportsForActiveProfile();
    pulseButton(runClearReport, 'Cleared');
  });

  accentSwatch?.addEventListener('click', () => accentPicker?.click());
  accentPicker?.addEventListener('input', () => previewAccent(accentPicker.value));
  accentPicker?.addEventListener('change', () => applyAccent(accentPicker.value));
  const refreshBuildMeta = async () => {
    try {
      const [version, source] = await Promise.all([
        api.getAppVersion?.(),
        api.getReleaseSource?.(),
      ]);
      if (buildVersion) buildVersion.textContent = `v${version || '0.0.0'}`;
      if (buildSource) buildSource.textContent = source?.label || source?.id || 'Official';
    } catch {
      if (buildVersion) buildVersion.textContent = 'v0.0.0';
      if (buildSource) buildSource.textContent = 'Release source unknown';
    }
  };
  applyAccent(savedSettings.accentColour || defaultAccent);
  renderProfiles();
  refreshBuildMeta();

  let quotaPopupVisible = false;
  let quotaPopupTimer = null;

  const closeQuotaPopup = () => {
    if (!quotaPopup) return;
    quotaPopup.classList.remove('is-open', 'is-flashing');
    quotaPopupVisible = false;
    clearTimeout(quotaPopupTimer);
  };

  quotaInfoBtn?.addEventListener('click', async () => {
    if (quotaPopupVisible) {
      closeQuotaPopup();
      return;
    }
    quotaPopupVisible = true;
    if (quotaPopupText) quotaPopupText.textContent = 'Checking quota...';
    quotaPopup?.classList.add('is-open');
    quotaPopup?.classList.remove('is-flashing');

    try {
      const active = getActiveProfile();
      const result = await api.getAudioQuota?.({
        cookie: active.robloxCookie,
        autoDetect: active.autoDetectCookie,
      });
      if (result?.error) {
        if (quotaPopupText) quotaPopupText.textContent = `Could not fetch quota: ${result.error}`;
        return;
      }
      let used = null,
        capacity = null;
      if (Array.isArray(result?.quotas)) {
        const q =
          result.quotas.find((q) => String(q.duration || '').toLowerCase() === 'month') ||
          result.quotas[0];
        if (q) {
          used = Number(q.usage ?? q.used ?? 0);
          capacity = Number(q.capacity ?? q.limit ?? 0);
        }
      } else if (result?.usage) {
        used = Number(result.usage.used ?? 0);
        capacity = Number(result.usage.capacity ?? result.usage.total ?? 0);
      }
      if (used === null || capacity === null || capacity === 0) {
        if (quotaPopupText) quotaPopupText.textContent = 'Quota data unavailable.';
        return;
      }
      const remaining = Math.max(0, capacity - used);
      const pct = capacity > 0 ? Math.round((used / capacity) * 100) : 0;
      if (quotaPopupText)
        quotaPopupText.textContent = `Audio quota: ${used.toLocaleString()} / ${capacity.toLocaleString()} used (${remaining.toLocaleString()} remaining)`;
      if (pct >= 80 || used >= capacity) {
        quotaPopup?.classList.add('is-flashing');
      }
    } catch (err) {
      if (quotaPopupText) quotaPopupText.textContent = `Error: ${err.message}`;
    }

    clearTimeout(quotaPopupTimer);
    quotaPopupTimer = setTimeout(closeQuotaPopup, 8000);
  });

  document.addEventListener('click', (event) => {
    if (
      quotaPopupVisible &&
      !quotaPopup?.contains(event.target) &&
      !quotaInfoBtn?.contains(event.target)
    ) {
      closeQuotaPopup();
    }
  });

  api.onAppNotification?.((payload) => showNotice(payload));
  api.onStatusMessage?.((message) => {
    updateQueueStatus(message);
    const type = getNoticeTypeFromStatus(message);
    if (type) showNotice(String(message), type);
  });
  api.onTransferUpdate?.((payload) => {
    applyTransferUpdate(payload);
  });
  api.onSpooferResult?.((result) => {
    const report = createRunReport(result || {});
    saveRunReportForActiveProfile(report);
    updateQueueStatus(result?.success === false ? 'Run failed - see Run Report' : 'Run complete');
    stopSpooferElapsedTimer();
    finishSpooferRun();
    spooferLastRetryInput = result?.failedAnimationIdInput || '';
    if (spooferOutput)
      spooferOutput.value = result?.output || JSON.stringify(result || {}, null, 2);
    if (spooferOutputState)
      spooferOutputState.textContent = result?.success === false ? 'Failed' : 'Complete';
    if (spooferLiveStage)
      spooferLiveStage.textContent = result?.success === false ? 'Failed' : 'Complete';
    setSpooferProgress(
      result?.success === false
        ? Number(spooferLiveProgressLabel?.textContent?.replace('%', '')) || 0
        : 100,
    );
    renderSpooferButtons();
    if (result && result.success === false) {
      const summaryReason = result.summary?.failures?.[0]?.reason;
      showNotice(summaryReason || result.output || 'Run failed. Check Run Report.', 'error');
    }
  });

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = (...args) => {
    originalWarn(...args);
    showNotice(args.map(String).join(' '), 'warning');
  };
  console.error = (...args) => {
    originalError(...args);
    showNotice(args.map(String).join(' '), 'error');
  };

  window.addEventListener('error', (event) => {
    showNotice(event.message || 'Unexpected renderer error.', 'error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    showNotice(reason && reason.message ? reason.message : 'Unexpected async error.', 'error');
  });
})();
