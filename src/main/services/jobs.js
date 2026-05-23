'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app } = require('electron');

function getJobsPath() {
  return path.join(app.getPath('userData'), 'ispoofer_jobs.json');
}

async function loadJobs() {
  try {
    return JSON.parse(await fs.readFile(getJobsPath(), 'utf8')) || [];
  } catch {
    return [];
  }
}

async function saveJobRecord(job) {
  const jobs = await loadJobs();
  const existingIndex = jobs.findIndex((j) => j.id === job.id);
  if (existingIndex >= 0) {
    jobs[existingIndex] = job;
  } else {
    jobs.unshift(job);
  }
  if (jobs.length > 50) jobs.length = 50;
  try {
    await fs.writeFile(getJobsPath(), JSON.stringify(jobs, null, 2), 'utf8');
  } catch (err) {}
}

async function deleteJobRecord(id) {
  let jobs = await loadJobs();
  jobs = jobs.filter((j) => j.id !== id);
  try {
    await fs.writeFile(getJobsPath(), JSON.stringify(jobs, null, 2), 'utf8');
  } catch (err) {}
}

module.exports = {
  getJobsPath,
  loadJobs,
  saveJobRecord,
  deleteJobRecord,
};
