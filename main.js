// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const keytar = require("keytar");
const fsSync = require('fs');
const fs = require('fs').promises; // Use .promises for async operations
const os = require('os');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const crypto = require('crypto');

// --- Developer Mode Toggle ---
const DEVELOPER_MODE = false;

let mainWindow;

// --- Utility Functions ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000, height: 800, title: "ISpooferMotion",
    icon: path.join(__dirname, 'assets', 'app_icon.ico'),
    frame: false, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    }
  });
  mainWindow.loadFile('index.html');
  // if (DEVELOPER_MODE) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendTransferUpdate(transferData) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('transfer-update', transferData);
  } else {
    if (DEVELOPER_MODE) console.warn("MAIN_PROCESS (Dev): Cannot send transfer update - mainWindow or webContents not available.");
  }
}

function sendSpooferResultToRenderer(result) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('spoofer-result', result);
  } else {
    if (DEVELOPER_MODE) console.warn("MAIN_PROCESS (Dev): Cannot send spoofer result - mainWindow or webContents not available.");
  }
}

// --- Function to clear the downloads directory ---
async function clearDownloadsDirectory(directoryPath) {
    try {
        if (await fs.stat(directoryPath).catch(() => null)) { // Check if directory exists
            if (DEVELOPER_MODE) console.log(`(Dev) Clearing directory: ${directoryPath}`);
            const files = await fs.readdir(directoryPath);
            for (const file of files) {
                await fs.unlink(path.join(directoryPath, file));
            }
            if (DEVELOPER_MODE) console.log(`(Dev) Directory ${directoryPath} cleared successfully.`);
            // Optionally, remove and recreate the directory if you want to be absolutely sure
            // await fs.rm(directoryPath, { recursive: true, force: true });
            // await fs.mkdir(directoryPath, { recursive: true });
            return true;
        } else {
            if (DEVELOPER_MODE) console.log(`(Dev) Directory ${directoryPath} does not exist. No need to clear.`);
            return true; // Still considered success as the state is "empty"
        }
    } catch (err) {
        console.error(`Error clearing directory ${directoryPath}:`, err);
        // Optionally, send an error to the renderer if this is critical
        // sendTransferUpdate({ id: 'system-error', name: 'System', status: 'error', error: `Failed to clear downloads: ${err.message}` });
        return false;
    }
}


async function getCookieFromRobloxStudio() {
  if (!["darwin", "win32"].includes(process.platform)) return undefined;
  if (process.platform === "darwin") {
    try {
      const homePath = os.homedir();
      const cookieFile = path.join(homePath, "Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies");
      const binaryCookieData = await fs.readFile(cookieFile, { encoding: "utf-8" });
      const matchGroups = binaryCookieData.match(
        /_\|WARNING:-DO-NOT-SHARE-THIS\.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\.\|_[A-F\d]+/
      );
      return matchGroups?.[0];
    } catch (err) { if (DEVELOPER_MODE) console.warn("(Dev) Could not read Roblox cookie from binarycookies:", err.message); return undefined; }
  }
  if (process.platform === "win32") {
    try {
      const cookie = await keytar.findPassword("https://www.roblox.com:RobloxStudioAuth.ROBLOSECURITY");
      return cookie || undefined;
    } catch (err) { if (DEVELOPER_MODE) console.warn("(Dev) Could not read Roblox cookie from Windows Credential Manager:", err.message); return undefined; }
  }
  return undefined;
}

async function retryAsync(fn, retries = 3, delayMs = 1000, onRetryAttempt) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (onRetryAttempt) onRetryAttempt(i + 1, retries, err);
      if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
      else {
        const enrichedError = new Error(`After ${retries} attempts: ${err.message}`);
        enrichedError.cause = err; throw enrichedError;
      }
    }
  }
}

