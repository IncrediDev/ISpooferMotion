const path = require('path');
const {
  countRetryableFailures,
  redactLocalPath,
  sanitizeSupportValue,
  summarizeFailureCategories,
} = require('../logging');

function getRequiredDeps(deps = {}) {
  const missing = [];
  for (const key of [
    'app',
    'fs',
    'sanitizeLogMessage',
    'readTextFileTail',
    'getLatestLogFilePath',
  ]) {
    if (!deps[key]) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`Missing report dependency/dependencies: ${missing.join(', ')}`);
  }
  return deps;
}

async function getLauncherVersion(deps) {
  const { app, fs } = deps;
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'launcher', 'package.json'),
    path.join(app.getAppPath(), 'launcher', 'package.json'),
  ];

  for (const filePath of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (parsed && parsed.version) return parsed.version;
    } catch {}
  }

  return 'unknown';
}

async function getReleaseSourceLabel(deps) {
  const { app, fs } = deps;
  try {
    const filePath = path.join(app.getPath('userData'), 'release-source.json');
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return {
      id: parsed.sourceId || parsed.id || 'official',
      label: parsed.label || parsed.sourceId || 'Official',
      repo: parsed.repo || 'unknown repo',
    };
  } catch {
    return { id: 'official', label: 'Official', repo: 'IncrediDev/ISpooferMotion' };
  }
}

async function buildAppDebugInfo(context = {}, deps = {}) {
  if (!deps.app || !deps.fs) throw new Error('Missing report dependency/dependencies: app, fs');
  const { app, fs } = deps;
  const source = await getReleaseSourceLabel({ app, fs });
  const assetCount = Number(context.assetCount || 0);

  return [
    'ISpooferMotion App Debug Info',
    `Generated: ${new Date().toISOString()}`,
    `App version: ${app.getVersion()}`,
    `Release source: ${source.label} (${source.repo})`,
    `Mode: ${context.mode || 'unknown'}`,
    `Asset count: ${Number.isFinite(assetCount) ? assetCount : 0}`,
    `Failure categories: ${summarizeFailureCategories(context.report)}`,
    `User data: ${app.getPath('userData')}`,
    `Platform: ${process.platform} ${process.arch}`,
    '',
    'Last status:',
    String(context.lastStatus || 'none'),
    '',
    'Run report:',
    typeof context.report === 'string'
      ? context.report.slice(0, 8000)
      : JSON.stringify(context.report || {}, null, 2).slice(0, 8000),
  ].join('\n');
}

async function buildSupportReport(context = {}, deps = {}) {
  const {
    app,
    fs,
    sanitizeLogMessage,
    getCurrentLogFilePath,
    getLatestLogFilePath,
    readTextFileTail,
    developerMode = false,
  } = getRequiredDeps(deps);

  const sanitizeOptions = {
    homePath: app.getPath('home'),
    sanitizeMessage: sanitizeLogMessage,
  };

  const summary = context.summary && typeof context.summary === 'object' ? context.summary : {};
  const failures = Array.isArray(summary.failures) ? summary.failures : [];
  const retryCounts = countRetryableFailures(failures);
  const logsDir = path.join(app.getPath('userData'), 'ispoofer_logs');
  const logFilePath =
    (typeof getCurrentLogFilePath === 'function' ? getCurrentLogFilePath() : null) ||
    (await getLatestLogFilePath(logsDir));
  const recentLogExcerpt = await readTextFileTail(logFilePath, 24000);
  const releaseSource = await getReleaseSourceLabel({ app, fs });

  const report = {
    reportType: 'ISpooferMotion support report',
    generatedAt: new Date().toISOString(),
    versions: {
      app: app.getVersion(),
      launcher: await getLauncherVersion({ app, fs }),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      devMode: developerMode,
      packaged: app.isPackaged,
      releaseSource,
    },
    run: {
      mode: summary.mode || context.mode || 'unknown',
      assetType: context.assetType || (context.spoofSounds ? 'sound' : 'animation'),
      lastStatus: context.lastStatus || '',
      startedAt: summary.startedAt || null,
      finishedAt: summary.finishedAt || null,
      durationSeconds: summary.durationSeconds || 0,
      counts: {
        total: summary.total || context.assetCount || 0,
        downloaded: summary.downloaded || 0,
        uploaded: summary.uploaded || 0,
        cached: summary.cached || 0,
        skipped: summary.skippedUploads || 0,
        downloadFailures: summary.downloadFailures || 0,
        uploadFailures: summary.uploadFailures || 0,
        retryableFailures: retryCounts.retryable,
        permanentFailures: retryCounts.permanent,
      },
      failureCategories: summary.failureCategories || {},
      failures: failures.map((failure) => ({
        id: failure.id || '',
        name: failure.name || '',
        creator: failure.creator || '',
        stage: failure.stage || '',
        category: failure.category || '',
        label: failure.label || '',
        reason: failure.reason || '',
        retryable: failure.retryable === true,
        suggestedFix: failure.suggestedFix || '',
      })),
      stageFailures: Array.isArray(summary.stageFailures) ? summary.stageFailures : [],
      failedRetryInputPreview: context.failedRetryInputPreview || '',
    },
    settings: sanitizeSupportValue(context.settings || {}, sanitizeOptions),
    queue: sanitizeSupportValue(context.queue || {}, sanitizeOptions),
    paths: {
      userData: redactLocalPath(app.getPath('userData'), sanitizeOptions),
      logsFolder: redactLocalPath(logsDir, sanitizeOptions),
      latestLogFile: redactLocalPath(logFilePath || '', sanitizeOptions),
    },
    recentLogExcerpt: recentLogExcerpt || 'No recent log text found.',
  };

  return sanitizeSupportValue(report, sanitizeOptions);
}

