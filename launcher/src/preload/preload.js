'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherPopupAPI', {
  ready: (id) => ipcRenderer.send('launcher:popup-ready', String(id || '')),
  onInit: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('popup:init', handler);
    return () => ipcRenderer.removeListener('popup:init', handler);
  },
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('popup:progress', handler);
    return () => ipcRenderer.removeListener('popup:progress', handler);
  },
  onAutoClose: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.once('popup:autoclose', (_event, payload) => callback(payload || {}));
  },
  sendAction: (id, action) =>
    ipcRenderer.send('launcher:popup-action', String(id || ''), String(action || 'ok')),
});
