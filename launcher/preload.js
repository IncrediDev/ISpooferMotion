'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  start: () => ipcRenderer.invoke('launcher:start'),
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  setReleaseSource: sourceId => ipcRenderer.invoke('launcher:set-source', sourceId),
  openLog: () => ipcRenderer.invoke('launcher:open-log'),
  openDataFolder: () => ipcRenderer.invoke('launcher:open-data-folder'),
  uninstallAll: () => ipcRenderer.invoke('launcher:uninstall-all'),
  quit: () => ipcRenderer.invoke('launcher:quit'),
  onStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('launcher:status', handler);
    return () => ipcRenderer.removeListener('launcher:status', handler);
  }
});
