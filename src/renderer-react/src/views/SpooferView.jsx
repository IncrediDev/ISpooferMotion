import { useEffect, useRef, useState } from 'react';

export default function SpooferView({ isActive }) {
  const [animationId, setAnimationId] = useState('');
  const [robloxCookie, setRobloxCookie] = useState('');
  const [openCloudApiKey, setOpenCloudApiKey] = useState('');
  const [groupId, setGroupId] = useState('');

  const [autoDetectCookie, setAutoDetectCookie] = useState(true);
  const [downloadOnly, setDownloadOnly] = useState(false);
  const [spoofSounds, setSpoofSounds] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);

  const [downloadFolder, setDownloadFolder] = useState('');

  const [maxPlaceIds, setMaxPlaceIds] = useState(10);
  const [maxPlaceIdRetries, setMaxPlaceIdRetries] = useState(3);
  const [overridePlaceId, setOverridePlaceId] = useState('');
  const [uploadRetries, setUploadRetries] = useState(3);
  const [uploadRetryDelay, setUploadRetryDelay] = useState(5000);

  const [outputData, setOutputData] = useState('');
  const [statusText, setStatusText] = useState('No run yet');
  const [inlineQuotaText, setInlineQuotaText] = useState('Checking quota...');
  const [inlineQuotaError, setInlineQuotaError] = useState(false);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastInput, setLastInput] = useState('');

  // transfers tracking
  const transfersRef = useRef({
    download: { total: 0, completed: 0, failed: 0, seen: new Map() },
    upload: { total: 0, completed: 0, failed: 0, seen: new Map() },
  });

  const getActiveProfileSettings = async () => {
    try {
      const secrets = await window.electronAPI?.loadProfileSecrets?.();
      if (!secrets) return null;
      return secrets.profiles[secrets.activeProfileId];
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let active = true;
    if (!spoofSounds) return;

    setInlineQuotaText('Checking quota...');
    setInlineQuotaError(false);

    window.electronAPI
      ?.getAudioQuota?.({ cookie: robloxCookie, autoDetect: autoDetectCookie })
      .then((result) => {
        if (!active) return;
        if (result && result.error) {
          setInlineQuotaError(true);
          setInlineQuotaText(`Quota error: ${result.error}`);
          return;
        }

        let used = 0;
        let capacity = 0;
        if (Array.isArray(result.quotas)) {
          const quota =
            result.quotas.find((q) => String(q?.duration).toLowerCase() === 'month') ||
            result.quotas[0];
          used = Number(quota?.usage ?? quota?.used ?? quota?.consumed ?? 0);
          capacity = Number(quota?.capacity ?? quota?.limit ?? quota?.total ?? 0);
        } else if (result.usage && typeof result.usage === 'object') {
          used = Number(result.usage.used ?? result.usage.usage ?? 0);
          capacity = Number(result.usage.capacity ?? result.usage.total ?? result.usage.limit ?? 0);
        } else {
          used = Number(result.usage ?? result.used ?? 0);
          capacity = Number(result.capacity ?? result.total ?? result.limit ?? 0);
        }

        if (!Number.isFinite(used) || !Number.isFinite(capacity) || capacity <= 0) {
          setInlineQuotaText('Quota data unavailable.');
        } else {
          const remaining = Math.max(0, capacity - used);
          setInlineQuotaText(
            `Audio quota: ${used.toLocaleString()} / ${capacity.toLocaleString()} used (${remaining.toLocaleString()} remaining)`,
          );
        }
      })
      .catch((err) => {
        if (!active) return;
        setInlineQuotaError(true);
        setInlineQuotaText(`Quota error: ${err.message}`);
      });

    return () => {
      active = false;
    };
  }, [spoofSounds, robloxCookie, autoDetectCookie]);

  useEffect(() => {
    // When profile changes, we want to update the fields
    const handleProfileChanged = async () => {
      const profile = await getActiveProfileSettings();
      if (profile) {
        setRobloxCookie(profile.cookie ?? '');
        setOpenCloudApiKey(profile.apiKey ?? '');
        setGroupId(profile.groupId ?? '');
        setAutoDetectCookie(profile.autoDetectCookie ?? true);
        setDownloadOnly(profile.downloadOnly ?? false);
        setSpoofSounds(profile.spoofSounds ?? false);
      }
    };
    window.addEventListener('profile-changed', handleProfileChanged);
    handleProfileChanged();

    // IPC listeners
    const cleanupStatus = window.electronAPI?.onStatusUpdate?.((msg) => {
      setStatusText(msg || 'Ready'); // Basic normalization logic here
    });

    const cleanupResult = window.electronAPI?.onSpooferResult?.((result) => {
      setRunning(false);
      setPaused(false);
      if (result) {
        const output = typeof result === 'string' ? result : result.output;
        if (output != null) setOutputData(String(output));
        const isSuccess = result.success !== false;
        setStatusText(isSuccess ? 'Complete' : 'Failed');
      }
    });

    const cleanupTransfer = window.electronAPI?.onTransferUpdate?.((update) => {
      if (!update) return;
      const direction = update.direction === 'upload' ? 'upload' : 'download';
      const phase = transfersRef.current[direction];
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
        // Removed bad status override
      }
    });

    return () => {
      window.removeEventListener('profile-changed', handleProfileChanged);
      cleanupStatus && cleanupStatus();
      cleanupResult && cleanupResult();
      cleanupTransfer && cleanupTransfer();
    };
  }, []);

  const handleRun = async () => {
    if (running) {
      window.electronAPI?.cancelSpoofer?.();
      setRunning(false);
      setStatusText('Cancelled');
      return;
    }

    if (!animationId.trim()) {
      setStatusText('Paste at least one asset entry first.');
      return;
    }
    if (downloadOnly && !downloadFolder) {
      setStatusText('Choose a download folder for Download only mode.');
      return;
    }
    if (!downloadOnly && !openCloudApiKey) {
      setStatusText('Open Cloud API key is required for upload/spoofing.');
      return;
    }
    if (!autoDetectCookie && !robloxCookie) {
      setStatusText('Enter a Roblox cookie or enable Auto detect cookie.');
      return;
    }

    setRunning(true);
    setPaused(false);
    setStatusText('Starting...');
    setOutputData('');
    transfersRef.current = {
      download: { total: 0, completed: 0, failed: 0, seen: new Map() },
      upload: { total: 0, completed: 0, failed: 0, seen: new Map() },
    };
    setLastInput(animationId);

    // Fetch the rest of the settings from active profile
    const profile = (await getActiveProfileSettings()) || {};

    const payload = {
      animationId,
      robloxCookie,
      apiKey: openCloudApiKey,
      groupId,
      spoofSounds,
      enableSpoofing: !downloadOnly,
      downloadOnly,
      autoDetectCookie,
      downloadFolder,
      maxPlaceIds,
      maxPlaceIdRetries,
      overridePlaceId,
      uploadRetries,
      uploadRetryDelay,

      // Defaults from profile/settings
      batchRetries: profile.defRetries ?? 3,
      batchRetryDelay: profile.defDelay ?? 5000,
      batchTimeoutMs: 15000,
      batchChunkSize: 20,
      downloadRetries: 2,
      downloadRetryDelayMs: 2000,
      downloadTimeoutMs: 15000,
      concurrentUploads: profile.concurrent ?? false,
      maxConcurrentUploads: profile.maxConcurrentUploads ?? 10,
      replaceExisting,
      renamePrefix: '', // Can be loaded from settings
      renameSuffix: '',
      renameFind: '',
      renameReplace: '',
      maxConcurrentDownloads: profile.maxConcurrentDownloads ?? 20,
      desktopNotifications: profile.notifications ?? true,
    };

    window.electronAPI?.runSpooferAction?.(payload);
  };

  const handlePauseResume = () => {
    if (!running) return;
    if (paused) {
      window.electronAPI?.resumeSpoofer?.();
      setPaused(false);
      setStatusText('Resuming...');
    } else {
      window.electronAPI?.pauseSpoofer?.();
      setPaused(true);
      setStatusText('Paused');
    }
  };

  const handleSelectFolder = async (e) => {
    e.preventDefault();
    try {
      const folder = await window.electronAPI?.selectFolder?.();
      if (folder) setDownloadFolder(folder);
    } catch {
      setStatusText('Could not select folder.');
    }
  };

  // Profile saving helper
  const updateProfileValue = async (key, value) => {
    try {
      const secrets = await window.electronAPI?.loadProfileSecrets?.();
      const activeId = secrets?.activeProfileId;
      if (!activeId) return;
      const profile = secrets.profiles[activeId];
      profile[key] = value;
      await window.electronAPI?.saveProfileSecrets?.({
        action: 'saveProfile',
        profileId: activeId,
        secrets: profile,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleInputTextChange = (val) => {
    setAnimationId(val);
    if (val.includes('TYPE: SOUND')) {
      setSpoofSounds(true);
    } else if (val.includes('TYPE: ANIMATION')) {
      setSpoofSounds(false);
    }
  };

  return (
    <section
      className={`view spoofer-view ${isActive ? 'is-active' : ''}`}
      data-view-panel="spoofer"
      aria-label="Spoofer"
    >
      <div className="spoofer-page" id="spoofer-page">
        <div className="bento-grid">
          <div className="bento-card asset-card">
            <div className="asset-input-wrapper">
              <div className="asset-header">
                <h3>Asset IDs</h3>
                <span className="asset-hint">Supports [assetId], [name], and [userId]</span>
              </div>
              <textarea
                className="ui-textarea code-input asset-textarea"
                id="animationId"
                name="animationId"
                placeholder="[12345678] [ExampleAsset] [User12345]"
                value={animationId}
                onChange={(e) => handleInputTextChange(e.target.value)}
              ></textarea>
            </div>
            <div className="asset-actions">
              <button
                className={`primary-action ${running ? 'is-cancel-mode' : ''}`}
                id="run-spoofer-btn"
                type="button"
                onClick={handleRun}
              >
                {running ? 'Cancel' : 'Start'}
              </button>
              <button
                className="ui-button"
                id="pause-resume-spoofer-btn"
                type="button"
                disabled={!running}
                onClick={handlePauseResume}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          </div>

          <div className="bento-card setup-card">
            <h3>Quick Setup</h3>
            <div className="bento-fields">
              <label className="floating-label">
                <input
                  className="ui-input"
                  type="password"
                  id="robloxCookie"
                  name="robloxCookie"
                  placeholder=" "
                  autoComplete="off"
                  disabled={autoDetectCookie}
                  value={robloxCookie}
                  onChange={(e) => {
                    setRobloxCookie(e.target.value);
                    updateProfileValue('cookie', e.target.value);
                  }}
                />
                <span>Roblox Cookie {autoDetectCookie && '(Auto detect on)'}</span>
              </label>
              <label className="floating-label api-key-row">
                <div className="input-button-row embedded-button-row">
                  <input
                    className="ui-input"
                    type="password"
                    id="openCloudApiKey"
                    name="openCloudApiKey"
                    placeholder=" "
                    autoComplete="off"
                    value={openCloudApiKey}
                    onChange={(e) => {
                      setOpenCloudApiKey(e.target.value);
                      updateProfileValue('apiKey', e.target.value);
                    }}
                  />
                  <span>Open Cloud API Key</span>
                  <button
                    className="ui-button get-api-key-btn"
                    id="get-api-key-btn"
                    type="button"
                    onClick={() =>
                      window.electronAPI?.openExternal?.(
                        'https://create.roblox.com/dashboard/credentials',
                      )
                    }
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3m-2 16H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7Z" />
                    </svg>
                    Get Key
                  </button>
                </div>
              </label>
              <label className="floating-label">
                <input
                  className="ui-input"
                  type="text"
                  id="groupId"
                  name="groupId"
                  placeholder=" "
                  autoComplete="off"
                  disabled={downloadOnly}
                  value={groupId}
                  onChange={(e) => {
                    setGroupId(e.target.value);
                    updateProfileValue('groupId', e.target.value);
                  }}
                />
                <span>Group ID (Blank for user)</span>
              </label>
              <div className="switches-row">
                <label className="option-row inline-option" htmlFor="autoDetectCookie">
                  <span>Auto detect cookie</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="autoDetectCookie"
                      checked={autoDetectCookie}
                      onChange={(e) => {
                        setAutoDetectCookie(e.target.checked);
                        updateProfileValue('autoDetectCookie', e.target.checked);
                      }}
                    />
                    <i></i>
                  </span>
                </label>
                <label className="option-row" htmlFor="download-only">
                  <span>Download only</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="download-only"
                      checked={downloadOnly}
                      onChange={(e) => {
                        setDownloadOnly(e.target.checked);
                        updateProfileValue('downloadOnly', e.target.checked);
                      }}
                    />
                    <i></i>
                  </span>
                </label>
                <label className="option-row" htmlFor="spoof-sounds">
                  <span>Sound mode</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="spoof-sounds"
                      checked={spoofSounds}
                      onChange={(e) => {
                        setSpoofSounds(e.target.checked);
                        updateProfileValue('spoofSounds', e.target.checked);
                      }}
                    />
                    <i></i>
                  </span>
                </label>
                <label className="option-row" htmlFor="replace-existing">
                  <span>Replace existing</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      id="replace-existing"
                      checked={replaceExisting}
                      onChange={(e) => setReplaceExisting(e.target.checked)}
                    />
                    <i></i>
                  </span>
                </label>
              </div>

              <div
                className={`download-folder-wrap ${downloadOnly ? 'is-visible' : ''}`}
                id="download-folder-group"
              >
                <div className="download-folder-inner">
                  <label className="floating-label api-key-row">
                    <div className="input-button-row embedded-button-row">
                      <input
                        className="ui-input"
                        type="text"
                        id="downloadFolder"
                        name="downloadFolder"
                        placeholder=" "
                        readOnly
                        value={downloadFolder}
                      />
                      <span>Download folder</span>
                      <button
                        className="ui-button get-api-key-btn"
                        id="select-folder-btn"
                        type="button"
                        onClick={handleSelectFolder}
                      >
                        Select
                      </button>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="setup-divider"></div>

            <div className="advanced-setup-card">
              <h3>Advanced Settings</h3>
              <div className="bento-fields advanced-fields">
                <label className="floating-label">
                  <input
                    className="ui-input"
                    type="number"
                    id="maxPlaceIds"
                    name="maxPlaceIds"
                    value={maxPlaceIds}
                    min="10"
                    max="50"
                    placeholder=" "
                    onChange={(e) => setMaxPlaceIds(Number(e.target.value))}
                  />
                  <span>Max places</span>
                </label>
                <label className="floating-label">
                  <input
                    className="ui-input"
                    type="number"
                    id="maxPlaceIdRetries"
                    name="maxPlaceIdRetries"
                    value={maxPlaceIdRetries}
                    min="1"
                    max="10"
                    placeholder=" "
                    onChange={(e) => setMaxPlaceIdRetries(Number(e.target.value))}
                  />
                  <span>Max retries</span>
                </label>
                <label className="floating-label">
                  <input
                    className="ui-input"
                    type="text"
                    id="overridePlaceId"
                    name="overridePlaceId"
                    placeholder=" "
                    value={overridePlaceId}
                    onChange={(e) => setOverridePlaceId(e.target.value)}
                  />
                  <span>Override place ID</span>
                </label>
                <label className="floating-label">
                  <input
                    className="ui-input"
                    type="number"
                    id="uploadRetries"
                    name="uploadRetries"
                    value={uploadRetries}
                    min="1"
                    max="10"
                    placeholder=" "
                    onChange={(e) => setUploadRetries(Number(e.target.value))}
                  />
                  <span>Upload retries</span>
                </label>
                <label className="floating-label">
                  <input
                    className="ui-input"
                    type="number"
                    id="uploadRetryDelay"
                    name="uploadRetryDelay"
                    value={uploadRetryDelay}
                    min="1000"
                    step="1000"
                    placeholder=" "
                    onChange={(e) => setUploadRetryDelay(Number(e.target.value))}
                  />
                  <span>Retry delay (ms)</span>
                </label>
              </div>
            </div>
          </div>

          <div className="bento-card output-card">
            <div className="output-header section-heading">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3>Output</h3>
                <div
                  className={`inline-quota ${spoofSounds ? 'show' : ''} ${inlineQuotaError ? 'error' : ''}`}
                  id="inline-quota"
                  aria-live="polite"
                >
                  <span id="inline-quota-text">{inlineQuotaText}</span>
                </div>
              </div>
              <span className="spoofer-status-text" id="status-text">
                {statusText}
              </span>
            </div>
            <textarea
              className="ui-textarea output-textarea"
              id="output-data"
              readOnly
              placeholder="Run output appears here."
              value={outputData}
            ></textarea>
            <div className="output-actions">
              <button
                className="ui-button"
                id="copy-output-btn"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(outputData);
                    setStatusText('Output copied.');
                  } catch {
                    setStatusText('Nothing to copy.');
                  }
                }}
              >
                Copy output
              </button>
              <button
                className="ui-button"
                id="copy-retry-input-btn"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(lastInput || animationId);
                    setStatusText('Retry input copied.');
                  } catch {
                    setStatusText('Nothing to copy.');
                  }
                }}
              >
                Copy retry input
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