function formatSupportReportText(report = {}) {
  const lines = [];
  const versions = report.versions || {};
  const env = report.environment || {};
  const run = report.run || {};
  const counts = run.counts || {};
  const paths = report.paths || {};

  lines.push('ISpooferMotion Support Report');
  lines.push(`Generated: ${report.generatedAt || new Date().toISOString()}`);
  lines.push('');
  lines.push('Versions');
  lines.push(`- App: ${versions.app || 'unknown'}`);
  lines.push(`- Launcher: ${versions.launcher || 'unknown'}`);
  lines.push(`- Electron: ${versions.electron || 'unknown'}`);
  lines.push(`- Node: ${versions.node || 'unknown'}`);
  lines.push(`- Chrome: ${versions.chrome || 'unknown'}`);
  lines.push('');
  lines.push('Environment');
  lines.push(`- Platform: ${env.platform || process.platform} ${env.arch || process.arch}`);
  lines.push(`- Packaged: ${String(env.packaged)}`);
  lines.push(`- Developer mode: ${String(env.devMode)}`);
  lines.push(
    `- Release source: ${env.releaseSource?.label || 'unknown'} (${env.releaseSource?.repo || 'unknown'})`,
  );
  lines.push('');
  lines.push('Run');
  lines.push(`- Mode: ${run.mode || 'unknown'}`);
  lines.push(`- Asset type: ${run.assetType || 'unknown'}`);
  lines.push(`- Last status: ${run.lastStatus || 'none'}`);
  lines.push(`- Started: ${run.startedAt || 'unknown'}`);
  lines.push(`- Finished: ${run.finishedAt || 'unknown'}`);
  lines.push(`- Duration seconds: ${run.durationSeconds || 0}`);
  lines.push(`- Total: ${counts.total || 0}`);
  lines.push(`- Downloaded: ${counts.downloaded || 0}`);
  lines.push(`- Uploaded: ${counts.uploaded || 0}`);
  lines.push(`- Cached: ${counts.cached || 0}`);
  lines.push(`- Skipped: ${counts.skipped || 0}`);
  lines.push(`- Download failures: ${counts.downloadFailures || 0}`);
  lines.push(`- Upload failures: ${counts.uploadFailures || 0}`);
  lines.push(`- Retryable failures: ${counts.retryableFailures || 0}`);
  lines.push(`- Permanent failures: ${counts.permanentFailures || 0}`);
  lines.push('');
  lines.push('Failure Categories');
  const categories = Object.entries(run.failureCategories || {});
  if (categories.length)
    categories.forEach(([category, count]) => lines.push(`- ${category}: ${count}`));
  else lines.push('- none');
  lines.push('');
  lines.push('Failures');
  const failures = Array.isArray(run.failures) ? run.failures : [];
  if (failures.length) {
    failures.forEach((failure, index) => {
      lines.push(`${index + 1}. ${failure.name || failure.id || 'Unknown asset'}`);
      lines.push(`   ID: ${failure.id || 'unknown'}`);
      lines.push(`   Creator: ${failure.creator || 'unknown'}`);
      lines.push(`   Stage: ${failure.stage || 'unknown'}`);
      lines.push(`   Category: ${failure.category || 'unknown'}`);
      lines.push(`   Reason: ${failure.reason || 'unknown'}`);
      lines.push(`   Retryable: ${failure.retryable ? 'yes' : 'no'}`);
      if (failure.suggestedFix) lines.push(`   Suggested fix: ${failure.suggestedFix}`);
    });
  } else {
    lines.push('- none');
  }
  lines.push('');
  lines.push('Retry Input Preview');
  lines.push(run.failedRetryInputPreview || 'none');
  lines.push('');
  lines.push('Settings Snapshot');
  lines.push(JSON.stringify(report.settings || {}, null, 2));
  lines.push('');
  lines.push('Queue Snapshot');
  lines.push(JSON.stringify(report.queue || {}, null, 2));
  lines.push('');
  lines.push('Paths');
  lines.push(`- User data: ${paths.userData || 'unknown'}`);
  lines.push(`- Logs folder: ${paths.logsFolder || 'unknown'}`);
  lines.push(`- Latest log file: ${paths.latestLogFile || 'unknown'}`);
  lines.push('');
  lines.push('Recent Log Excerpt');
  lines.push(report.recentLogExcerpt || 'No recent log text found.');
  lines.push('');
  lines.push('Raw Structured Report');
  lines.push(JSON.stringify(report, null, 2));
  return lines.join('\n');
}

module.exports = {
  buildAppDebugInfo,
  buildSupportReport,
  formatSupportReportText,
  countRetryableFailures,
  getLauncherVersion,
  getReleaseSourceLabel,
  redactLocalPath,
  sanitizeSupportValue,
  summarizeFailureCategories,
};
