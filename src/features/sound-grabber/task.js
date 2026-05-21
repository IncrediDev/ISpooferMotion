'use strict';

const { parseAssetInput } = require('../../core/assets');
const { ERROR_CATEGORIES, createFailure } = require('../../core/errors');
const { TASK_IDS, TASK_STAGES, createTaskDefinition, createTaskPlan } = require('../../core/tasks');

const SOUND_GRABBER_TASK_ID = TASK_IDS.SOUND_GRABBER;

function validateSoundGrabberInput(input = {}) {
  const issues = [];

  if (!input.animationId || !String(input.animationId).trim()) {
    issues.push(
      createFailure({
        category: ERROR_CATEGORIES.INVALID_INPUT,
        stage: 'parse',
        message: 'Paste at least one sound ID or Roblox audio URL.',
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
        message: 'Sound uploads require an Open Cloud API key.',
        retryable: false,
      }),
    );
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function planSoundGrabber(input = {}) {
  const parseResult = parseAssetInput(input.animationId || '', { assetTypeName: 'Audio' });

  return createTaskPlan({
    taskId: SOUND_GRABBER_TASK_ID,
    label: 'Sound Grabber',
    assetTypeName: 'Audio',
    itemLabel: 'sound',
    itemLabelPlural: 'sounds',
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
    preflight: {
      checkAudioQuota: input.downloadOnly !== true,
    },
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
  preflight: {
    hardFailures: ['bad_cookie', 'bad_open_cloud_key', 'upload_permission', 'upload_quota'],
  },
};

async function runSoundGrabberTask(context = {}) {
  if (typeof context.runLegacyFlow !== 'function') {
    throw new Error('Sound grabber task is not wired to a runner yet.');
  }

  return context.runLegacyFlow({
    task: soundGrabberTask,
    input: context.input || {},
    plan: context.plan || planSoundGrabber(context.input || {}),
  });
}

const soundGrabberTask = createTaskDefinition({
  id: SOUND_GRABBER_TASK_ID,
  label: 'Sound Grabber',
  assetTypeName: 'Audio',
  itemLabel: 'sound',
  itemLabelPlural: 'sounds',
  validate: validateSoundGrabberInput,
  plan: planSoundGrabber,
  run: runSoundGrabberTask,
  cancel() {},
  retryPolicy,
});

module.exports = {
  SOUND_GRABBER_TASK_ID,
  soundGrabberTask,
  planSoundGrabber,
  validateSoundGrabberInput,
};
