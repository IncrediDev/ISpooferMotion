'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app } = require('electron');
const { DEVELOPER_MODE } = require('./common');

function getSessionPath() {
  return path.join(app.getPath('userData'), 'ispoofer_session.json');
}

async function saveSession(session) {
  try {
    await fs.writeFile(getSessionPath(), JSON.stringify(session, null, 2), 'utf8');
  } catch (err) {
    if (DEVELOPER_MODE) console.warn('(Dev) Failed to save session:', err);
  }
}

async function loadSession() {
  try {
    return JSON.parse(await fs.readFile(getSessionPath(), 'utf8'));
  } catch {
    return null;
  }
}

async function clearSession() {
  await fs.rm(getSessionPath(), { force: true }).catch(() => {});
}

module.exports = {
  getSessionPath,
  saveSession,
  loadSession,
  clearSession,
};
