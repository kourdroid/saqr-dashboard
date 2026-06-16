import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function TaskDrawer({ taskId, onClose }) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [expandedRuns, setExpandedRuns] = useState({});

  useEffect(() => {
    if (!taskId) return;

    let active = true;
    let pollInterval = null;

    const fetchTaskDetail = async () => {
      try {
        const data = await api(`/kanban-tasks/${taskId}`);
        
        if (active) {
          setTask(data);
          setError(null);

          // Auto-refresh every 3s if task is ready/in_progress/in-progress
          const activeStatus = ['ready', 'in_progress', 'in-progress'].includes(data.status);
          if (activeStatus) {
            if (!pollInterval) {
              pollInterval = setInterval(fetchTaskDetail, 3000);
            }
          } else {
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
          }
        }
      } catch (err) {
        if (active) {
          setError(err.message);
        }
      }
    };

    fetchTaskDetail();

    return () => {
      active = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [taskId]);

  // Listen to Escape key to close the drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!taskId) return null;

  const toggleRunExpansion = (runId) => {
    setExpandedRuns(prev => ({
      ...prev,
      [runId]: !prev[runId]
    }));
  };

  const loading = !task && !error;

  const parsePayload = (payload) => {
    if (!payload) return null;
    try {
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return payload.toString();
    }
  };

  const calculateDuration = (start, end) => {
    if (!start || !end) return null;
    const startTime = new Date(start);
    const endTime = new Date(end);
    if (!Number.isNaN(startTime.getTime()) && !Number.isNaN(endTime.getTime())) {
      const diffMs = endTime - startTime;
      if (diffMs < 0) return null;
      const secs = Math.round(diffMs / 1000);
      if (secs < 60) return `${secs}s`;
      const mins = Math.floor(secs / 60);
      const remainingSecs = secs % 60;
      return `${mins}m ${remainingSecs}s`;
    }
    return null;
  };

  const getPriorityLabel = (p) => {
    if (p === 2) return 'Critical';
    if (p === 1) return 'High';
    return 'Normal';
  };

  return (
    <>
      <div className="task-drawer-backdrop" onClick={onClose} />
      <div className="task-drawer">
        <div className="task-drawer-header">
          <div className="task-drawer-title-area">
            <span className={`priority p${task?.priority || 0}`} style={{ marginBottom: '8px' }}>
              {getPriorityLabel(task?.priority || 0)}
            </span>
            <h3 className="task-drawer-title">{task?.title || `Task Details: ${taskId}`}</h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className={`status-pill ${task?.status || 'unknown'}`}>
                {task?.status?.replace('_', ' ') || 'loading'}
              </span>
              {task?.assignee && (
                <span className="uptime-badge" style={{ fontSize: '10px', padding: '2px 6px' }}>
                  Assignee: {task.assignee}
                </span>
              )}
            </div>
          </div>
          <button className="task-drawer-close" onClick={onClose} title="Close drawer (Esc)">
            ✕
          </button>
        </div>

        <div className="task-drawer-body">
          {loading && !task ? (
            <div className="empty" style={{ minHeight: '120px' }}>
              <div className="spinner" style={{ marginBottom: '12px' }}></div>
              <span>Fetching details from Hermes...</span>
            </div>
          ) : error ? (
            <div className="notice error">
              <span>{error}</span>
            </div>
          ) : (
            <>
              {/* Metadata Panel */}
              <div className="drawer-section">
                <span className="drawer-section-title">Overview & Timestamps</span>
                <div className="drawer-meta-grid">
                  <div className="drawer-meta-item">
                    <div className="drawer-meta-label">Task Identifier</div>
                    <div className="drawer-meta-value" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {task.id}
                    </div>
                  </div>
                  <div className="drawer-meta-item">
                    <div className="drawer-meta-label">Created By</div>
                    <div className="drawer-meta-value">
                      {task.created_by || 'system'}
                    </div>
                  </div>
                  <div className="drawer-meta-item">
                    <div className="drawer-meta-label">Timeline</div>
                    <div className="drawer-meta-value" style={{ fontSize: '11px', lineHeight: '1.4' }}>
                      Created: {task.created_at ? new Date(task.created_at).toLocaleString() : 'N/A'}<br />
                      Started: {task.started_at ? new Date(task.started_at).toLocaleString() : 'N/A'}<br />
                      Ended: {task.completed_at ? new Date(task.completed_at).toLocaleString() : 'N/A'}
                    </div>
                  </div>
                  <div className="drawer-meta-item">
                    <div className="drawer-meta-label">Execution Time</div>
                    <div className="drawer-meta-value">
                      {calculateDuration(task.started_at, task.completed_at) || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Task Body Description */}
              {task.body && (
                <div className="drawer-section">
                  <span className="drawer-section-title">Context / Description</span>
                  <div className="log-box" style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '10px', whiteSpace: 'pre-wrap' }}>
                    {task.body}
                  </div>
                </div>
              )}

              {/* Failure information */}
              {(task.consecutive_failures > 0 || task.last_failure_error) && (
                <div className="drawer-section">
                  <span className="drawer-section-title" style={{ color: 'var(--red)' }}>Failure Analytics</span>
                  <div className="notice error" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                    <strong>Consecutive Failures: {task.consecutive_failures} / {task.max_retries || 3}</strong>
                    {task.last_failure_error && (
                      <pre style={{ margin: 0, fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                        {task.last_failure_error}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {/* Runs History */}
              <div className="drawer-section">
                <span className="drawer-section-title">Run History ({task.runs?.length || 0})</span>
                {task.runs && task.runs.length > 0 ? (
                  task.runs.map((run, index) => {
                    const isExpanded = !!expandedRuns[run.id];
                    const runDur = calculateDuration(run.started_at, run.ended_at);
                    return (
                      <div key={run.id} className="run-history-card">
                        <div 
                          className="run-history-header" 
                          onClick={() => toggleRunExpansion(run.id)}
                        >
                          <span style={{ fontSize: '12px', fontWeight: 'bold' }}>
                            Run #{index + 1} ({run.profile || 'default'})
                          </span>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {runDur && (
                              <span className="uptime-badge" style={{ fontSize: '10px', padding: '1px 5px' }}>
                                {runDur}
                              </span>
                            )}
                            <span className={`status-pill ${run.outcome === 'completed' ? 'ok' : 'error'}`} style={{ height: '18px', padding: '0 6px', fontSize: '9px' }}>
                              {run.outcome || 'unknown'}
                            </span>
                            <span>{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="run-history-summary">
                            {run.error && (
                              <div style={{ color: 'var(--red)', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                                <strong>Error:</strong> {run.error}
                              </div>
                            )}
                            {run.summary ? (
                              run.summary
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>No summary was recorded for this run.</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="empty">No execution runs recorded yet</div>
                )}
              </div>

              {/* Event Timeline */}
              <div className="drawer-section">
                <span className="drawer-section-title">Event Timeline ({task.events?.length || 0})</span>
                {task.events && task.events.length > 0 ? (
                  <div className="event-timeline">
                    {task.events.map((ev) => {
                      const payloadStr = parsePayload(ev.payload);
                      return (
                        <div key={ev.id} className={`timeline-item ${ev.kind === 'completed' ? 'completed' : ev.kind === 'error' ? 'error' : 'active'}`}>
                          <div className="timeline-dot" />
                          <div className="timeline-header">
                            <span className="timeline-kind">{ev.kind?.toUpperCase() || 'EVENT'}</span>
                            <span className="timeline-time">
                              {ev.created_at ? new Date(ev.created_at).toLocaleTimeString() : ''}
                            </span>
                          </div>
                          {payloadStr && (
                            <pre className="timeline-payload">
                              {payloadStr}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty">No events logged for this task</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
