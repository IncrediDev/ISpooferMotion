async function readAssetHistory(fs, filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAssetHistory(fs, filePath, history, onError) {
  try {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(history || {}, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (err) {
    if (typeof onError === 'function') onError(err);
  }
}

function buildHistoryKey(assetTypeName, targetKey, originalId) {
  return `${assetTypeName || 'Asset'}:${targetKey || 'default'}:${String(originalId)}`;
}

function rememberAssetMappingInObject(
  history,
  { assetTypeName, targetKey, originalId, newId, name } = {},
) {
  if (!history || typeof history !== 'object' || !originalId || !newId) return history || {};
  history[buildHistoryKey(assetTypeName, targetKey, originalId)] = {
    originalId: String(originalId),
    newId: String(newId),
    name: name || '',
    assetType: assetTypeName || 'Asset',
    target: targetKey || 'default',
    savedAt: new Date().toISOString(),
  };
  return history;
}

async function rememberAssetMapping({
  fs,
  filePath,
  assetTypeName,
  targetKey,
  originalId,
  newId,
  name,
  onError,
}) {
  if (!originalId || !newId) return;
  const history = await readAssetHistory(fs, filePath);
  rememberAssetMappingInObject(history, { assetTypeName, targetKey, originalId, newId, name });
  await writeAssetHistory(fs, filePath, history, onError);
}

async function clearAssetHistory(fs, filePath) {
  await fs.unlink(filePath).catch(() => {});
}

function assetHistoryToRows(history) {
  return Object.values(history || {})
    .filter(Boolean)
    .map((item) => ({
      originalId: String(item.originalId || ''),
      newId: String(item.newId || ''),
      name: item.name || '',
      assetType: item.assetType || 'Asset',
      target: item.target || 'default',
      savedAt: item.savedAt || '',
    }))
    .filter((row) => row.originalId && row.newId);
}

module.exports = {
  assetHistoryToRows,
  buildHistoryKey,
  clearAssetHistory,
  readAssetHistory,
  rememberAssetMapping,
  rememberAssetMappingInObject,
  writeAssetHistory,
};
