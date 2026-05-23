import { useEffect, useRef, useState } from 'react';

export default function ActivityView({ isActive }) {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [currentJobProgress, setCurrentJobProgress] = useState(null);

  const terminalOutputRef = useRef(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const history = await window.electronAPI?.getJobs?.();
        if (history) setJobs(history);
      } catch (e) {}
    };
    fetchJobs();

    const cleanupLog = window.electronAPI?.onSpooferLog?.((data) => {
      let text = data?.message || data?.text || String(data);
      let level = data?.level || 'info';

      if (!data?.level) {
        const lower = text.toLowerCase();
        if (lower.includes('error') || lower.includes('failed') || lower.includes('invalid'))
          level = 'error';
        else if (lower.includes('success') || lower.includes('completed')) level = 'success';
        else if (lower.includes('warning') || lower.includes('skip')) level = 'warn';
      }

      setLogs((prev) => [...prev, { id: Date.now() + Math.random(), text, level }]);
    });

    const cleanupResult = window.electronAPI?.onSpooferResult?.(() => {
      setCurrentJobProgress(null);
      fetchJobs();
    });

    const cleanupProgress = window.electronAPI?.onSpooferProgress?.((data) => {
      if (data.total) {
        setCurrentJobProgress(`Progress: ${data.current} / ${data.total}`);
      }
    });

    const handleClearSession = () => {
      setLogs([]);
      setCurrentJobProgress('Initializing...');
    };

    // Some events may be broadcast via custom window events or IPC
    window.electronAPI?.onIpc?.('clear-session', handleClearSession);
    window.addEventListener('clear-session', handleClearSession);

    return () => {
      cleanupLog && cleanupLog();
      cleanupResult && cleanupResult();
      cleanupProgress && cleanupProgress();
      window.removeEventListener('clear-session', handleClearSession);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const copyLogs = () => {
    const text = logs.map((l) => l.text).join('\n');
    navigator.clipboard.writeText(text);
  };

  const redoJob = (job) => {
    if (
      window.confirm('Are you sure you want to redo this job with its exact original settings?')
    ) {
      window.electronAPI?.runSpooferAction?.(job.payload);
    }
  };

  const deleteJob = async (jobId) => {
    if (window.confirm('Permanently delete this job history?')) {
      await window.electronAPI?.deleteJob?.(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    }
  };

  return (
    <section
      className={`view queue-view ${isActive ? 'is-active' : ''}`}
      data-view-panel="queue"
      aria-label="Activity"
    >
      <div className="activity-page" id="activity-page">
        <div className="activity-feed" id="activity-feed">
          {!currentJobProgress && jobs.length === 0 && (
            <div className="empty-feed-msg">
              No recent activity. Start an upload to see it here!
            </div>
          )}

          {currentJobProgress && (
            <div className="job-card expanded">
              <div className="job-card-header">
                <strong>Upload Job • {new Date().toLocaleTimeString()}</strong>
                <span className="job-status uploading">Uploading...</span>
              </div>
              <div className="job-details">
                <span className="job-progress-text">{currentJobProgress}</span>
              </div>
              <div className="job-extended-details">
                Details will appear here when the job completes.
              </div>
            </div>
          )}

          {jobs.map((job) => (
            <JobCard key={job.id} job={job} redoJob={redoJob} deleteJob={deleteJob} />
          ))}
        </div>

        <div className="activity-terminal-container">
          <div className="terminal-header">
            <span>Backend Spoofer Logs</span>
            <div
              className="terminal-header-actions"
              style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
            >
              <button
                className="ui-button"
                id="copy-terminal-logs-btn"
                type="button"
                style={{ padding: '4px 8px', fontSize: '11px', height: 'auto', minHeight: 0 }}
                onClick={copyLogs}
              >
                Copy Logs
              </button>
              <button
                className="ui-button ui-button-danger"
                id="clear-terminal-logs-btn"
                type="button"
                style={{ padding: '4px 8px', fontSize: '11px', height: 'auto', minHeight: 0 }}
                onClick={() => setLogs([])}
              >
                Clear
              </button>
              <label
                className="option-row inline-option terminal-toggle"
                htmlFor="terminal-autoscroll"
                style={{ margin: 0 }}
              >
                <span>Auto-scroll</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    id="terminal-autoscroll"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  <i></i>
                </span>
              </label>
            </div>
          </div>
          <div className="terminal-output" id="terminal-output" ref={terminalOutputRef}>
            {logs.map((log) => (
              <div key={log.id} className={`log-line ${log.level}`}>
                {log.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function JobCard({ job, redoJob, deleteJob }) {
  const [expanded, setExpanded] = useState(false);

  let progressText = job.result?.message || 'Completed';
  if (job.status === 'processing') progressText = 'Interrupted/Processing...';
  else if (job.status === 'partial')
    progressText = job.result?.message || 'Completed with some errors (Partial Completion)';
  else if (job.status !== 'success') progressText = job.result?.message || 'Failed or Cancelled';

  return (
    <div
      className={`job-card ${expanded ? 'expanded' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="job-card-header">
        <strong>
          Upload Job • {new Date(job.timestamp).toLocaleTimeString()} (
          {new Date(job.timestamp).toLocaleDateString()})
        </strong>
        <span className={`job-status ${job.status}`}>
          {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
        </span>
      </div>
      <div className="job-details">
        <span className="job-progress-text">{progressText}</span>
      </div>

      <div
        className="job-actions"
        style={{ marginTop: '10px', display: 'flex', gap: '10px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {job.result?.output && (
          <button
            className="ui-button"
            onClick={() => navigator.clipboard.writeText(job.result.output)}
          >
            Copy Logs
          </button>
        )}
        <button className="ui-button" onClick={() => redoJob(job)}>
          Redo Job
        </button>
        <button className="ui-button ui-button-danger" onClick={() => deleteJob(job.id)}>
          Delete Job
        </button>
      </div>

      <div className="job-extended-details">
        {job.result?.output ? (
          <div dangerouslySetInnerHTML={{ __html: job.result.output.replace(/\n/g, '<br/>') }} />
        ) : (
          'No additional output details available.'
        )}
      </div>
    </div>
  );
}
