function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function statusClass(value) {
  return String(value || 'unknown').replaceAll('_', '-')
}

const HEALTH_COLORS = {
  ok:        'var(--green)',
  error:     'var(--red)',
  stale:     'var(--yellow)',
  paused:    'var(--muted)',
  never_run: 'var(--blue)',
  never:     'var(--blue)',
  unknown:   'var(--faint)',
}

export default function CronPanel({ cronJobs, busyKey, onToggle, onTrigger }) {
  return (
    <section className="page-section">
      <div className="panel">
        <div className="panel-header">
          <h2>Cron Jobs</h2>
          <span className="panel-badge">{cronJobs.length} tracked</span>
        </div>
        {cronJobs.length === 0
          ? <div className="stack"><div className="empty">No cron jobs found</div></div>
          : (
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Schedule</th>
                <th>Health</th>
                <th>Last Run</th>
                <th>Last Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cronJobs.map((job) => (
                <tr key={job.id}>
                  <td><strong style={{ color: 'var(--text)' }}>{job.name}</strong></td>
                  <td><code>{job.schedule?.expr || '—'}</code></td>
                  <td>
                    <span
                      className={`status-pill ${statusClass(job.health)}`}
                      style={{ borderColor: HEALTH_COLORS[job.health] ? `${HEALTH_COLORS[job.health]}44` : undefined }}
                    >
                      {job.health}
                    </span>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{formatTime(job.last_run_at)}</td>
                  <td>
                    {job.last_status
                      ? <span className={`status-pill ${statusClass(job.last_status)}`}>{job.last_status}</span>
                      : <span style={{ color: 'var(--faint)' }}>—</span>}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        onClick={() => onToggle(job.id)}
                        disabled={busyKey === `cron-${job.id}`}
                      >
                        {job.enabled ? '⏸ Pause' : '▶ Enable'}
                      </button>
                      <button
                        onClick={() => onTrigger(job.id)}
                        disabled={busyKey === `trigger-${job.id}`}
                      >
                        ⚡ Trigger
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
