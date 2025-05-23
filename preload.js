// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  onStatusUpdate: (callback) => ipcRenderer.on('update-status-message', (event, ...args) => callback(...args)),

  // Function to send data to main process when "Run Spoofer" is clicked
  runSpooferAction: (data) => ipcRenderer.send('run-spoofer-action', data),

  // Listen for results/output from the spoofer action
  onSpooferResult: (callback) => ipcRenderer.on('spoofer-result', (event, ...args) => callback(...args))
});