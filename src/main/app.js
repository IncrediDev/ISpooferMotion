const { app } = require('electron');
const path = require('path');

/*
 * We override the default TLS ciphers used by Node.js to match the cryptographic
 * fingerprint of Chrome/WinInet (the networking stack used by Roblox Studio).
 * This prevents Cloudflare/Akamai from detecting that this is a Node.js script
 * purely by inspecting the TLS Client Hello handshake (JA3 fingerprinting).
 */
const tls = require('tls');
tls.DEFAULT_CIPHERS =
  'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA';
tls.DEFAULT_MIN_VERSION = 'TLSv1.2';
tls.DEFAULT_MAX_VERSION = 'TLSv1.3';
const { setupAppLifecycle, getMainWindow } = require('./window');
const { registerIpcHandlers } = require('./services/ipc-handlers');
const { DEVELOPER_MODE, initializeFileLogging } = require('./services/common');

if (process.argv.includes('--smoke-test')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-http-cache');
}
app.setName('ISpooferMotion');
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'ISpooferMotion'));
} catch {}

const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
initializeFileLogging(logsDir);

const notifyOriginalWarn = console.warn.bind(console);
const notifyOriginalError = console.error.bind(console);

function safeSend(channel, payload) {
  const win = getMainWindow();
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    if (DEVELOPER_MODE && channel !== 'app-notification')
      notifyOriginalWarn(`MAIN_PROCESS (Dev): Cannot send ${channel} - window is not ready.`);
    return;
  }

  try {
    win.webContents.send(channel, payload);
  } catch (err) {
    if (DEVELOPER_MODE && channel !== 'app-notification')
      notifyOriginalWarn(`MAIN_PROCESS (Dev): Failed to send ${channel}:`, err.message);
  }
}

function sendTransferUpdate(transferData) {
  safeSend('transfer-update', transferData);
}

function sendAppNotification(type, message) {
  if (!message) return;
  const text = String(message);
  if (/folder selection (canceled|cancelled)/i.test(text)) return;
  safeSend('app-notification', { type, message: text });
}

function getNoticeTypeFromStatus(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  if (/^\d+\s*\/\s*\d+/.test(text) || /\bETA\b/i.test(text)) return null;
  if (
    /\b(error|failed|failure|invalid|blocked|denied|timed out|timeout|crash|unexpected)\b/i.test(
      text,
    )
  ) {
    return 'error';
  }
  if (/\b(warn|warning|canceled|cancelled|retry|paused|missing|skipped)\b/i.test(text)) {
    return 'warning';
  }
  if (
    /\b(complete|completed|success|successful|ready|opened|exported|copied|cleared|refreshed|selected|saved|loaded|started|starting)\b/i.test(
      text,
    )
  ) {
    return 'success';
  }
  if (/\b(preflight|running|resuming|canceling|download-only|using saved|reused)\b/i.test(text)) {
    return 'status';
  }
  return null;
}

function getResultFailureMessage(result) {
  if (!result || result.success !== false) return '';
  const failure = result.summary && result.summary.failures && result.summary.failures[0];
  return (failure && failure.reason) || result.output || 'Run failed. Check Run Report.';
}

function sendSpooferResultToRenderer(result) {
  safeSend('spoofer-result', result);
  const failureMessage = getResultFailureMessage(result);
  if (failureMessage) sendAppNotification('error', failureMessage);
}

function sendStatusMessage(message) {
  safeSend('update-status-message', message);
  const type = getNoticeTypeFromStatus(message);
  if (type) sendAppNotification(type, message);
}

console.warn = (...args) => {
  notifyOriginalWarn(...args);
  sendAppNotification(
    'warning',
    args.map((arg) => String(arg && arg.message ? arg.message : arg)).join(' '),
  );
};
console.error = (...args) => {
  notifyOriginalError(...args);
  sendAppNotification(
    'error',
    args.map((arg) => String(arg && arg.message ? arg.message : arg)).join(' '),
  );
};
registerIpcHandlers(
  getMainWindow,
  sendTransferUpdate,
  sendSpooferResultToRenderer,
  sendStatusMessage,
);

setupAppLifecycle();
