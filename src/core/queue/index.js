'use strict';

const { TASK_STATUSES, createProgressEvent } = require('../tasks');

class QueueCancelledError extends Error {
  constructor(message = 'Task queue canceled.') {
    super(message);
    this.name = 'QueueCancelledError';
    this.code = 'QUEUE_CANCELLED';
  }
}

function toPositiveInteger(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, fallback || 1);
  return parsed;
}

function retryDelayWithJitter(baseDelayMs, attempt = 1, options = {}) {
  const base = Math.max(0, Number(baseDelayMs) || 0);
  const maxDelay = Math.max(base || 1000, Number(options.maxDelayMs) || 60000);
  const exponential =
    options.exponential === false
      ? base
      : base * Math.max(1, Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.max(250, Math.min(2500, base || 1000)));
  return Math.min(maxDelay, exponential + jitter);
}

function isQueueCancelError(err) {
  return (
    !!err &&
    (err.code === 'QUEUE_CANCELLED' || err.name === 'AbortError' || err.code === 'ABORT_ERR')
  );
}

function assertNotAborted(signal) {
  if (signal && signal.aborted) {
    throw new QueueCancelledError('Task queue canceled.');
  }
}

function defaultErrorResult(error, item) {
  return {
    item,
    success: false,
    error: error && error.message ? error.message : String(error || 'Unknown queue error'),
  };
}

function defaultCancelResult(error, item) {
  return {
    item,
    success: false,
    canceled: true,
    error: error && error.message ? error.message : 'Canceled',
  };
}
async function runQueue(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const concurrency = Math.min(toPositiveInteger(options.concurrency, 1), list.length);
  const worker = options.worker;
  if (typeof worker !== 'function')
    throw new TypeError('runQueue requires options.worker to be a function.');

  const isCancelError =
    typeof options.isCancelError === 'function' ? options.isCancelError : isQueueCancelError;
  const createErrorResult =
    typeof options.createErrorResult === 'function'
      ? options.createErrorResult
      : defaultErrorResult;
  const createCancelResult =
    typeof options.createCancelResult === 'function'
      ? options.createCancelResult
      : defaultCancelResult;
  const shouldContinue =
    typeof options.shouldContinue === 'function' ? options.shouldContinue : null;
  const signal = options.signal || null;

  const results = new Array(list.length);
  let nextIndex = 0;
  let stopped = false;

  async function runWorker(workerId) {
    while (!stopped) {
      if (signal && signal.aborted) {
        stopped = true;
        break;
      }
      if (shouldContinue && shouldContinue() === false) break;

      const currentIndex = nextIndex++;
      if (currentIndex >= list.length) break;

      const item = list[currentIndex];
      const context = {
        index: currentIndex,
        total: list.length,
        workerId,
        signal,
      };

      try {
        if (typeof options.beforeItem === 'function') await options.beforeItem(item, context);
        assertNotAborted(signal);
        if (typeof options.emitProgress === 'function') {
          await options.emitProgress(
            createProgressEvent({
              taskId: options.taskId || 'queue',
              itemId:
                item && (item.assetId || item.id || item.oldId) !== undefined
                  ? item.assetId || item.id || item.oldId
                  : currentIndex,
              stage: options.stage || 'queue',
              status: TASK_STATUSES.RUNNING,
              progress: list.length ? Math.round((currentIndex / list.length) * 100) : null,
              message: options.itemStartMessage || 'Processing item...',
              meta: { index: currentIndex, total: list.length, workerId },
            }),
          );
        }
        if (typeof options.onItemStart === 'function') await options.onItemStart(item, context);

        const result = await worker(item, context);
        results[currentIndex] = result;

        if (typeof options.emitProgress === 'function') {
          await options.emitProgress(
            createProgressEvent({
              taskId: options.taskId || 'queue',
              itemId:
                item && (item.assetId || item.id || item.oldId) !== undefined
                  ? item.assetId || item.id || item.oldId
                  : currentIndex,
              stage: options.stage || 'queue',
              status: TASK_STATUSES.SUCCESS,
              progress: list.length ? Math.round(((currentIndex + 1) / list.length) * 100) : 100,
              message: options.itemCompleteMessage || 'Item complete.',
              meta: { index: currentIndex, total: list.length, workerId },
            }),
          );
        }
        if (typeof options.onItemComplete === 'function')
          await options.onItemComplete(result, item, context);
      } catch (error) {
        const canceled = isCancelError(error);
        if (canceled) stopped = true;

        const result = canceled
          ? await createCancelResult(error, item, context)
          : await createErrorResult(error, item, context);

        results[currentIndex] = result;

        if (typeof options.emitProgress === 'function') {
          await options.emitProgress(
            createProgressEvent({
              taskId: options.taskId || 'queue',
              itemId:
                item && (item.assetId || item.id || item.oldId) !== undefined
                  ? item.assetId || item.id || item.oldId
                  : currentIndex,
              stage: options.stage || 'queue',
              status: canceled ? TASK_STATUSES.CANCELED : TASK_STATUSES.ERROR,
              progress: list.length ? Math.round(((currentIndex + 1) / list.length) * 100) : null,
              message: canceled ? 'Item canceled.' : 'Item failed.',
              error:
                result && (result.error || result.reason)
                  ? result.error || result.reason
                  : error && error.message
                    ? error.message
                    : String(error || 'Unknown error'),
              retryable: Boolean(result && result.retryable),
              meta: { index: currentIndex, total: list.length, workerId },
            }),
          );
        }
        if (typeof options.onItemError === 'function')
          await options.onItemError(error, item, context, result);
        if (options.stopOnError || canceled) break;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, (_, workerId) => runWorker(workerId));
  await Promise.all(workers);
  return results.filter(Boolean);
}

module.exports = {
  QueueCancelledError,
  isQueueCancelError,
  retryDelayWithJitter,
  runQueue,
  toPositiveInteger,
};
