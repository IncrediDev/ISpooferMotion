'use strict';

const ERROR_CATEGORIES = Object.freeze({
  BAD_COOKIE: 'bad_cookie',
  BAD_OPEN_CLOUD_KEY: 'bad_open_cloud_key',
  PERMISSION_DENIED: 'permission_denied',
  PRIVATE_ASSET: 'private_asset',
  ASSET_NOT_FOUND: 'asset_not_found',
  RATE_LIMITED: 'rate_limited',
  ROBLOX_5XX: 'roblox_5xx',
  CDN_TIMEOUT: 'cdn_timeout',
  DOWNLOAD_TIMEOUT: 'download_timeout',
  DOWNLOAD_CORRUPT: 'download_corrupt',
  DOWNLOAD_FAILED: 'download_failed',
  UPLOAD_QUOTA: 'upload_quota',
  UPLOAD_PERMISSION: 'upload_permission',
  UPLOAD_VALIDATION: 'upload_validation',
  CREATOR_MISMATCH: 'creator_mismatch',
  BAD_PLACE_ID: 'bad_place_id',
  INVALID_INPUT: 'invalid_input',
  FILE_CONVERSION_FAILED: 'file_conversion_failed',
  NETWORK_FAILURE: 'network_failure',
  CANCELED: 'canceled',
  UNKNOWN: 'unknown',
});

const RETRYABLE_ERROR_CATEGORIES = new Set([
  ERROR_CATEGORIES.RATE_LIMITED,
  ERROR_CATEGORIES.ROBLOX_5XX,
  ERROR_CATEGORIES.CDN_TIMEOUT,
  ERROR_CATEGORIES.DOWNLOAD_TIMEOUT,
  ERROR_CATEGORIES.DOWNLOAD_FAILED,
  ERROR_CATEGORIES.NETWORK_FAILURE,
]);

const CATEGORY_LABELS = Object.freeze({
  [ERROR_CATEGORIES.BAD_COOKIE]: 'Bad Roblox cookie',
  [ERROR_CATEGORIES.BAD_OPEN_CLOUD_KEY]: 'Bad Open Cloud API key',
  [ERROR_CATEGORIES.PERMISSION_DENIED]: 'Permission denied',
  [ERROR_CATEGORIES.PRIVATE_ASSET]: 'Private or moderated asset',
  [ERROR_CATEGORIES.ASSET_NOT_FOUND]: 'Asset not found',
  [ERROR_CATEGORIES.RATE_LIMITED]: 'Rate limited',
  [ERROR_CATEGORIES.ROBLOX_5XX]: 'Roblox server error',
  [ERROR_CATEGORIES.CDN_TIMEOUT]: 'Download timeout',
  [ERROR_CATEGORIES.DOWNLOAD_TIMEOUT]: 'Download timeout',
  [ERROR_CATEGORIES.DOWNLOAD_CORRUPT]: 'Corrupt download',
  [ERROR_CATEGORIES.DOWNLOAD_FAILED]: 'Download failed',
  [ERROR_CATEGORIES.UPLOAD_QUOTA]: 'Upload quota reached',
  [ERROR_CATEGORIES.UPLOAD_PERMISSION]: 'Upload permission issue',
  [ERROR_CATEGORIES.UPLOAD_VALIDATION]: 'Upload rejected',
  [ERROR_CATEGORIES.CREATOR_MISMATCH]: 'Creator mismatch',
  [ERROR_CATEGORIES.BAD_PLACE_ID]: 'Bad place ID',
  [ERROR_CATEGORIES.INVALID_INPUT]: 'Invalid input',
  [ERROR_CATEGORIES.FILE_CONVERSION_FAILED]: 'File conversion failed',
  [ERROR_CATEGORIES.NETWORK_FAILURE]: 'Network failure',
  [ERROR_CATEGORIES.CANCELED]: 'Canceled',
  [ERROR_CATEGORIES.UNKNOWN]: 'Unknown error',
});

const DEFAULT_SUGGESTED_FIX = 'Check the debug details and try again.';
const VALID_CATEGORIES = new Set(Object.values(ERROR_CATEGORIES));

function getRawErrorText(error) {
  if (typeof error === 'string') return error;
  if (!error) return 'Unknown error';
  return String(error.message || error.error || error.code || error.statusText || error);
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] || CATEGORY_LABELS[ERROR_CATEGORIES.UNKNOWN];
}

