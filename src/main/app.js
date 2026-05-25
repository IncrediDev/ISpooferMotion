const path = require('node:path');
const { app } = require('electron');
const { setupAppLifecycle, getMainWindow } = require('./window');
const { registerIpcHandlers } = require('./services/ipc-handlers');
const { DEVELOPER_MODE, initializeFileLogging } = require('./services/common');
const { checkForUpdates } = require('./services/updater');

function getLogsDir() {
  return path.join(app.getPath('userData'), 'ispoofer_logs');
}

function getLiveWebContents() {
  const win = getMainWindow();
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return null;
  return win.webContents;
}

function sendToRenderer(channel, payload) {
  const webContents = getLiveWebContents();
  if (webContents) {
    webContents.send(channel, payload);
    return true;
  }

  if (DEVELOPER_MODE) {
    console.warn(`[MAIN_PROCESS] Cannot send "${channel}"; renderer is not ready.`);
  }

  return false;
}

function sendTransferUpdate(transferData) {
  return sendToRenderer('transfer-update', transferData);
}

function sendSpooferResultToRenderer(result) {
  return sendToRenderer('spoofer-result', result);
}

function sendStatusMessage(message) {
  return sendToRenderer('update-status-message', message);
}

function sendSpooferLog(logData) {
  return sendToRenderer('spoofer-log', logData);
}

function sendSpooferProgress(progressData) {
  return sendToRenderer('spoofer-progress', progressData);
}

function bootstrap() {
  app.name = 'ISpooferMotion';
  if (app.isPackaged) {
    app.setAppUserModelId('com.github.IncrediDev.ISpooferMotion');
  }
  initializeFileLogging(getLogsDir());
  registerIpcHandlers(
    getMainWindow,
    sendTransferUpdate,
    sendSpooferResultToRenderer,
    sendStatusMessage,
    sendSpooferLog,
    sendSpooferProgress,
  );
  return setupAppLifecycle().then(() => {
    checkForUpdates().catch((err) => console.error('Updater error:', err));
  });
}

bootstrap().catch((error) => {
  console.error('[APP ERROR] Failed to start ISpooferMotion:', error);
  app.quit();
});
