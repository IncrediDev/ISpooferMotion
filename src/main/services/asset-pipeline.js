'use strict';

const {
  ERROR_CATEGORIES,
  RETRYABLE_ERROR_CATEGORIES,
  categoryLabel,
  classifyAssetError,
  createFailure,
  isRetryableCategory,
} = require('../../core/errors');
const {
  buildBatchItems,
  chunkArray,
  getBatchPlan,
  groupBatchItemsByCreator,
  toPositiveInteger,
} = require('../../core/assets');
const { retryDelayWithJitter } = require('../../core/queue');

function createBatchLocationFailure(item, error, context = {}) {
  const classified = classifyAssetError(error, { stage: context.stage || 'download' });
  return {
    requestId: item && item.requestId ? String(item.requestId) : '',
    errors: [
      {
        code: context.code || classified.category,
        message: classified.message,
        raw: classified.raw,
        category: classified.category,
        retryable: classified.retryable === true,
        suggestedFix: classified.suggestedFix,
      },
    ],
  };
}

function getLocationErrorText(locationResult) {
  if (!locationResult) return 'No location result returned.';
  if (locationResult.errors && locationResult.errors.length > 0) {
    const first = locationResult.errors[0] || {};
    return first.message || first.Message || first.raw || JSON.stringify(first);
  }
  if (!locationResult.locations || locationResult.locations.length === 0)
    return 'No download location returned.';
  return '';
}

function createStageFailure(entry, stage, reason, options = {}) {
  const message = reason && reason.message ? reason.message : String(reason || 'Unknown failure');
  const classified = options.classified || classifyAssetError(reason, { stage });
  return {
    entry: entry || null,
    id: entry ? String(entry.id || entry.assetId || '') : '',
    name: entry ? entry.name || '' : '',
    stage,
    success: false,
    error: options.userMessage || classified.message || message,
    errorCategory: options.category || classified.category,
    errorLabel: options.errorLabel || classified.label,
    rawError: options.rawError || classified.raw || message,
    retryable: typeof options.retryable === 'boolean' ? options.retryable : classified.retryable,
    suggestedFix: options.suggestedFix || classified.suggestedFix,
  };
}

function createStageSuccess(entry, stage, extra = {}) {
  return {
    entry,
    stage,
    success: true,
    ...extra,
  };
}

function summarizeStageFailures(results, stage) {
  return (results || [])
    .filter((result) => result && result.success === false && (!stage || result.stage === stage))
    .map((result) => ({
      id: result.id || (result.entry && result.entry.id) || '',
      name: result.name || (result.entry && result.entry.name) || '',
      stage: result.stage || stage || 'unknown',
      category: result.errorCategory || ERROR_CATEGORIES.UNKNOWN,
      label: result.errorLabel || categoryLabel(result.errorCategory),
      reason: result.error || 'Unknown error',
      retryable: result.retryable === true,
      suggestedFix: result.suggestedFix || '',
    }));
}

module.exports = {
  ERROR_CATEGORIES,
  RETRYABLE_ERROR_CATEGORIES,
  categoryLabel,
  classifyAssetError,
  createFailure,
  isRetryableCategory,
  retryDelayWithJitter,
  toPositiveInteger,
  chunkArray,
  groupBatchItemsByCreator,
  getBatchPlan,
  createBatchLocationFailure,
  getLocationErrorText,
  buildBatchItems,
  createStageFailure,
  createStageSuccess,
  summarizeStageFailures,
};