async function getCsrfToken(cookie) {
  const csrfUrl = 'https://auth.roblox.com/v2/logout';
  const csrfHeaders = { 'Cookie': `.ROBLOSECURITY=${cookie}`, 'Content-Type': 'application/json' };
  let response;
  try { response = await fetch(csrfUrl, { method: 'POST', headers: csrfHeaders, body: JSON.stringify({}) }); }
  catch (networkError) { console.error("Network error fetching CSRF token:", networkError); throw new Error(`Network error fetching CSRF token: ${networkError.message}`); }
  const token = response.headers.get('x-csrf-token');
  if (!token) {
    let errorDetails = `CSRF token endpoint (${csrfUrl}) returned status ${response.status}.`;
    try { const textBody = await response.text(); errorDetails += ` Body: ${textBody.substring(0, 200)}`; } catch (e) { /* ignore */ }
    throw new Error(`No X-CSRF-TOKEN in response header. ${errorDetails}`);
  }
  return token;
}

// --- Core Download/Upload Functions ---

async function downloadAnimationAssetWithProgress(assetId, robloxCookie, filePath, transferId, entryName) {
  const url = `https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`;
  sendTransferUpdate({ id: transferId, name: entryName, originalAssetId: assetId, status: 'processing', direction: 'download', progress: 0, error: null, size: 0 });
  try {
    const response = await fetch(url, { headers: { Cookie: `.ROBLOSECURITY=${robloxCookie}` }, redirect: 'follow' });
    if (!response.ok) throw new Error(`Failed to download asset ${assetId}: ${response.status} ${response.statusText}`);
    if (!response.body) throw new Error(`No response body for asset ${assetId}`);
    const totalSize = Number(response.headers.get('content-length'));
    sendTransferUpdate({ id: transferId, size: isNaN(totalSize) ? 0 : totalSize });
    const reader = response.body.getReader();
    const fileStream = fsSync.createWriteStream(filePath);
    let receivedLength = 0; let lastReportedProgress = -1;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      fileStream.write(value); receivedLength += value.length;
      if (totalSize > 0) {
        const currentProgress = Math.round((receivedLength / totalSize) * 100);
        if (currentProgress > lastReportedProgress) { sendTransferUpdate({ id: transferId, progress: currentProgress }); lastReportedProgress = currentProgress; }
      }
    }
    fileStream.end();
    await new Promise((resolve, reject) => { fileStream.on('finish', resolve); fileStream.on('error', (err) => reject(new Error(`File stream error: ${err.message}`))); });
    if (lastReportedProgress < 100 && totalSize > 0) sendTransferUpdate({ id: transferId, progress: 100 });
    sendTransferUpdate({ id: transferId, status: 'completed', progress: 100 });
    return { success: true, filePath };
  } catch (error) {
    console.error(`Download error for ${entryName} (ID: ${assetId}):`, error);
    sendTransferUpdate({ id: transferId, status: 'error', error: error.message, progress: lastReportedProgress >= 0 ? lastReportedProgress : 0 });
    return { success: false, error: error.message };
  }
}

