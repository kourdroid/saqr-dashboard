import { useEffect, useState } from 'react'

function formatUptime() {
  // We approximate uptime from when the page was loaded
  return null
}

const TAB_ICONS = {
  overview:  '◈',
  kanban:    '⊞',
  cron:      '⏱',
  pipeline:  '↑',
  config:    '⚙',
  scripts:   '▶',
  container: '⬡',
  soul:      '◎',
}

export default function Topbar({ overview, loading, busyKey, activeTab, tabs, onRefresh, onRestart, onTabChange }) {
  const [tick, setTick] = useState(0)
  const [pageLoadTime] = useState(() => Date.now())
  const containerStatus = overview?.container?.status || 'unknown'
  const statusCls = containerStatus.replaceAll('_', '-')

  // Tick every second for uptime display
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const uptimeSecs = Math.floor((Date.now() - pageLoadTime) / 1000)
  const h = Math.floor(uptimeSecs / 3600)
  const m = Math.floor((uptimeSecs % 3600) / 60)
  const s = uptimeSecs % 60
  const uptimeStr = h > 0
    ? `${h}h ${m.toString().padStart(2,'0')}m`
    : `${m}m ${s.toString().padStart(2,'0')}s`

  return (
    <>
      {/* ── Header bar ── */}
      <header className="topbar">
        <div className="brand-col">
          <div className="brand-row">
            <span className="brand-mark">SAQR</span>
            <span className={`status-dot ${statusCls}`} title={`Container: ${containerStatus}`} />
            <span className="uptime-badge">↑ {uptimeStr}</span>
          </div>
          <div className="subtitle">Hermes Agent Command Center</div>
        </div>

        <div className="topbar-actions">
          <span className={`status-pill ${statusCls}`}>{containerStatus}</span>
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh all data"
          >
            {loading
              ? <><span style={{ display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.2)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin 0.7s linear infinite',marginRight:6,verticalAlign:'middle' }} />Loading</>
              : '↺ Refresh'}
          </button>
          <button
            className="danger"
            onClick={onRestart}
            disabled={busyKey === 'restart-container'}
            title="Restart Hermes container"
          >
            ⟳ Restart
          </button>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <nav className="tabs" aria-label="Command center sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => onTabChange(tab.key)}
            aria-current={activeTab === tab.key ? 'page' : undefined}
          >
            <span className="tab-icon">{TAB_ICONS[tab.key]}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </>
  )
}
