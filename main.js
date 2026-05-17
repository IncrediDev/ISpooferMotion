'use strict';

const { app } = require('electron');
const { setupAppLifecycle, getMainWindow } = require('./modules/window');
const { registerIpcHandlers } = require('./modules/utils/ipc-handlers');

function sendToRenderer(channel, payload) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send(channel, payload);
}

function sendStatusMessage(message) {
  sendToRenderer('update-status-message', message);
}

function sendTransferUpdate(payload) {
  sendToRenderer('transfer-update', payload);
}

function sendSpooferResultToRenderer(result) {
  sendToRenderer('spoofer-result', result);
}

registerIpcHandlers(
  getMainWindow,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage
);

setupAppLifecycle();

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  sendStatusMessage(err && err.message ? err.message : String(err));
});

process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err);
  sendStatusMessage(err && err.message ? err.message : String(err));
});
