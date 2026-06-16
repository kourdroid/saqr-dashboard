export default function ContainerPanel({ container, logs, busyKey, onInspect, onLoadLogs, onRestart }) {
  const stats = container?.stats?.stdout?.trim()
  const inspect = container?.inspect?.stdout?.trim()

  // Parse stats line: CPUPerc\tMemUsage\tNetIO
  let cpuPerc = null, memUsage = null, netIO = null
  if (stats) {
    const parts = stats.split('\t')
    if (parts.length >= 3) {
      cpuPerc = parts[0]
      memUsage = parts[1]
      netIO = parts[2]
    }
  }

  // Parse inspect line: status\tStartedAt\tImage
  let containerStatus = null, startedAt = null, image = null
  if (inspect) {
    const parts = inspect.split('\t')
    if (parts.length >= 3) {
      containerStatus = parts[0]
      startedAt = parts[1]
      image = parts[2]
    }
  }

  return (
    <section className="page-section">
      <div className="page-grid">
        {/* Stats Overview */}
        {container && (
          <div className="panel span-2">
            <div className="panel-header">
              <h2>Container Metrics</h2>
              {containerStatus && (
                <span className={`status-pill ${String(containerStatus).replaceAll('_', '-')}`}>
                  {containerStatus}
                </span>
              )}
            </div>
            <div className="status-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="status-cell" style={{ borderLeftColor: 'var(--blue)' }}>
                <span className="cell-label">CPU</span>
                <span className="cell-value" style={{ fontSize: 18 }}>{cpuPerc || '—'}</span>
              </div>
              <div className="status-cell" style={{ borderLeftColor: 'var(--violet)' }}>
                <span className="cell-label">Memory</span>
                <span className="cell-value" style={{ fontSize: 18 }}>{memUsage || '—'}</span>
              </div>
              <div className="status-cell" style={{ borderLeftColor: 'var(--green)' }}>
                <span className="cell-label">Network I/O</span>
                <span className="cell-value" style={{ fontSize: 18 }}>{netIO || '—'}</span>
              </div>
            </div>
            {image && (
              <div style={{ padding: '8px 16px 12px', fontSize: 12, color: 'var(--muted)' }}>
                Image: <code style={{ color: 'var(--yellow)' }}>{image}</code>
                {startedAt && <> · Started: <span style={{ color: 'var(--text-2)' }}>{new Date(startedAt).toLocaleString()}</span></>}
              </div>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>⬡ Container Control</h2>
            <div className="table-actions">
              <button onClick={onInspect} disabled={busyKey === 'container-info'}>
                {busyKey === 'container-info' ? '…' : '🔍 Inspect'}
              </button>
              <button onClick={onLoadLogs} disabled={busyKey === 'container-logs'}>
                {busyKey === 'container-logs' ? '…' : '📋 Load Logs'}
              </button>
              <button className="danger" onClick={onRestart} disabled={busyKey === 'restart-container'}>
                {busyKey === 'restart-container' ? '…' : '⟳ Restart'}
              </button>
            </div>
          </div>
          {!container && (
            <div className="stack">
              <div className="empty">Click Inspect to load container information</div>
            </div>
          )}
        </div>

        {/* Raw Inspect JSON */}
        {container && (
          <div className="panel span-2">
            <div className="panel-header">
              <h2>Inspect JSON</h2>
            </div>
            <div style={{ padding: 14 }}>
              <pre className="log-box">{JSON.stringify(container, null, 2)}</pre>
            </div>
          </div>
        )}

        {/* Logs */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>Recent Logs</h2>
            <span className="panel-badge">tail 120</span>
          </div>
          <div style={{ padding: 14 }}>
            <pre className="log-box tall">
              {logs || 'No logs loaded. Click "Load Logs" above.'}
            </pre>
          </div>
        </div>
      </div>
    </section>
  )
}
