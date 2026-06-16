export default function MissionsPage({ soul }) {
  const missions = soul?.missions || []
  const schedule = soul?.schedule || []

  return (
    <section className="page-section">
      <div className="page-grid">
        {/* Missions */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>◎ Agent Missions</h2>
            <span className="panel-badge">{missions.length} defined</span>
          </div>
          <div className="stack">
            {missions.length === 0
              ? <div className="empty">No missions found in SOUL.md</div>
              : missions.map((mission, i) => (
                <div
                  key={`${mission}-${i}`}
                  className="row-card"
                  style={{
                    borderLeft: '3px solid var(--accent)',
                    animationDelay: `${i * 60}ms`,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-glow)',
                    fontSize: 12,
                    fontWeight: 800,
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}>
                    P{i + 1}
                  </div>
                  <div className="row-card-body" style={{ flex: 1 }}>
                    <strong style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>{mission}</strong>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Schedule Summary */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>Cron Schedule</h2>
            <span className="panel-badge">{schedule.length} entries</span>
          </div>
          {schedule.length === 0
            ? <div className="stack"><div className="empty">No schedule data in SOUL.md</div></div>
            : (
            <table>
              <thead>
                <tr>
                  <th>Time (UTC)</th>
                  <th>Job</th>
                  <th>Profile</th>
                  <th>Deliver To</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((item, i) => (
                  <tr key={`${item.time}-${item.job}-${i}`}>
                    <td><code>{item.time}</code></td>
                    <td><strong style={{ color: 'var(--text)' }}>{item.job}</strong></td>
                    <td style={{ color: 'var(--muted)' }}>{item.profile}</td>
                    <td style={{ color: 'var(--muted)' }}>{item.deliver}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )
}