function isRetryableCategory(category) {
  return RETRYABLE_ERROR_CATEGORIES.has(category);
}

function getStructuredCategory(error) {
  if (!error || typeof error !== 'object') return '';
  return error.category || error.errorCategory || '';
}

function suggestedFixForCategory(category, stage = '') {
  switch (category) {
    case ERROR_CATEGORIES.BAD_COOKIE:
      return 'Re-enter the cookie or use auto-detect again.';
    case ERROR_CATEGORIES.BAD_OPEN_CLOUD_KEY:
      return 'Create or update the Open Cloud key with Assets read/write permissions.';
    case ERROR_CATEGORIES.UPLOAD_QUOTA:
      return 'Wait for quota reset or use another account/group with available quota.';
    case ERROR_CATEGORIES.CREATOR_MISMATCH:
      return 'Check the User/Group source and the upload target.';
    case ERROR_CATEGORIES.RATE_LIMITED:
      return 'Retry later or lower upload/download concurrency.';
    case ERROR_CATEGORIES.ROBLOX_5XX:
      return 'Retry the failed items later.';
    case ERROR_CATEGORIES.DOWNLOAD_TIMEOUT:
    case ERROR_CATEGORIES.CDN_TIMEOUT:
    case ERROR_CATEGORIES.NETWORK_FAILURE:
      return 'Retry the failed items or lower concurrency.';
    case ERROR_CATEGORIES.ASSET_NOT_FOUND:
      return 'Check the asset ID and make sure the asset still exists.';
    case ERROR_CATEGORIES.PRIVATE_ASSET:
      return 'Use an account/place with access to the asset.';
    case ERROR_CATEGORIES.UPLOAD_PERMISSION:
      return 'Check group permissions and Open Cloud Assets permissions.';
    case ERROR_CATEGORIES.UPLOAD_VALIDATION:
      return 'Check the asset name, file type, and target creator, then retry the failed item.';
    case ERROR_CATEGORIES.PERMISSION_DENIED:
      return stage === 'upload'
        ? 'Check upload target permissions.'
        : 'Use the correct source creator/place or an account with access.';
    case ERROR_CATEGORIES.BAD_PLACE_ID:
      return 'Use another place ID from the asset creator or leave override place blank so the app can try discovered places.';
    case ERROR_CATEGORIES.DOWNLOAD_CORRUPT:
    case ERROR_CATEGORIES.FILE_CONVERSION_FAILED:
      return 'Retry the item. If it keeps failing, the downloaded asset may be invalid.';
    case ERROR_CATEGORIES.DOWNLOAD_FAILED:
      return 'Retry the failed item. If it repeats, check asset access.';
    case ERROR_CATEGORIES.CANCELED:
      return 'Start the run again when ready.';
    case ERROR_CATEGORIES.INVALID_INPUT:
      return 'Fix the invalid line or remove it before running again.';
    default:
      return DEFAULT_SUGGESTED_FIX;
  }
}

function createFailure(input = {}) {
  const category = VALID_CATEGORIES.has(input.category) ? input.category : ERROR_CATEGORIES.UNKNOWN;
  const message = input.message || categoryLabel(category);
  return {
    stage: input.stage || '',
    category,
    label: input.label || categoryLabel(category),
    message,
    raw: input.raw || input.rawForDebug || message,
    retryable:
      typeof input.retryable === 'boolean' ? input.retryable : isRetryableCategory(category),
    suggestedFix: input.suggestedFix || suggestedFixForCategory(category, input.stage),
    rawForDebug: input.rawForDebug || input.raw || message,
  };
}

function classifyError(error, context = {}) {
  const raw = getRawErrorText(error);
  const text = String(raw);
  const lower = text.toLowerCase();
  const stage = String(context.stage || '').toLowerCase();
  const structuredCategory = String(getStructuredCategory(error)).toLowerCase();
  let category = ERROR_CATEGORIES.UNKNOWN;
  let message = text || 'Unknown error';
  let suggestedFix = DEFAULT_SUGGESTED_FIX;

  if (structuredCategory && VALID_CATEGORIES.has(structuredCategory)) {
    category = structuredCategory;
    message = error.message || text || categoryLabel(category);
    suggestedFix = error.suggestedFix || suggestedFixForCategory(category, stage);
  } else if (error && error.code === 'SPOOFER_CANCELLED') {
    category = ERROR_CATEGORIES.CANCELED;
    message = 'The run was canceled.';
    suggestedFix = 'Start the run again when ready.';
  } else if (
    /\b401\b/.test(text) ||
    lower.includes('unauthorized') ||
    lower.includes('token validation failed') ||
    lower.includes('authentication token') ||
    lower.includes('invalid roblox cookie') ||
    (lower.includes('cookie') && (lower.includes('invalid') || lower.includes('expired'))) ||
    lower.includes('authentication failed') ||
    lower.includes('failed to resolve your roblox user id')
  ) {
    category = ERROR_CATEGORIES.BAD_COOKIE;
    message = 'The Roblox cookie appears to be invalid or expired.';
    suggestedFix = 'Re-enter the cookie or use auto-detect again.';
  } else if (
    lower.includes('api key') ||
    lower.includes('x-api-key') ||
    lower.includes('invalid api key') ||
    lower.includes('api key rejected') ||
    lower.includes('api key is not authorized') ||
    (/\b403\b/.test(text) && lower.includes('open cloud'))
  ) {
    category = ERROR_CATEGORIES.BAD_OPEN_CLOUD_KEY;
    message = 'The Open Cloud API key is missing, invalid, expired, or missing Assets permissions.';
    suggestedFix = 'Create or update the Open Cloud key with Assets read/write permissions.';
  } else if (
    lower.includes('quota') ||
    lower.includes('upload limit') ||
    lower.includes('monthly limit') ||
    lower.includes('maximum number of uploads') ||
    lower.includes('asset quota')
  ) {
    category = ERROR_CATEGORIES.UPLOAD_QUOTA;
    message = 'Roblox reported an upload quota or upload limit issue.';
    suggestedFix = 'Wait for quota reset or use another account/group with available quota.';
  } else if (
    lower.includes('creator') &&
    (lower.includes('mismatch') ||
      lower.includes('does not match') ||
      lower.includes('invalid creator'))
  ) {
    category = ERROR_CATEGORIES.CREATOR_MISMATCH;
    message = 'The source or upload creator does not match what Roblox expected.';
    suggestedFix = 'Check the User/Group source and the upload target.';
  } else if (
    (lower.includes('place') && lower.includes('invalid')) ||
    lower.includes('invalid place') ||
    lower.includes('placeid') ||
    lower.includes('place id') ||
    lower.includes('universe') ||
    lower.includes('experience')
  ) {
    category = ERROR_CATEGORIES.BAD_PLACE_ID;
    message = 'Roblox rejected the place ID used for asset access.';
    suggestedFix =
      'Use another place ID from the asset creator or leave override place blank so the app can try discovered places.';
  } else if (
    /\b429\b/.test(text) ||
    lower.includes('rate limit') ||
    lower.includes('too many request')
  ) {
    category = ERROR_CATEGORIES.RATE_LIMITED;
    message = 'Roblox rate-limited the request.';
    suggestedFix = 'Retry later or lower upload/download concurrency.';
  } else if (
    /\b5\d\d\b/.test(text) ||
    lower.includes('server error') ||
    lower.includes('bad gateway') ||
    lower.includes('service unavailable') ||
    lower.includes('gateway timeout')
  ) {
    category = ERROR_CATEGORIES.ROBLOX_5XX;
    message = 'Roblox returned a temporary server error.';
    suggestedFix = 'Retry the failed items later.';
  } else if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborterror') ||
    lower.includes('aborted') ||
    lower.includes('stalled')
  ) {
    category =
      stage === 'download' ? ERROR_CATEGORIES.DOWNLOAD_TIMEOUT : ERROR_CATEGORIES.NETWORK_FAILURE;
    message =
      stage === 'download' ? 'The Roblox CDN download timed out.' : 'The request timed out.';
    suggestedFix = 'Retry the failed items or lower concurrency.';
  } else if (
    lower.includes('econn') ||
    lower.includes('enotfound') ||
    lower.includes('network') ||
    lower.includes('socket') ||
    lower.includes('dns') ||
    lower.includes('tls') ||
    lower.includes('certificate') ||
    lower.includes('connection closed') ||
    lower.includes('connection reset') ||
    lower.includes('fetch failed')
  ) {
    category = ERROR_CATEGORIES.NETWORK_FAILURE;
    message = 'The request failed because of a network problem.';
    suggestedFix = 'Check the network and retry failed items.';
  } else if (
    /\b404\b/.test(text) ||
    lower.includes('asset unavailable') ||
    lower.includes('not found') ||
    lower.includes('deleted')
  ) {
    category = ERROR_CATEGORIES.ASSET_NOT_FOUND;
    message = 'Roblox could not find this asset.';
    suggestedFix = 'Check the asset ID and make sure the asset still exists.';
  } else if (
    lower.includes('moderated') ||
    lower.includes('not approved') ||
    lower.includes('review') ||
    lower.includes('blocked') ||
    lower.includes('restricted') ||
    lower.includes('private') ||
    lower.includes('no location') ||
    lower.includes('no locations') ||
    lower.includes('no download location')
  ) {
    category = ERROR_CATEGORIES.PRIVATE_ASSET;
    message =
      'Roblox did not return a downloadable location. The asset may be private, moderated, or unavailable to this account.';
    suggestedFix = 'Use an account/place with access to the asset.';
  } else if (
    /\b403\b/.test(text) ||
    lower.includes('forbidden') ||
    lower.includes('permission') ||
    lower.includes('not authorized') ||
    lower.includes('not allowed') ||
    lower.includes('access denied') ||
    lower.includes('insufficient privileges')
  ) {
    if (stage === 'upload' || lower.includes('group') || lower.includes('open cloud')) {
      category = ERROR_CATEGORIES.UPLOAD_PERMISSION;
      message = 'The account or API key does not have upload permission for the selected target.';
      suggestedFix = 'Check group permissions and Open Cloud Assets permissions.';
    } else {
      category = ERROR_CATEGORIES.PERMISSION_DENIED;
      message = 'Roblox blocked access to this source asset.';
      suggestedFix = 'Use the correct source creator/place or an account with access.';
    }
  } else if (
    stage === 'upload' &&
    (/\b400\b/.test(text) ||
      lower.includes('invalid request') ||
      lower.includes('invalid asset') ||
      lower.includes('invalid file') ||
      lower.includes('unsupported') ||
      lower.includes('validation') ||
      lower.includes('malformed'))
  ) {
    category = ERROR_CATEGORIES.UPLOAD_VALIDATION;
    message = 'Roblox rejected the upload request as invalid.';
    suggestedFix =
      'Check the asset name, file type, and target creator, then retry the failed item.';
  } else if (
    lower.includes('empty download') ||
    lower.includes('was empty') ||
    lower.includes('corrupt') ||
    lower.includes('partial download') ||
    lower.includes('incomplete')
  ) {
    category = ERROR_CATEGORIES.DOWNLOAD_CORRUPT;
    message = 'The downloaded file was empty, partial, or corrupt.';
    suggestedFix = 'Retry the item. If it repeats, the source asset may be unavailable.';
  } else if (
    lower.includes('rbxm') ||
    lower.includes('conversion') ||
    lower.includes('convert') ||
    lower.includes('file system') ||
    lower.includes('fs') ||
    lower.includes('enoent') ||
    lower.includes('readfile')
  ) {
    category = ERROR_CATEGORIES.FILE_CONVERSION_FAILED;
    message = 'The downloaded file could not be read, converted, or prepared for upload.';
    suggestedFix = 'Retry the item. If it keeps failing, the downloaded asset may be invalid.';
  } else if (stage === 'download') {
    category = ERROR_CATEGORIES.DOWNLOAD_FAILED;
    message = text || 'The download failed.';
    suggestedFix = 'Retry the failed item. If it repeats, check asset access.';
  }

  return createFailure({
    category,
    message,
    raw: text,
    retryable: isRetryableCategory(category),
    suggestedFix,
    stage,
  });
}

module.exports = {
  ERROR_CATEGORIES,
  RETRYABLE_ERROR_CATEGORIES,
  CATEGORY_LABELS,
  categoryLabel,
  classifyError,
  classifyAssetError: classifyError,
  createFailure,
  getRawErrorText,
  isRetryableCategory,
  suggestedFixForCategory,
};
