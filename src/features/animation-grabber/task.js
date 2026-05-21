'use strict';

const { parseAssetInput } = require('../../core/assets');
const { ERROR_CATEGORIES, createFailure } = require('../../core/errors');
const { TASK_IDS, TASK_STAGES, createTaskDefinition, createTaskPlan } = require('../../core/tasks');

const ANIMATION_GRABBER_TASK_ID = TASK_IDS.ANIMATION_GRABBER;

function validateAnimationGrabberInput(input = {}) {
  const issues = [];

  if (!input.animationId || !String(input.animationId).trim()) {
    issues.push(
      createFailure({
        category: ERROR_CATEGORIES.INVALID_INPUT,
        stage: 'parse',
        message: 'Paste at least one animation ID or Roblox animation URL.',
        retryable: false,
      }),
    );
  }

  if (input.groupId && !/^\d+$/.test(String(input.groupId).trim())) {
    issues.push(
      createFailure({
        category: ERROR_CATEGORIES.INVALID_INPUT,
        stage: 'preflight',
        message: `Invalid Group ID "${input.groupId}" - use the numeric group ID only.`,
        retryable: false,
      }),
    );
  }

  if (input.downloadOnly && (!input.downloadFolder || !String(input.downloadFolder).trim())) {
    issues.push(
      createFailure({
        category: ERROR_CATEGORIES.INVALID_INPUT,
        stage: 'preflight',
        message: 'Download-Only mode needs a download folder.',
        retryable: false,
      }),
    );
  }

  if (!input.downloadOnly && !input.apiKey) {
    issues.push(
      createFailure({
        category: ERROR_CATEGORIES.BAD_OPEN_CLOUD_KEY,
        stage: 'preflight',
        message: 'Animation uploads require an Open Cloud API key.',
        retryable: false,
      }),
    );
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function planAnimationGrabber(input = {}) {
  const parseResult = parseAssetInput(input.animationId || '', { assetTypeName: 'Animation' });

  return createTaskPlan({
    taskId: ANIMATION_GRABBER_TASK_ID,
    label: 'Animation Grabber',
    assetTypeName: 'Animation',
    itemLabel: 'animation',
    itemLabelPlural: 'animations',
    parseResult,
    total: parseResult.entries.length,
    stages: [
      TASK_STAGES.PARSE,
      TASK_STAGES.PREFLIGHT,
      TASK_STAGES.RESOLVE_METADATA,
      TASK_STAGES.RESOLVE_LOCATION,
      TASK_STAGES.DOWNLOAD,
      TASK_STAGES.UPLOAD,
      TASK_STAGES.REPORT,
      TASK_STAGES.COMPLETE,
    ],
  });
}

const retryPolicy = {
  download: {
    maxAttempts: 3,
    retryableCategories: ['rate_limited', 'roblox_5xx', 'network_failure', 'download_timeout'],
  },
  upload: {
    maxAttempts: 4,
    retryableCategories: ['rate_limited', 'roblox_5xx', 'network_failure'],
  },
};

async function runAnimationGrabberTask(context = {}) {
  if (typeof context.runLegacyFlow !== 'function') {
    throw new Error('Animation grabber task is not wired to a runner yet.');
  }

  return context.runLegacyFlow({
    task: animationGrabberTask,
    input: context.input || {},
    plan: context.plan || planAnimationGrabber(context.input || {}),
  });
}

const animationGrabberTask = createTaskDefinition({
  id: ANIMATION_GRABBER_TASK_ID,
  label: 'Animation Grabber',
  assetTypeName: 'Animation',
  itemLabel: 'animation',
  itemLabelPlural: 'animations',
  validate: validateAnimationGrabberInput,
  plan: planAnimationGrabber,
  run: runAnimationGrabberTask,
  cancel() {},
  retryPolicy,
});

module.exports = {
  ANIMATION_GRABBER_TASK_ID,
  animationGrabberTask,
  planAnimationGrabber,
  validateAnimationGrabberInput,
};