async function publishAnimationRbxmWithProgress(filePath, name, cookie, csrfToken, groupId = null, transferId) {
  let fileBuffer;
  let fileSize = 0;
  try {
      fileBuffer = await fs.readFile(filePath);
      fileSize = fileBuffer.length;
  } catch (fileError) {
      sendTransferUpdate({ id: transferId, name, status: 'error', direction: 'upload', error: `File system error: ${fileError.message}` });
      return { success: false, error: `File system error: ${fileError.message}` };
  }

  sendTransferUpdate({
    id: transferId, name, size: fileSize, status: 'processing',
    direction: 'upload', progress: 0, error: null
  });

  const uploadUrl = new URL("https://www.roblox.com/ide/publish/uploadnewanimation");
  uploadUrl.searchParams.set("assetTypeName", "Animation");
  uploadUrl.searchParams.set("name", name);
  uploadUrl.searchParams.set("description", "Uploaded via ISpooferMotion"); //-- Change the description if u want:D This is just a default
  uploadUrl.searchParams.set("AllID", "1");
  uploadUrl.searchParams.set("ispublic", "False");
  uploadUrl.searchParams.set("allowComments", "True");
  uploadUrl.searchParams.set("isGamesAsset", "False");
  if (groupId) uploadUrl.searchParams.set("groupId", groupId);

  const headers = {
    "Content-Type": "application/octet-stream",
    "Cookie": `.ROBLOSECURITY=${cookie}`,
    "X-CSRF-TOKEN": csrfToken,
    "User-Agent": "RobloxStudio/WinInet",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8"
  };

  if (DEVELOPER_MODE) console.log(`[UPLOAD DEBUG - FETCH] Attempting upload for "${name}" to: ${uploadUrl.toString()}`);

  try {
    const response = await fetch(uploadUrl.toString(), {
      method: "POST",
      headers,
      body: fileBuffer
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Upload failed (Status: ${response.status}). Response: ${bodyText.substring(0, 350)}`);
    }
    const newAssetId = bodyText.trim();
    if (newAssetId && /^\d+$/.test(newAssetId)) {
        sendTransferUpdate({ id: transferId, progress: 100, status: 'completed', newAssetId: newAssetId });
        return { success: true, assetId: newAssetId };
    } else {
        throw new Error(`Upload successful (Status ${response.status}) but the response was not a valid Asset ID. Response: "${bodyText.substring(0, 350)}"`);
    }
  } catch (err) {
    const errorMsg = err.message || `Upload failed for "${name}" due to an unknown error.`;
    console.error(`[UPLOAD ERROR - FETCH] ${errorMsg}`, err.cause || err);
    sendTransferUpdate({ id: transferId, status: 'error', error: errorMsg, progress: 0 });
    return { success: false, error: errorMsg };
  }
}

// --- IPC Handlers ---
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.on('run-spoofer-action', async (event, data) => {
  if (DEVELOPER_MODE) console.log("MAIN_PROCESS (Dev): Received 'run-spoofer-action' with data:", data);
  else console.log("MAIN_PROCESS: Received 'run-spoofer-action'.");

  const downloadsDir = path.join(app.getPath('userData'), 'ispoofer_downloads');

  const cleared = await clearDownloadsDirectory(downloadsDir);
  if (!cleared) {
      // Decide how to handle failure to clear: stop, or just warn and continue?
      // For now, just warn if in dev mode, and continue.
      if (DEVELOPER_MODE) console.warn("(Dev) Failed to fully clear downloads directory, proceeding anyway.");
      sendSpooferResultToRenderer({ output: "Warning: Could not fully clear previous downloads.", success: false }); // Optionally inform user
  }

  if (!data.enableSpoofing) {
    sendSpooferResultToRenderer({ output: "Enable Spoofing toggle is OFF.", success: false }); return;
  }
  let robloxCookie = data.robloxCookie;
  if (data.autoDetectCookie) {
    try { robloxCookie = await getCookieFromRobloxStudio(); if (!robloxCookie) throw new Error("Auto-detected cookie empty/not found."); }
    catch (err) { if (DEVELOPER_MODE) console.warn("(Dev) Error auto-detecting cookie:", err); sendSpooferResultToRenderer({ output: `Failed to auto-detect cookie: ${err.message}`, success: false }); return; }
  }
  if (!robloxCookie) { sendSpooferResultToRenderer({ output: "Roblox cookie not provided.", success: false }); return; }

  const animationEntries = (data.animationId || "").split("\n")
    .map(line => {
      const trimmedLine = line.trim(); if (!trimmedLine) return null;
      const parts = trimmedLine.split(" "); const id = parts[0].trim();
      const name = parts.slice(1).join(" ").trim() || `Animation_${id}`;
      return { id, name };
    }).filter(entry => entry && entry.id);

  if (animationEntries.length === 0) { sendSpooferResultToRenderer({ output: "No valid animation entries.", success: false }); return; }

  // Ensure downloads directory exists after potential clearing or if it never existed
  try {
      if (!(await fs.stat(downloadsDir).catch(() => null))) { // Check if directory exists after clear attempts
        await fs.mkdir(downloadsDir, { recursive: true });
        if (DEVELOPER_MODE) console.log("(Dev) Downloads directory created:", downloadsDir);
      }
  } catch (dirError) {
      sendSpooferResultToRenderer({ output: `Failed to ensure downloads directory exists: ${dirError.message}`, success: false });
      return;
  }

  let verboseOutputMessage = `Processing ${animationEntries.length} animation(s)...\n`;
  let successfulUploadCount = 0; let downloadedSuccessfullyCount = 0; let uploadMappingOutput = "";

  const initialTransferStates = [];
  for (const entry of animationEntries) {
      const downloadTransferId = crypto.randomUUID();
      initialTransferStates.push({ id: downloadTransferId, name: entry.name, originalAssetId: entry.id, status: 'queued', direction: 'download', progress: 0, size: 0 });
  }
  initialTransferStates.forEach(state => sendTransferUpdate(state));

  let csrfToken;
  if (animationEntries.length > 0) {
    const csrfTransferId = crypto.randomUUID();
    sendTransferUpdate({id: csrfTransferId, name: "System Task", status: "processing", direction: "system", message: "Fetching CSRF token..."});
    try { csrfToken = await getCsrfToken(robloxCookie); sendTransferUpdate({id: csrfTransferId, status: "completed", message: "CSRF token obtained."}); }
    catch (err) { console.error("Fatal error getting CSRF token:", err); verboseOutputMessage += `✗ CRITICAL: Failed to obtain CSRF token: ${err.message}. Uploads will be skipped.\n`; sendTransferUpdate({id: csrfTransferId, status: "error", error: `CSRF token error: ${err.message}. Uploads aborted.`}); }
  }

  const UPLOAD_RETRIES = parseInt(data.uploadRetries, 10) || 3;
  const UPLOAD_RETRY_DELAY_MS = parseInt(data.uploadRetryDelay, 10) || 5000;

  for (const entry of animationEntries) {
    const downloadTransfer = initialTransferStates.find(t => t.originalAssetId === entry.id && t.direction === 'download');
    const downloadTransferId = downloadTransfer ? downloadTransfer.id : crypto.randomUUID();
    const sanitizedName = entry.name.replace(/[<>:"/\\|?*]/g, '_');
    const fileName = `${sanitizedName}_${entry.id}.rbxm`;
    const filePath = path.join(downloadsDir, fileName);

    verboseOutputMessage += `\n--- Processing: ${entry.name} (ID: ${entry.id}) ---\n`;
    const downloadResult = await downloadAnimationAssetWithProgress(entry.id, robloxCookie, filePath, downloadTransferId, entry.name);

    if (downloadResult.success && downloadResult.filePath) {
      downloadedSuccessfullyCount++;
      verboseOutputMessage += `✓ Downloaded: ${entry.name} (ID: ${entry.id}) to ${downloadResult.filePath}\n`;
      if (csrfToken) {
        const uploadTransferId = crypto.randomUUID();
        const uploadFileSize = (await fs.stat(downloadResult.filePath).catch(()=>({size:0}))).size;
        sendTransferUpdate({ id: uploadTransferId, name: entry.name, originalAssetId: entry.id, status: 'queued', direction: 'upload', progress: 0, size: uploadFileSize });
        const onRetryAttempt = (attempt, maxAttempts, err) => { sendTransferUpdate({ id: uploadTransferId, status: 'processing', message: `Upload attempt ${attempt}/${maxAttempts} for ${entry.name} failed. Retrying...`, error: err.message.substring(0,120) }); };
        const uploadFn = () => publishAnimationRbxmWithProgress(downloadResult.filePath, entry.name, robloxCookie, csrfToken, data.groupId, uploadTransferId);
        try {
            const uploadResult = await retryAsync(uploadFn, UPLOAD_RETRIES, UPLOAD_RETRY_DELAY_MS, onRetryAttempt);
            if (uploadResult.success && uploadResult.assetId) {
                successfulUploadCount++;
                uploadMappingOutput += `${entry.id} = ${uploadResult.assetId},\n`;
                verboseOutputMessage += `✓ Uploaded: ${entry.name} (Old ID: ${entry.id}) -> New ID: ${uploadResult.assetId}\n`;
            }
            else { verboseOutputMessage += `✗ Final Upload Failed for ${entry.name} (ID: ${entry.id}): ${uploadResult.error || 'Unknown upload error'}\n`; }
        } catch (finalRetryError) { verboseOutputMessage += `✗ Final Upload Failed (retries) for ${entry.name} (ID: ${entry.id}): ${finalRetryError.message}\n`; sendTransferUpdate({id: uploadTransferId, status: 'error', error: `All upload attempts failed: ${finalRetryError.message}`}); }
      } else {
        verboseOutputMessage += `! Skipped Upload for ${entry.name}: CSRF token not available.\n`;
        const skippedUploadId = crypto.randomUUID(); sendTransferUpdate({ id: skippedUploadId, name: entry.name, originalAssetId: entry.id, status: 'skipped', direction: 'upload', message: 'CSRF token missing', error: 'CSRF token was not obtained' });
      }
    } else { verboseOutputMessage += `✗ Download Failed: ${entry.name} (ID: ${entry.id}) — ${downloadResult.error || 'Unknown download error'}\n`; }
  }

  if (uploadMappingOutput.trim()) {
    verboseOutputMessage += "\n--- Upload Mappings (OldID = NewID) ---\n" + uploadMappingOutput.trim().replace(/,$/, '');
  } else {
    const attemptedUploads = animationEntries.filter(entry => initialTransferStates.find(t => t.originalAssetId === entry.id && t.direction === 'download' && t.status === 'completed') ).length > 0;
    if (attemptedUploads && csrfToken) verboseOutputMessage += "\nNo animations were successfully uploaded.\n";
    else if (attemptedUploads && !csrfToken) verboseOutputMessage += "\nUploads skipped due to missing CSRF token.\n"
  }
  verboseOutputMessage += `\n--- Summary ---\nDownloads: ${downloadedSuccessfullyCount}/${animationEntries.length} successful.\nUploads: ${successfulUploadCount}/${downloadedSuccessfullyCount} successful (among successfully downloaded).`;

  if (DEVELOPER_MODE) {
    console.log("MAIN_PROCESS (Dev Mode): Sending full verbose output to renderer.");
    sendSpooferResultToRenderer({ output: verboseOutputMessage, success: downloadedSuccessfullyCount > 0 || successfulUploadCount > 0 });
  } else {
    let conciseOutput = "";
    if (uploadMappingOutput.trim()) {
      conciseOutput = "--- Upload Mappings (OldID = NewID) ---\n" + uploadMappingOutput.trim().replace(/,$/, '');
    } else {
      if (downloadedSuccessfullyCount > 0 && csrfToken && successfulUploadCount === 0) {
        conciseOutput = "Downloads successful, but no animations were successfully uploaded.";
      } else if (downloadedSuccessfullyCount > 0 && !csrfToken) {
        conciseOutput = "Downloads successful. Uploads skipped (CSRF token missing).";
      } else if (animationEntries.length > 0) {
        conciseOutput = "No animations were successfully processed to provide mappings.";
      } else {
        conciseOutput = "No operations performed.";
      }
    }
    if (DEVELOPER_MODE) console.log("MAIN_PROCESS: Sending concise output to renderer.");
    else console.log("MAIN_PROCESS: Sending concise output to renderer: ", conciseOutput.substring(0, 100) + "...");
    sendSpooferResultToRenderer({ output: conciseOutput, success: downloadedSuccessfullyCount > 0 || successfulUploadCount > 0 });
  }
});

// --- Electron App Lifecycle ---
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });