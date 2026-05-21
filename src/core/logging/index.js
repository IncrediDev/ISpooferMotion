function defaultSecretSanitizer(message) {
  let sanitized = String(message || '');

  sanitized = sanitized.replace(/"robloxCookie"\s*:\s*"[^"]*"/gi, '"robloxCookie":"{Cookie:Here}"');
  sanitized = sanitized.replace(/\.ROBLOSECURITY=[^;\s,}"]*/gi, '{Cookie:Here}');
  sanitized = sanitized.replace(/_\|WARNING:[^|]*\|_[^,}\s"]*/gi, '{Cookie:Here}');
  sanitized = sanitized.replace(/ROBLOSECURITY[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, '{Cookie:Here}$1');

  sanitized = sanitized.replace(
    /X-CSRF-TOKEN[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi,
    'X-CSRF-TOKEN:{Cookie:Here}$1',
  );
  sanitized = sanitized.replace(/"X-CSRF-TOKEN"\s*:\s*"[^"]*"/gi, '"X-CSRF-TOKEN":"{Cookie:Here}"');
  sanitized = sanitized.replace(/Bearer\s+[^\s,;},"]*([,}"\s]|$)/gi, 'Bearer {Cookie:Here}$1');
  sanitized = sanitized.replace(
    /Authorization[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi,
    'Authorization:{Cookie:Here}$1',
  );
  sanitized = sanitized.replace(
    /"Authorization"\s*:\s*"[^"]*"/gi,
    '"Authorization":"{Cookie:Here}"',
  );

  sanitized = sanitized.replace(/"x-api-key"\s*:\s*"[^"]*"/gi, '"x-api-key":"{ApiKey:Here}"');
  sanitized = sanitized.replace(
    /x-api-key[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi,
    'x-api-key:{ApiKey:Here}$1',
  );
  sanitized = sanitized.replace(
    /"openCloudApiKey"\s*:\s*"[^"]*"/gi,
    '"openCloudApiKey":"{ApiKey:Here}"',
  );
  sanitized = sanitized.replace(/"apiKey"\s*:\s*"[^"]*"/gi, '"apiKey":"{ApiKey:Here}"');

  sanitized = sanitized.replace(
    /(^|[\s,{])Cookie(?:=\s*|:\s+)[^};"]*([};"]\s*|$)/gi,
    '$1Cookie:{Cookie:Here}$2',
  );
  sanitized = sanitized.replace(/"Cookie"\s*:\s*"[^"]*"/gi, '"Cookie":"{Cookie:Here}"');
  sanitized = sanitized.replace(/"session"\s*:\s*"[^"]*"/gi, '"session":"{Cookie:Here}"');
  sanitized = sanitized.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"{Cookie:Here}"');
  sanitized = sanitized.replace(/"accessToken"\s*:\s*"[^"]*"/gi, '"accessToken":"{Cookie:Here}"');

  return sanitized;
}

function redactLocalPath(value, options = {}) {
  const input = String(value || '');
  if (!input) return '';

  const homePath = options.homePath || '';
  if (homePath && input.startsWith(homePath)) {
    return input.replace(homePath, '%USERPROFILE%');
  }

  return input
    .replace(/([A-Z]:\\Users\\)[^\\]+/gi, '$1%USERNAME%')
    .replace(/(\\Users\\)[^\\]+/gi, '$1%USERNAME%');
}

function sanitizeSupportValue(value, options = {}) {
  const sanitizeMessage = options.sanitizeMessage || defaultSecretSanitizer;

  if (value == null) return value;
  if (typeof value === 'string') return sanitizeMessage(redactLocalPath(value, options));
  if (Array.isArray(value)) return value.map((item) => sanitizeSupportValue(item, options));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, rawValue] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('cookie') ||
        lowerKey.includes('apikey') ||
        lowerKey === 'api_key' ||
        lowerKey.includes('token') ||
        lowerKey.includes('webhook')
      ) {
        output[key] = rawValue ? '[redacted]' : '';
      } else if (
        lowerKey.includes('folder') ||
        lowerKey.includes('path') ||
        lowerKey.includes('directory')
      ) {
        output[key] =
          typeof rawValue === 'string'
            ? redactLocalPath(rawValue, options)
            : sanitizeSupportValue(rawValue, options);
      } else {
        output[key] = sanitizeSupportValue(rawValue, options);
      }
    }
    return output;
  }
  return value;
}

function summarizeFailureCategories(report) {
  const categories = {};
  try {
    const parsed = typeof report === 'string' ? JSON.parse(report) : report;
    const groups =
      parsed &&
      (parsed.failureCategories ||
        parsed.failures ||
        parsed.downloadFailures ||
        parsed.uploadFailures);
    const list = Array.isArray(groups) ? groups : [];
    for (const item of list) {
      const label = item.category || item.type || item.reason || item.status || 'Failure';
      categories[label] = (categories[label] || 0) + 1;
    }
  } catch {}

  return Object.keys(categories).length
    ? Object.entries(categories)
        .map(([key, count]) => `${key}: ${count}`)
        .join(', ')
    : 'none recorded';
}

function countRetryableFailures(failures) {
  return (Array.isArray(failures) ? failures : []).reduce(
    (acc, failure) => {
      if (failure && failure.retryable === true) acc.retryable += 1;
      else acc.permanent += 1;
      return acc;
    },
    { retryable: 0, permanent: 0 },
  );
}

module.exports = {
  countRetryableFailures,
  defaultSecretSanitizer,
  redactLocalPath,
  sanitizeSupportValue,
  summarizeFailureCategories,
};
