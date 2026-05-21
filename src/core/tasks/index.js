'use strict';

const TASK_STATUSES = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  CANCELED: 'canceled',
  COMPLETE: 'complete',
});

const TASK_STAGES = Object.freeze({
  PARSE: 'parse',
  PREFLIGHT: 'preflight',
  RESOLVE_METADATA: 'resolve_metadata',
  RESOLVE_LOCATION: 'resolve_location',
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
  SCAN: 'scan',
  REPLACE: 'replace',
  INSTALL: 'install',
  EXTRACT: 'extract',
  CLEANUP: 'cleanup',
  REPORT: 'report',
  COMPLETE: 'complete',
});

const TASK_IDS = Object.freeze({
  ANIMATION_GRABBER: 'animation-grabber',
  SOUND_GRABBER: 'sound-grabber',
  ASSET_REPLACEMENT: 'asset-replacement',
  PLUGIN_INSTALL: 'plugin-install',
  APP_UPDATE: 'app-update',
  LAUNCHER_UPDATE: 'launcher-update',
  SUPPORT_EXPORT: 'support-export',
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeProgress(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

function createProgressEvent(input = {}) {
  const status = input.status || TASK_STATUSES.RUNNING;
  return {
    taskId: input.taskId || input.id || 'task',
    itemId: input.itemId === undefined || input.itemId === null ? null : String(input.itemId),
    stage: input.stage || TASK_STAGES.COMPLETE,
    status,
    progress: normalizeProgress(input.progress, null),
    message: input.message || '',
    error: input.error || null,
    retryable: Boolean(input.retryable),
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    timestamp: input.timestamp || nowIso(),
  };
}

function createTaskPlan(input = {}) {
  const total = Number.isFinite(Number(input.total)) ? Math.max(0, Number(input.total)) : 0;
  return {
    taskId: input.taskId || input.id || 'task',
    label: input.label || 'Task',
    assetTypeName: input.assetTypeName || null,
    itemLabel: input.itemLabel || 'item',
    itemLabelPlural: input.itemLabelPlural || `${input.itemLabel || 'item'}s`,
    total,
    stages: Array.isArray(input.stages) ? input.stages.slice() : [],
    parseResult: input.parseResult || null,
    preflight: input.preflight || null,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
  };
}

function createTaskDefinition(definition = {}) {
  if (!definition.id) throw new Error('Task definition requires an id.');
  if (!definition.label) throw new Error(`Task ${definition.id} requires a label.`);
  return {
    id: definition.id,
    label: definition.label,
    assetTypeName: definition.assetTypeName || null,
    itemLabel: definition.itemLabel || 'item',
    itemLabelPlural: definition.itemLabelPlural || `${definition.itemLabel || 'item'}s`,
    validate:
      typeof definition.validate === 'function'
        ? definition.validate
        : () => ({ ok: true, issues: [] }),
    plan:
      typeof definition.plan === 'function'
        ? definition.plan
        : () => createTaskPlan({ taskId: definition.id, label: definition.label }),
    run:
      typeof definition.run === 'function'
        ? definition.run
        : async () => {
            throw new Error(`Task ${definition.id} is not wired to a runner yet.`);
          },
    cancel: typeof definition.cancel === 'function' ? definition.cancel : () => {},
    retryPolicy: definition.retryPolicy || {},
  };
}

async function runTask(task, context = {}) {
  if (!task || typeof task.run !== 'function')
    throw new Error('runTask requires a task with a run() function.');
  const input = context.input || {};
  const validation =
    typeof task.validate === 'function' ? task.validate(input) : { ok: true, issues: [] };
  if (validation && validation.ok === false) {
    return {
      success: false,
      taskId: task.id,
      validation,
      errors: validation.issues || [],
    };
  }
  const plan =
    context.plan ||
    (typeof task.plan === 'function'
      ? task.plan(input)
      : createTaskPlan({ taskId: task.id, label: task.label }));
  return task.run({ ...context, input, plan, validation });
}

module.exports = {
  TASK_IDS,
  TASK_STAGES,
  TASK_STATUSES,
  createProgressEvent,
  createTaskDefinition,
  createTaskPlan,
  runTask,
};
