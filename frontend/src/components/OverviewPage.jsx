function formatTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function statusClass(value) {
  return String(value || 'unknown').replaceAll('_', '-')
}

const COLUMN_COLORS = {
  backlog:     '#64748b',
  ready:       '#4a9eff',
  in_progress: '#f0a326',
  blocked:     '#f25c5c',
  done:        '#22d47a',
}

const COLUMNS = [
  { key: 'backlog',     label: 'Backlog' },
  { key: 'ready',      label: 'Ready' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked',    label: 'Blocked' },
  { key: 'done',       label: 'Done' },
]

export default function OverviewPage({ overview, tasks, pipeline, credits, cronJobs, envKeys }) {
  const containerStatus = overview?.container?.status || 'unknown'
  const taskCounts = overview?.tasks?.by_status || {}
  const cronHealth = overview?.cron?.by_health || {}
  const activeCredits = Object.values(credits || {}).filter(Boolean).length
  const totalCredits = Object.keys(credits || {}).length

  const metricCards = [
    {
      label: 'Container',
      value: containerStatus,
      sub: overview?.generated_at ? `Updated ${formatTime(overview.generated_at)}` : 'Awaiting pulse',
      accent: containerStatus === 'running' ? 'var(--green)' : 'var(--red)',
    },
    {
      label: 'Tasks',
      value: overview?.tasks?.total ?? '—',
      sub: `${taskCounts.blocked || 0} blocked · ${overview?.tasks?.critical || 0} critical`,
      accent: 'var(--accent)',
    },
    {
      label: 'Cron Errors',
      value: cronHealth.error || 0,
      sub: `${cronHealth.ok || 0} ok · ${cronHealth.stale || 0} stale`,
      accent: cronHealth.error > 0 ? 'var(--red)' : 'var(--green)',
    },
    {
      label: 'Pipeline',
      value: pipeline?.total || 0,
      sub: `${(pipeline?.mehdi?.applied || 0) + (pipeline?.kourchal?.applied || 0)} applied`,
      accent: 'var(--blue)',
    },
    {
      label: 'API Keys',
      value: `${activeCredits}/${totalCredits}`,
      sub: `${envKeys.length} env keys`,
      accent: activeCredits === totalCredits ? 'var(--green)' : 'var(--yellow)',
    },
    {
      label: 'Model',
      value: overview?.config?.model?.default || '—',
      sub: overview?.config?.model?.provider || 'provider unset',
      accent: 'var(--violet)',
    },
  ]

  return (
    <section className="page-section">
      {/* Metric Cards */}
      <div className="page-grid" style={{ marginBottom: 14 }}>
        {metricCards.map((card, i) => (
          <div
            key={card.label}
            className="metric-card"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="card-label">{card.label}</div>
            <div className="card-value" style={{ color: card.accent }}>{card.value}</div>
            <div className="card-sub">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Lower panels */}
      <div className="page-grid">
        {/* Operations Pulse */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>Operations Pulse</h2>
            <span className="panel-badge">{overview?.config?.agent?.max_turns ?? '—'} max turns</span>
          </div>
          <div className="status-grid">
            {COLUMNS.map((col) => (
              <div
                key={col.key}
                className="status-cell"
                style={{ borderLeftColor: COLUMN_COLORS[col.key] }}
              >
                <span className="cell-label">{col.label}</span>
                <span className="cell-value">{taskCounts[col.key] || 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Cron Faults */}
        <div className="panel">
          <div className="panel-header">
            <h2>Cron Faults</h2>
            <span className="panel-badge">{overview?.cron?.total || 0} jobs</span>
          </div>
          <div className="stack">
            {(overview?.cron?.errors || []).length === 0
              ? <div className="empty">✓ No active cron errors</div>
              : (overview.cron.errors.map((job) => (
                  <div className="row-card" key={job.id || job.name}>
                    <div className="row-card-body">
                      <strong>{job.name || job.id}</strong>
                    </div>
                    <span className="status-pill error">error</span>
                  </div>
                )))}
          </div>
        </div>

        {/* Recent Pipeline */}
        <div className="panel">
          <div className="panel-header">
            <h2>Recent Pipeline</h2>
            <span className="panel-badge">{pipeline?.total || 0} leads</span>
          </div>
          <div className="stack">
            {(pipeline?.recent || []).length === 0
              ? <div className="empty">No pipeline data</div>
              : [...(pipeline?.recent || [])].reverse().map((job, i) => (
                  <div className="row-card" key={`${job.company}-${i}`}>
                    <div className="row-card-body">
                      <strong>{job.company || 'Unknown'}</strong>
                      <span>{job.title || 'Untitled role'}</span>
                    </div>
                    <span className={`status-pill ${statusClass(job.status)}`}>{job.status || 'new'}</span>
                  </div>
                ))}
          </div>
        </div>

        {/* Credential Surface */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>Credential Surface</h2>
            <span className="panel-badge">{activeCredits} active</span>
          </div>
          <div className="chip-grid">
            {Object.entries(credits || {}).map(([key, value]) => (
              <span key={key} className={`chip ${value ? 'on' : 'off'}`}>
                {key}: {value ? '✓ active' : '✗ missing'}
              </span>
            ))}
          </div>
        </div>

        {/* Cron Health Summary */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>Cron Health</h2>
            <span className="panel-badge">{cronJobs.length} tracked</span>
          </div>
          <div className="status-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {[
              { label: 'OK', key: 'ok', color: 'var(--green)' },
              { label: 'Error', key: 'error', color: 'var(--red)' },
              { label: 'Stale', key: 'stale', color: 'var(--yellow)' },
              { label: 'Paused', key: 'paused', color: 'var(--muted)' },
            ].map((s) => (
              <div key={s.key} className="status-cell" style={{ borderLeftColor: s.color }}>
                <span className="cell-label">{s.label}</span>
                <span className="cell-value">{cronHealth[s.key] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
