function formatBytes(value) {
  if (!Number.isFinite(value)) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

export default function ScriptsPage({ scripts, envKeys, scriptOutput, busyKey, onRun }) {
  return (
    <section className="page-section">
      <div className="page-grid">
        <div className="panel span-2">
          <div className="panel-header">
            <h2>Agent Scripts</h2>
            <span className="panel-badge">{scripts.length} discovered</span>
          </div>
          {scripts.length === 0
            ? <div className="stack"><div className="empty">No scripts found</div></div>
            : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Modified</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {scripts.map((script) => (
                    <tr key={script.name}>
                      <td>
                        <span
                          style={{
                            fontFamily: 'Cascadia Code, monospace',
                            fontSize: 12.5,
                            color: script.name.endsWith('.py') ? 'var(--blue)' : 'var(--green)',
                          }}
                        >
                          {script.name}
                        </span>
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{formatBytes(script.size)}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{formatTime(script.modified)}</td>
                      <td>
                        <button
                          className="primary"
                          onClick={() => onRun(script.name)}
                          disabled={!script.runnable || busyKey === `script-${script.name}`}
                          style={{ minHeight: 28, padding: '4px 12px', fontSize: 12 }}
                          title={script.runnable ? 'Run script' : 'Not in SAQR_ALLOWED_SCRIPTS'}
                        >
                          {busyKey === `script-${script.name}` ? <span className="spinner" /> : script.runnable ? 'Run' : 'Locked'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Environment Keys</h2>
            <span className="panel-badge">{envKeys.length}</span>
          </div>
          <div className="chip-grid">
            {envKeys.length === 0
              ? <div className="empty" style={{ width: '100%' }}>No env keys</div>
              : envKeys.map((key) => (
                <span key={key} className="chip" style={{ fontFamily: 'Cascadia Code, monospace', fontSize: 11 }}>
                  {key}
                </span>
              ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Script Output</h2>
            <span className="panel-badge">{scriptOutput?.name || 'none'}</span>
          </div>
          <div style={{ padding: 14 }}>
            <pre className="log-box" style={{ minHeight: 120 }}>
              {scriptOutput
                ? (scriptOutput.result.stdout || scriptOutput.result.stderr || JSON.stringify(scriptOutput.result, null, 2))
                : 'No script output yet. Run an allowlisted script above.'}
            </pre>
            {scriptOutput && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <span className={`status-pill ${scriptOutput.result.ok ? 'ok' : 'error'}`}>
                  {scriptOutput.result.ok ? 'success' : 'failed'} (exit {scriptOutput.result.returncode ?? '?'})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
