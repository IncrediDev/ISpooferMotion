'use strict';

window.ISM = window.ISM || {};

(function registerSpoofer() {
  const { byId, setText, setHidden, copyText } = window.ISM.dom;
  const api = window.electronAPI || {};
  const state = {
    lastOutput: '',
    lastInput: '',
    running: false,
    paused: false,
    rendererSettings: {},
    saveApiKeyTimer: null,
    transfers: {
      download: { total: 0, completed: 0, failed: 0, seen: new Map() },
      upload: { total: 0, completed: 0, failed: 0, seen: new Map() },
    },
  };

  function getValue(id) {
    return byId(id)?.value?.trim() || '';
  }

  function getNumber(id, fallback) {
    const value = Number.parseInt(getValue(id), 10);
    return Number.isFinite(value) ? value : fallback;
  }

  function isChecked(id) {
    return Boolean(byId(id)?.checked);
  }

  function setStatus(message) {
    setText(byId('status-text'), message || 'Ready');
  }

  function resetTransfers() {
    state.transfers = {
      download: { total: 0, completed: 0, failed: 0, seen: new Map() },
      upload: { total: 0, completed: 0, failed: 0, seen: new Map() },
    };
  }

  function getInputCount() {
    return getValue('animationId')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length;
  }

  function formatPhaseStatus(direction) {
    const phase = state.transfers[direction];
    const label = direction === 'upload' ? 'Uploading' : 'Downloading';
    const total = phase.total || getInputCount() || 0;
    const failed = phase.failed ? ` • Failed ${phase.failed}` : '';
    return total ? `${label} ${phase.completed}/${total}${failed}` : label;
  }

  function normalizeStatusMessage(message) {
    const value = String(message || '').trim();
    if (!value) return 'Ready';

    if (/^downloaded\s+(\d+)\/(\d+)/i.test(value)) {
      const [, done, total] = value.match(/^downloaded\s+(\d+)\/(\d+)/i);
      return `Downloading ${done}/${total}`;
    }

    if (/^uploaded\s+(\d+)\/(\d+)/i.test(value)) {
      const [, done, total] = value.match(/^uploaded\s+(\d+)\/(\d+)/i);
      return `Uploading ${done}/${total}`;
    }

    if (/^downloading/i.test(value)) return formatPhaseStatus('download');
    if (/^uploading/i.test(value)) return formatPhaseStatus('upload');
    if (/processing/i.test(value)) return state.running ? 'Working' : 'Ready';
    return value;
  }

  async function loadSavedApiKey() {
    try {
      const settings = await api.loadRendererSettings?.();
      state.rendererSettings = settings && typeof settings === 'object' ? settings : {};
      const savedKey =
        typeof state.rendererSettings.openCloudApiKey === 'string'
          ? state.rendererSettings.openCloudApiKey
          : '';
      const apiKeyInput = byId('openCloudApiKey');
      if (apiKeyInput && savedKey && !apiKeyInput.value) apiKeyInput.value = savedKey;
    } catch {
      state.rendererSettings = {};
    }
  }

  function saveApiKeySoon() {
    clearTimeout(state.saveApiKeyTimer);
    state.saveApiKeyTimer = setTimeout(async () => {
      try {
        state.rendererSettings = {
          ...state.rendererSettings,
          openCloudApiKey: getValue('openCloudApiKey'),
        };
        await api.saveRendererSettings?.(state.rendererSettings);
      } catch {}
    }, 350);
  }

  function refreshSummary() {
    const soundMode = isChecked('spoof-sounds');
    const status = byId('status-text');
    if (status && !state.running) {
      status.dataset.mode = soundMode ? 'sounds' : 'animations';
    }
  }

  function refreshDownloadOnlyState() {
    const downloadOnly = isChecked('download-only');
    const groupId = byId('groupId');

    setHidden(byId('download-folder-group'), !downloadOnly);

    if (downloadOnly) {
      if (groupId) {
        groupId.disabled = true;
        groupId.value = '';
      }
    } else if (groupId) {
      groupId.disabled = false;
    }

    refreshSummary();
  }

  function refreshCookieState() {
    const input = byId('robloxCookie');
    const auto = isChecked('autoDetectCookie');
    if (!input) return;
    input.disabled = auto;
    input.placeholder = auto ? 'Auto detect is enabled' : 'Enter .ROBLOSECURITY cookie';
    refreshSummary();
  }

  function setRunState(running, paused = false) {
    state.running = Boolean(running);
    state.paused = Boolean(paused);

    const runButton = byId('run-spoofer-btn');
    const pauseResumeButton = byId('pause-resume-spoofer-btn');

    if (runButton) {
      runButton.disabled = false;
      runButton.textContent = state.running ? 'Cancel' : 'Start';
      runButton.classList.toggle('is-cancel-mode', state.running);
    }

    if (pauseResumeButton) {
      pauseResumeButton.disabled = !state.running;
      pauseResumeButton.textContent = state.paused ? 'Resume' : 'Pause';
    }
  }

  function buildPayload(extra = {}) {
    const payload = {
      animationId: getValue('animationId'),
      robloxCookie: getValue('robloxCookie'),
      apiKey: getValue('openCloudApiKey'),
      groupId: getValue('groupId'),
      spoofSounds: isChecked('spoof-sounds'),
      enableSpoofing: !isChecked('download-only'),
      downloadOnly: isChecked('download-only'),
      autoDetectCookie: isChecked('autoDetectCookie'),
      downloadFolder: getValue('downloadFolder'),
      maxPlaceIds: getNumber('maxPlaceIds', 10),
      maxPlaceIdRetries: getNumber('maxPlaceIdRetries', 3),
      overridePlaceId: getValue('overridePlaceId'),
      uploadRetries: getNumber('uploadRetries', 3),
      uploadRetryDelay: getNumber('uploadRetryDelay', 5000),
      batchRetries: getNumber('batchRetries', 3),
      batchRetryDelay: getNumber('batchRetryDelay', 2000),
      batchTimeoutMs: getNumber('batchTimeoutMs', 15000),
      batchChunkSize: getNumber('batchChunkSize', 20),
      downloadRetries: getNumber('downloadRetries', 2),
      downloadRetryDelayMs: getNumber('downloadRetryDelayMs', 2000),
      downloadTimeoutMs: getNumber('downloadTimeoutMs', 15000),
      ...extra,
    };
    state.lastInput = payload.animationId;
    return payload;
  }

  function validateBeforeRun(payload) {
    if (!payload.animationId) return 'Paste at least one asset entry first.';
    if (payload.downloadOnly && !payload.downloadFolder)
      return 'Choose a download folder for Download only mode.';
    if (!payload.downloadOnly && !payload.apiKey)
      return 'Open Cloud API key is required for upload/spoofing.';
    if (!payload.autoDetectCookie && !payload.robloxCookie)
      return 'Enter a Roblox cookie or enable Auto detect cookie.';
    return null;
  }

  function run(extra = {}) {
    const payload = buildPayload(extra);
    const error = validateBeforeRun(payload);
    if (error) {
      setStatus(error);
      return;
    }

    resetTransfers();
    setRunState(true, false);
    setStatus(`Downloading 0/${getInputCount() || 0}`);
    saveApiKeySoon();
    byId('output-data').value = '';
    api.runSpooferAction?.(payload);
  }

  function bindEvents() {
    ['groupId', 'openCloudApiKey', 'robloxCookie', 'spoof-sounds', 'batchChunkSize'].forEach(
      (id) => {
        byId(id)?.addEventListener('input', refreshSummary);
        byId(id)?.addEventListener('change', refreshSummary);
      },
    );

    byId('openCloudApiKey')?.addEventListener('input', saveApiKeySoon);

    byId('download-only')?.addEventListener('change', refreshDownloadOnlyState);
    byId('autoDetectCookie')?.addEventListener('change', refreshCookieState);

    byId('paste-animationId-btn')?.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          byId('animationId').value = text.trim();
          setStatus('Pasted asset input.');
        }
      } catch {
        setStatus('Clipboard paste failed.');
      }
    });

    byId('select-folder-btn')?.addEventListener('click', async () => {
      try {
        const folder = await api.selectFolder?.();
        if (folder) byId('downloadFolder').value = folder;
      } catch {
        setStatus('Could not select folder.');
      }
    });

    byId('run-spoofer-btn')?.addEventListener('click', () => {
      if (state.running) {
        api.cancelSpoofer?.();
        setRunState(false);
        setStatus('Cancelled');
        return;
      }
      run();
    });
    byId('pause-resume-spoofer-btn')?.addEventListener('click', () => {
      if (!state.running) return;
      if (state.paused) {
        api.resumeSpoofer?.();
        setRunState(true, false);
        setStatus('Resuming...');
      } else {
        api.pauseSpoofer?.();
        setRunState(true, true);
        setStatus('Paused');
      }
    });
    byId('copy-output-btn')?.addEventListener('click', async () => {
      const ok = await copyText(byId('output-data')?.value || state.lastOutput);
      setStatus(ok ? 'Output copied.' : 'Nothing to copy.');
    });

    byId('copy-retry-input-btn')?.addEventListener('click', async () => {
      const ok = await copyText(state.lastInput || getValue('animationId'));
      setStatus(ok ? 'Retry input copied.' : 'Nothing to copy.');
    });

    byId('session-resume-btn')?.addEventListener('click', () => run({ resumeSession: true }));
    byId('session-discard-btn')?.addEventListener('click', async () => {
      api.clearSession?.();
      setHidden(byId('session-banner'), true);
      setStatus('Session discarded.');
    });
  }

  function bindIpc() {
    api.onStatusUpdate?.((message) => setStatus(normalizeStatusMessage(message)));

    api.onSpooferResult?.((result) => {
      const output = typeof result === 'string' ? result : result?.output;
      if (output != null) {
        const textarea = byId('output-data');
        state.lastOutput = String(output);
        if (textarea) textarea.value = state.lastOutput;
      }
      setRunState(false, false);
      setStatus(result?.success === false ? 'Failed' : 'Complete');
    });

    api.onTransferUpdate?.((update) => {
      if (!update || typeof update !== 'object') return;
      const direction = update.direction === 'upload' ? 'upload' : 'download';
      const phase = state.transfers[direction];
      const id = update.id ? String(update.id) : `${direction}:${phase.seen.size}`;
      const previous = phase.seen.get(id) || { status: null };
      const status = String(update.status || previous.status || '').toLowerCase();

      if (!phase.seen.has(id)) {
        phase.seen.set(id, { status });
        phase.total = phase.seen.size;
      }

      if (status === 'completed' && previous.status !== 'completed') phase.completed += 1;
      if (status === 'error' && previous.status !== 'error') phase.failed += 1;

      phase.seen.set(id, { status });

      if (status === 'error') {
        setStatus(formatPhaseStatus(direction));
        return;
      }

      if (
        status === 'completed' ||
        status === 'queued' ||
        status === 'processing' ||
        Number.isFinite(update.progress)
      ) {
        setStatus(formatPhaseStatus(direction));
      }
    });
  }

  async function checkSession() {
    try {
      const session = await api.checkSession?.();
      if (!session?.animationIdInput) return;
      const pending = Math.max(
        0,
        Number(session.totalCount || 0) - Number(session.completedMappings?.length || 0),
      );
      setText(byId('session-pending-count'), pending);
      setHidden(byId('session-banner'), false);
    } catch {}
  }

  function init() {
    void loadSavedApiKey();
    setRunState(false);
    refreshDownloadOnlyState();
    refreshCookieState();
    bindEvents();
    bindIpc();
    checkSession();
  }

  window.ISM.spoofer = Object.freeze({ init, refreshSummary, run });
})();
