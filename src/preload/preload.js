const { contextBridge, ipcRenderer } = require('electron');

const send = (channel, ...args) => ipcRenderer.send(channel, ...args);
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, listener) => {
  if (typeof listener !== 'function') return () => {};
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => send('window-minimize'),
  close: () => send('window-close'),
  openExternal: (url) => invoke('open-external', url),
  getRuntimeInfo: () => invoke('get-runtime-info'),
  getAppVersion: () => invoke('get-app-version'),
  getReleaseSource: () => invoke('get-release-source'),
  loadProfileSecrets: (profileIds) => invoke('load-profile-secrets', profileIds || []),
  saveProfileSecrets: (data) => invoke('save-profile-secrets', data || {}),
  clearProfileSecrets: (profileId) => invoke('clear-profile-secrets', profileId),
  getRobloxProfile: (context) => invoke('get-roblox-profile', context || {}),
  pauseSpoofer: () => send('spoofer-pause'),
  resumeSpoofer: () => send('spoofer-resume'),
  cancelSpoofer: () => send('spoofer-cancel'),
  runSpooferAction: (payload) => send('run-spoofer-action', payload || {}),
  checkSession: () => invoke('check-session'),
  openLogsFolder: () => invoke('open-logs-folder'),
  openPluginsFolder: () => invoke('open-plugins-folder'),
  copyDebugInfo: (context) => invoke('copy-debug-info', context || {}),
  exportSupportReport: (context) => invoke('export-support-report', context || {}),
  clearSession: () => invoke('clear-app-history'),
  clearCache: () => invoke('clear-asset-history'),
  selectFolder: () => invoke('select-folder'),
  getAudioQuota: (context) => invoke('fetch-audio-quota', context || {}),
  onStatusMessage: (listener) => on('update-status-message', listener),
  onTransferUpdate: (listener) => on('transfer-update', listener),
  onSpooferResult: (listener) => on('spoofer-result', listener),
  onAppNotification: (listener) => on('app-notification', listener),
});
