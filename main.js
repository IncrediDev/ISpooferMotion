// main.js
const { app } = require('electron');
const path = require('path');
const { setupAppLifecycle, getMainWindow } = require('./modules/window');
const { registerIpcHandlers } = require('./modules/utils/ipc-handlers');
const { DEVELOPER_MODE, initializeFileLogging } = require('./modules/utils/common');

// Initialize file logging
const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
initializeFileLogging(logsDir);

// Setup window and app lifecycle
setupAppLifecycle();
const mainWindow = getMainWindow();

// --- IPC Message Senders ---
function sendTransferUpdate(transferData) {
  const win = getMainWindow();
  if (win && win.webContents) {
    win.webContents.send('transfer-update', transferData);
  } else {
    if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): Cannot send transfer update - mainWindow or webContents not available.');
  }
}

function sendSpooferResultToRenderer(result) {
  const win = getMainWindow();
  if (win && win.webContents) {
    win.webContents.send('spoofer-result', result);
  } else {
    if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): Cannot send spoofer result - mainWindow or webContents not available.');
  }
}

function sendStatusMessage(message) {
  const win = getMainWindow();
  if (win && win.webContents) {
    win.webContents.send('update-status-message', message);
  } else {
    if (DEVELOPER_MODE) console.warn('MAIN_PROCESS (Dev): Cannot send status message - mainWindow or webContents not available.');
  }
}

// Register all IPC handlers
registerIpcHandlers(getMainWindow, sendTransferUpdate, sendSpooferResultToRenderer, sendStatusMessage);

