import { useEffect, useState } from 'react'

const TAB_ICONS = {
  overview: '●',
  chat: '↯',
  kanban: '⊞',
  cron: '⏱',
  pipeline: '↑',
  config: '⚙',
  scripts: '▶',
  container: '⬡',
  soul: '◎',
}

export default function Topbar({
  overview,
  loading,
  busyKey,
  activeTab,
  tabs,
  onRefresh,
  onRestart,
  onTabChange,
  apiToken,
  onApiTokenChange,
}) {
  const [uptimeSecs, setUptimeSecs] = useState(0)
  const containerStatus = overview?.container?.status || 'unknown'
  const statusCls = containerStatus.replaceAll('_', '-')

  useEffect(() => {
    const id = setInterval(() => setUptimeSecs((value) => value + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const h = Math.floor(uptimeSecs / 3600)
  const m = Math.floor((uptimeSecs % 3600) / 60)
  const s = uptimeSecs % 60
  const uptimeStr = h > 0
    ? `${h}h ${m.toString().padStart(2, '0')}m`
    : `${m}m ${s.toString().padStart(2, '0')}s`

  return (
    <>
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
          <input
            aria-label="SAQR API token"
            className="token-input"
            type="password"
            value={apiToken}
            onChange={(event) => onApiTokenChange(event.target.value)}
            placeholder="SAQR token"
            title="Stored locally and sent as a Bearer token"
          />
          <span className={`status-pill ${statusCls}`}>{containerStatus}</span>
          <button onClick={onRefresh} disabled={loading} title="Refresh all data">
            {loading ? 'Loading' : '↻ Refresh'}
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
