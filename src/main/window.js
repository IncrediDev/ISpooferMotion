const { BrowserWindow, app, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
const IS_DEV = process.argv.includes('--dev');
const IS_SMOKE_TEST = process.argv.includes('--smoke-test');
function createWindow() {
  const pngIcon = path.join(__dirname, '..', 'assets', 'app_icon.png');
  const icoIcon = path.join(__dirname, '..', 'assets', 'app_icon.ico');
  const iconImage = nativeImage.createFromPath(
    process.platform === 'win32' && !IS_DEV ? icoIcon : pngIcon,
  );
  const iconPath = iconImage.isEmpty() ? pngIcon : iconImage;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1260,
    minHeight: 740,
    title: 'ISpooferMotion',
    icon: iconPath,
    frame: false,
    resizable: true,
    show: !IS_SMOKE_TEST,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.once('did-finish-load', async () => {
    if (IS_SMOKE_TEST) {
      try {
        const ready = await mainWindow.webContents.executeJavaScript(
          'Boolean(window.electronAPI && document.querySelector(\'[data-view="spoofer"]\') && document.querySelector(\'[data-view="profiles"]\') && document.querySelector(\'[data-view="settings"]\'))',
        );
        if (!ready) throw new Error('Renderer did not expose the expected shell controls.');
        console.log('ELECTRON_SMOKE_OK');
        app.quit();
      } catch (err) {
        console.error('ELECTRON_SMOKE_FAILED:', err && err.message ? err.message : err);
        app.exit(1);
      }
      return;
    }
    if (IS_DEV) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });
  mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    if (!IS_SMOKE_TEST) return;
    console.error(`ELECTRON_SMOKE_FAILED: ${errorCode} ${errorDescription}`);
    app.exit(1);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
function getMainWindow() {
  return mainWindow;
}
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
