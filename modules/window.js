// modules/window.js
const { BrowserWindow, app } = require('electron');
const path = require('path');

let mainWindow;

/**
 * Creates the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    title: 'ISpooferMotion',
    icon: path.join(__dirname, '..', 'assets', 'app_icon.ico'),
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Gets the main window instance
 */
function getMainWindow() {
  return mainWindow;
}

/**
 * Sets up application lifecycle handlers
 */
function setupAppLifecycle() {
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = {
  createWindow,
  getMainWindow,
  setupAppLifecycle,
};
