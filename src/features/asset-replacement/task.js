'use strict';

const { ERROR_CATEGORIES, createFailure } = require('../../core/errors');
const { TASK_IDS, TASK_STAGES, createTaskDefinition, createTaskPlan } = require('../../core/tasks');

const ASSET_REPLACEMENT_TASK_ID = TASK_IDS.ASSET_REPLACEMENT;
const ID_RE = /\b(\d{5,})\b/g;

function detectMappingType(line) {
  const lower = String(line || '').toLowerCase();
  if (/sound|audio/.test(lower)) return 'sound';
  if (/anim/.test(lower)) return 'animation';
  return null;
}

function parseReplacementLine(rawLine, lineNumber) {
  const line = String(rawLine || '').trim();
  if (!line || line.startsWith('#') || line.startsWith('//')) return null;

  const separatorMatch = line.match(/^(.+?)\s*(?:=>|->|=|:)\s*(.+)$/);
  if (!separatorMatch) {
    return {
      rejected: {
        lineNumber,
        input: line,
        reason: 'Use oldId = newId, oldId: newId, oldId -> newId, or oldId => newId.',
      },
    };
  }

  const leftIds = String(separatorMatch[1] || '').match(ID_RE) || [];
  const rightIds = String(separatorMatch[2] || '').match(ID_RE) || [];
  const oldId = leftIds[0];
  const newId = rightIds[0];

  if (!oldId || !newId) {
    return {
      rejected: {
        lineNumber,
        input: line,
        reason: 'Both sides of the mapping need a numeric asset ID.',
      },
    };
  }

  if (oldId === newId) {
    return {
      rejected: {
        lineNumber,
        input: line,
        reason: 'Old ID and new ID are the same.',
      },
    };
  }

  return {
    mapping: {
      oldId: String(oldId),
      newId: String(newId),
      assetType: detectMappingType(line),
      originalInput: line,
      lineNumber,
    },
  };
}

function parseReplacementMappings(input = '') {
  const lines = String(input || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const mappings = [];
  const rejected = [];
  const duplicates = [];
  const seenOldIds = new Set();
  const detectedTypes = new Set();

  lines.forEach((rawLine, index) => {
    const result = parseReplacementLine(rawLine, index + 1);
    if (!result) return;
    if (result.rejected) {
      rejected.push(result.rejected);
      return;
    }

    const mapping = result.mapping;
    if (mapping.assetType) detectedTypes.add(mapping.assetType);

    if (seenOldIds.has(mapping.oldId)) {
      duplicates.push(mapping);
      return;
    }

    seenOldIds.add(mapping.oldId);
    mappings.push(mapping);
  });

  const warnings = [];
  if (duplicates.length > 0)
    warnings.push(`${duplicates.length} duplicate replacement mapping(s) were skipped.`);
  if (rejected.length > 0)
    warnings.push(`${rejected.length} replacement line(s) could not be parsed and were skipped.`);
  if (detectedTypes.size > 1) {
    warnings.push(
      'This input appears to mix sound and animation replacements. Run them separately for safer plugin behavior.',
    );
  }

  return {
    mappings,
    rejected,
    duplicates,
    warnings,
    detectedAssetTypes: Array.from(detectedTypes),
    totalLines: lines.filter((line) => line.trim()).length,
  };
}

function validateAssetReplacementInput(input = {}) {
  const rawMappings = input.mappings || input.replacementInput || input.input || '';
  const parseResult = parseReplacementMappings(rawMappings);
  const issues = [];

  if (!String(rawMappings || '').trim()) {
    issues.push(
      createFailure({
        category: ERROR_CATEGORIES.INVALID_INPUT,
        stage: 'parse',
        message: 'Paste at least one replacement mapping like oldId = newId.',
        retryable: false,
      }),
    );
  } else if (parseResult.mappings.length === 0) {
    issues.push(
      createFailure({
        category: ERROR_CATEGORIES.INVALID_INPUT,
        stage: 'parse',
        message: 'No valid replacement mappings were found. Use oldId = newId format.',
        retryable: false,
      }),
    );
  }

  if (parseResult.detectedAssetTypes.length > 1) {
    issues.push(
      createFailure({
        category: ERROR_CATEGORIES.INVALID_INPUT,
        stage: 'parse',
        message:
          'Do not mix sound and animation replacements in one run. Run each asset type separately.',
        retryable: false,
      }),
    );
  }

  return {
    ok: issues.length === 0,
    issues,
    parseResult,
  };
}

function planAssetReplacement(input = {}) {
  const rawMappings = input.mappings || input.replacementInput || input.input || '';
  const parseResult = parseReplacementMappings(rawMappings);

  return createTaskPlan({
    taskId: ASSET_REPLACEMENT_TASK_ID,
    label: 'Asset Replacement',
    itemLabel: 'mapping',
    itemLabelPlural: 'mappings',
    parseResult,
    total: parseResult.mappings.length,
    stages: [
      TASK_STAGES.PARSE,
      TASK_STAGES.SCAN,
      TASK_STAGES.REPLACE,
      TASK_STAGES.REPORT,
      TASK_STAGES.COMPLETE,
    ],
  });
}

async function runAssetReplacementTask(context = {}) {
  if (typeof context.runLegacyFlow !== 'function') {
    throw new Error('Asset replacement task is not wired to a runner yet.');
  }

  return context.runLegacyFlow({
    task: assetReplacementTask,
    input: context.input || {},
    plan: context.plan || planAssetReplacement(context.input || {}),
  });
}

const retryPolicy = {
  replace: {
    maxAttempts: 1,
    retryableCategories: [],
  },
};

const assetReplacementTask = createTaskDefinition({
  id: ASSET_REPLACEMENT_TASK_ID,
  label: 'Asset Replacement',
  itemLabel: 'mapping',
  itemLabelPlural: 'mappings',
  validate: validateAssetReplacementInput,
  plan: planAssetReplacement,
  run: runAssetReplacementTask,
  cancel() {},
  retryPolicy,
});

module.exports = {
  ASSET_REPLACEMENT_TASK_ID,
  assetReplacementTask,
  parseReplacementMappings,
  planAssetReplacement,
  validateAssetReplacementInput,
};
