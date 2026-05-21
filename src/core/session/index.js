async function saveJsonFile(fs, filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, JSON.stringify(value || {}), 'utf8');
  await fs.rename(tempPath, filePath);
}

function createSessionStore({ fs, sessionPath, onError } = {}) {
  if (!fs) throw new Error('createSessionStore requires fs');
  if (!sessionPath) throw new Error('createSessionStore requires sessionPath');

  return {
    path: sessionPath,
    async save(session) {
      try {
        await saveJsonFile(fs, sessionPath, session || {});
      } catch (err) {
        if (typeof onError === 'function') onError(err, 'save');
      }
    },
    async load() {
      try {
        const parsed = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (err) {
        if (typeof onError === 'function' && err && err.code !== 'ENOENT') onError(err, 'load');
        return null;
      }
    },
    async clear() {
      try {
        await fs.unlink(sessionPath);
      } catch (err) {
        if (typeof onError === 'function' && err && err.code !== 'ENOENT') onError(err, 'clear');
      }
    },
  };
}

function createBufferedSessionSaver({ save, minIntervalMs = 2000, maxPending = 10 } = {}) {
  if (typeof save !== 'function')
    throw new Error('createBufferedSessionSaver requires a save function');

  let pendingCount = 0;
  let lastSavedAt = 0;
  let timer = null;
  let lastValue = null;
  let inFlight = Promise.resolve();

  const clearSaveTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const runSave = async (value) => {
    clearSaveTimer();
    pendingCount = 0;
    lastValue = value || lastValue;
    const snapshot = lastValue;
    inFlight = inFlight
      .catch(() => {})
      .then(async () => {
        await save(snapshot);
        lastSavedAt = Date.now();
      });
    return inFlight;
  };

  const scheduleSave = (value) => {
    lastValue = value || lastValue;
    if (timer) return;
    const waitMs = Math.max(250, Number(minIntervalMs) || 2000);
    timer = setTimeout(() => {
      timer = null;
      runSave(lastValue).catch(() => {});
    }, waitMs);
  };

  return {
    async save(value, options = {}) {
      lastValue = value || lastValue;
      if (options.force === true) return runSave(lastValue);

      pendingCount += 1;
      const now = Date.now();
      const minInterval = Math.max(250, Number(minIntervalMs) || 2000);
      const maxWrites = Math.max(1, Number(maxPending) || 10);

      if (pendingCount >= maxWrites || now - lastSavedAt >= minInterval) {
        return runSave(lastValue);
      }

      scheduleSave(lastValue);
      return inFlight;
    },

    async flush(value = lastValue) {
      if (!value) return inFlight;
      return runSave(value);
    },

    async settle() {
      return inFlight;
    },

    cancel() {
      clearSaveTimer();
      pendingCount = 0;
      lastValue = null;
    },
  };
}

module.exports = {
  createBufferedSessionSaver,
  createSessionStore,
  saveJsonFile,
};
