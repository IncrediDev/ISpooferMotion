'use strict';

let isPaused = false;
let isCancelled = false;
const pauseResolvers = new Set();

function pauseSpoofer() {
  isPaused = true;
}

function resumeSpoofer() {
  isPaused = false;
  for (const resolve of pauseResolvers) resolve();
  pauseResolvers.clear();
}

function cancelSpoofer() {
  isCancelled = true;
  resumeSpoofer();
}

function resetRunControls() {
  isCancelled = false;
  resumeSpoofer();
}

function checkCancelled() {
  if (isCancelled) {
    throw new Error('Operation cancelled');
  }
}

async function checkPaused() {
  checkCancelled();
  if (!isPaused) return;
  await new Promise((resolve) => pauseResolvers.add(resolve));
  checkCancelled();
}

module.exports = {
  pauseSpoofer,
  resumeSpoofer,
  cancelSpoofer,
  resetRunControls,
  checkCancelled,
  checkPaused,
};
