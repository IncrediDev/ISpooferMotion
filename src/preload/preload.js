'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const NOOP = () => {};

const SEND_CHANNELS = new Set([
  'window-minimize',
  'window-close',
  'open-external',
  'run-spoofer-action',
  'spoofer-pause',
  'spoofer-resume',
  'spoofer-cancel',
  'clear-session',
]);

const INVOKE_CHANNELS = new Set([
  'get-app-version',
  'get-release-source',
  'get-runtime-info',
  'load-renderer-settings',
  'save-renderer-settings',
  'load-profile-secrets',
  'save-profile-secrets',
  'clear-profile-secrets',
  'get-roblox-profile',
  'validate-opencloud-api-key',
  'search-place-ids',
  'fetch-audio-quota',
  'select-folder',
  'open-logs-folder',
  'open-plugins-folder',
  'copy-debug-info',
  'export-support-report',
  'clear-asset-history',
  'check-session',
  'open-data-folder',
  'open-logs-folder',
  'clear-app-cache',
  'uninstall-app',
  'get-jobs',
  'delete-job',
  'show-notification',
  'open-dev-console',
]);

const SUBSCRIBE_CHANNELS = new Set([
  'update-status-message',
  'spoofer-result',
  'transfer-update',
  'spoofer-log',
  'spoofer-progress',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value) {
  return isRecord(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeExternalUrl(value) {
  if (typeof value !== 'string') return null;

  const rawUrl = value.trim();
  if (!rawUrl || rawUrl.length > 2048) return null;

  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function send(channel, ...args) {
  if (!SEND_CHANNELS.has(channel)) {
    throw new Error(`Blocked IPC send channel: ${channel}`);
  }

  ipcRenderer.send(channel, ...args);
}

function invoke(channel, ...args) {
  if (!INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`Blocked IPC invoke channel: ${channel}`));
  }

  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel, callback) {
  if (!SUBSCRIBE_CHANNELS.has(channel) || typeof callback !== 'function') return NOOP;

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const electronAPI = Object.freeze({
  minimize: () => send('window-minimize'),
  close: () => send('window-close'),

  onStatusUpdate: (callback) => subscribe('update-status-message', callback),
  onStatusMessage: (callback) => subscribe('update-status-message', callback),
  onSpooferResult: (callback) => subscribe('spoofer-result', callback),
  onTransferUpdate: (callback) => subscribe('transfer-update', callback),
  onSpooferLog: (callback) => subscribe('spoofer-log', callback),
  onSpooferProgress: (callback) => subscribe('spoofer-progress', callback),

  getAppVersion: () => invoke('get-app-version'),
  getReleaseSource: () => invoke('get-release-source'),
  getRuntimeInfo: () => invoke('get-runtime-info'),

  openExternal: (url) => {
    const safeUrl = sanitizeExternalUrl(url);
    if (!safeUrl) return false;
    send('open-external', safeUrl);
    return true;
  },

  loadRendererSettings: () => invoke('load-renderer-settings'),
  saveRendererSettings: (settings) => invoke('save-renderer-settings', asRecord(settings)),
  loadProfileSecrets: () => invoke('load-profile-secrets'),
  saveProfileSecrets: (data) => invoke('save-profile-secrets', asRecord(data)),
  clearProfileSecrets: (profileId) => invoke('clear-profile-secrets', profileId),
  getRobloxProfile: (context) => invoke('get-roblox-profile', asRecord(context)),
  validateOpenCloudApiKey: (apiKey) => invoke('validate-opencloud-api-key', String(apiKey || '')),
  searchPlaceIds: (context) => invoke('search-place-ids', asRecord(context)),

  runSpooferAction: (data) => send('run-spoofer-action', asRecord(data)),
  pauseSpoofer: () => send('spoofer-pause'),
  resumeSpoofer: () => send('spoofer-resume'),
  cancelSpoofer: () => send('spoofer-cancel'),
  resumeSession: (data) => send('run-spoofer-action', { ...asRecord(data), resumeSession: true }),

  fetchAudioQuota: (cookie, autoDetect) =>
    invoke('fetch-audio-quota', { cookie, autoDetect: Boolean(autoDetect) }),
  getAudioQuota: (context) => invoke('fetch-audio-quota', asRecord(context)),
  selectFolder: () => invoke('select-folder'),
  openLogsFolder: () => invoke('open-logs-folder'),
  openPluginsFolder: () => invoke('open-plugins-folder'),
  copyDebugInfo: (context) => invoke('copy-debug-info', asRecord(context)),
  exportSupportReport: (context) => invoke('export-support-report', asRecord(context)),
  clearCache: () => invoke('clear-asset-history'),
  openDataFolder: () => invoke('open-data-folder'),
  clearAppCache: () => invoke('clear-app-cache'),
  showNotification: (options) => invoke('show-notification', asRecord(options)),
  openDevConsole: () => invoke('open-dev-console'),

  checkSession: () => invoke('check-session'),
  uninstallApp: () => invoke('uninstall-app'),
  getJobs: () => invoke('get-jobs'),
  deleteJob: (jobId) => invoke('delete-job', jobId),
  clearSession: () => send('clear-session'),
});

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
