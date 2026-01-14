// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  onStatusUpdate: (callback) => ipcRenderer.on('update-status-message', (event, ...args) => callback(...args)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Function to send data to main process when "Run Spoofer" is clicked
  runSpooferAction: (data) => ipcRenderer.send('run-spoofer-action', data),

  // Listen for results/output from the spoofer action
  onSpooferResult: (callback) => ipcRenderer.on('spoofer-result', (event, ...args) => callback(...args)),

  // Fetch audio quota from Roblox API
  fetchAudioQuota: (cookie, autoDetect) => ipcRenderer.invoke('fetch-audio-quota', { cookie, autoDetect }),

  // Select folder for download-only mode
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Open logs folder
  openLogsFolder: () => ipcRenderer.send('open-logs-folder')
  
});