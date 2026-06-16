function statusClass(value) {
  return String(value || 'unknown').replaceAll('_', '-')
}

const PROFILE_META = {
  mehdi:    { label: 'Mehdi',    icon: '🐦', color: 'var(--blue)' },
  kourchal: { label: 'Mohammed', icon: '🛡️', color: 'var(--violet)' },
}

export default function PipelinePage({ pipeline }) {
  const profiles = ['mehdi', 'kourchal']

  return (
    <section className="page-section">
      <div className="page-grid">
        {/* Profile stat panels */}
        {profiles.map((profile) => {
          const meta = PROFILE_META[profile]
          const data = pipeline?.[profile] || {}
          const rate = data.total > 0
            ? Math.round((data.applied / data.total) * 100)
            : 0

          return (
            <div className="panel" key={profile}>
              <div className="panel-header">
                <h2>{meta.icon} {meta.label}</h2>
                <span className="panel-badge">{data.total || 0} leads</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '14px 16px' }}>
                <div className="pipeline-stat">
                  <div className="pipeline-stat-value" style={{ color: meta.color }}>{data.total || 0}</div>
                  <div className="pipeline-stat-label">Total Leads</div>
                </div>
                <div className="pipeline-stat">
                  <div className="pipeline-stat-value" style={{ color: 'var(--green)' }}>{data.applied || 0}</div>
                  <div className="pipeline-stat-label">Applied</div>
                </div>
              </div>
              {/* Conversion bar */}
              <div style={{ padding: '0 16px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Conversion</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 700 }}>{rate}%</span>
                </div>
                <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${rate}%`,
                    background: `linear-gradient(90deg, ${meta.color}, var(--green))`,
                    borderRadius: 99,
                    transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            </div>
          )
        })}

        {/* Recent Leads */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>Recent Leads</h2>
            <span className="panel-badge">{pipeline?.total || 0} total</span>
          </div>
          <div className="stack">
            {(pipeline?.recent || []).length === 0
              ? <div className="empty">No pipeline data</div>
              : [...(pipeline?.recent || [])].reverse().map((job, i) => (
                <div className="row-card" key={`${job.company}-${job.title}-${i}`}>
                  <div className="row-card-body">
                    <strong>{job.company || '—'}</strong>
                    <span>{job.title || '—'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {job.profile && (
                      <span style={{ fontSize: 11, color: 'var(--faint)' }}>
                        {PROFILE_META[job.profile]?.icon || ''} {PROFILE_META[job.profile]?.label || job.profile}
                      </span>
                    )}
                    <span className={`status-pill ${statusClass(job.status)}`}>{job.status || 'new'}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </section>
  )
}
