import { useState, useEffect, useCallback } from 'react'
import './App.css'

const API = ''
const COLUMNS = [
  { key: 'backlog', label: 'Backlog', color: '#6b7280' },
  { key: 'ready', label: 'Ready', color: '#3b82f6' },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { key: 'blocked', label: 'Blocked', color: '#ef4444' },
  { key: 'done', label: 'Done', color: '#22c55e' },
]

function api(path, opts = {}) {
  return fetch(API + '/api' + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  }).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() })
}

function App() {
  const [tab, setTab] = useState('kanban')
  const [tasks, setTasks] = useState([])
  const [cronJobs, setCronJobs] = useState([])
  const [pipeline, setPipeline] = useState(null)
  const [credits, setCredits] = useState({})
  const [config, setConfig] = useState(null)
  const [configText, setConfigText] = useState('')
  const [soul, setSoul] = useState(null)
  const [container, setContainer] = useState(null)
  const [logs, setLogs] = useState('')
  const [newTitle, setNewTitle] = useState('')

  const load = useCallback(async () => {
    try {
      setTasks(await api('/kanban-tasks'))
      setCronJobs(await api('/cron-jobs'))
      setPipeline(await api('/pipeline'))
      setCredits(await api('/credits'))
      setSoul(await api('/soul-summary'))
      const cfg = await api('/config')
      setConfig(cfg)
      setConfigText(cfg.raw || '')
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i) }, [load])

  const addTask = async () => {
    if (!newTitle.trim()) return
    await api('/kanban-tasks', { method: 'POST', body: JSON.stringify({ title: newTitle, status: 'backlog' }) })
    setNewTitle('')
    load()
  }

  const moveTask = async (id, status) => {
    await api('/kanban-tasks/' + id, { method: 'PATCH', body: JSON.stringify({ status }) })
    load()
  }

  const deleteTask = async (id) => {
    await api('/kanban-tasks/' + id, { method: 'DELETE' })
    load()
  }

  const toggleCron = async (id) => {
    await api('/cron/' + id + '/toggle', { method: 'POST' })
    load()
  }

  const restartContainer = async () => {
    await api('/container/restart', { method: 'POST' })
    setTimeout(load, 5000)
  }

  const loadLogs = async () => {
    const l = await api('/container/logs?lines=50')
    setLogs(l.stdout || l.stderr || 'no logs')
  }

  const saveConfig = async () => {
    await api('/config/raw', { method: 'PUT', body: JSON.stringify({ text: configText }) })
    alert('Config saved. Restart container to apply.')
  }

  const loadContainerInfo = async () => {
    const c = await api('/container')
    setContainer(c)
  }

  const groupByStatus = (status) => tasks.filter(t => t.status === status)

  return (
    <div className="app">
      <header>
        <div className="logo">◈ SAQR</div>
        <div className="subtitle">Command Center</div>
        <div className="header-actions">
          <span className="badge">{cronJobs.filter(j => j.health === 'error').length} errors</span>
          <span className="badge green">{pipeline?.kourchal?.applied || 0} sent today</span>
        </div>
      </header>

      <nav>
        {['kanban', 'config', 'cron', 'pipeline', 'credits', 'container', 'soul'].map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); if (t === 'container') loadContainerInfo(); if (t === 'logs') loadLogs() }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'kanban' && (
          <section>
            <div className="add-form">
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="New task..." onKeyDown={e => e.key === 'Enter' && addTask()} />
              <button onClick={addTask}>+ Add</button>
            </div>
            <div className="kanban">
              {COLUMNS.map(col => (
                <div key={col.key} className="kanban-col" onDragOver={e => e.preventDefault()} onDrop={e => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/plain')
                  moveTask(id, col.key)
                }}>
                  <div className="col-header" style={{ borderLeftColor: col.color }}>
                    <span>{col.label}</span>
                    <span className="count">{groupByStatus(col.key).length}</span>
                  </div>
                  <div className="col-body">
                    {groupByStatus(col.key).map(t => (
                      <div key={t.id} className="card" draggable onDragStart={e => e.dataTransfer.setData('text/plain', t.id)}>
                        <div className="card-title">{t.title}</div>
                        {t.body && <div className="card-body">{t.body}</div>}
                        <div className="card-actions">
                          {t.priority > 0 && <span className={'pri pri-' + t.priority}>{['', 'High', 'Critical'][t.priority]}</span>}
                          <button className="del" onClick={() => deleteTask(t.id)}>×</button>
                        </div>
                      </div>
                    ))}
                    {groupByStatus(col.key).length === 0 && <div className="empty">Drop tasks here</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'config' && (
          <section>
            <h2>LLM Configuration</h2>
            <div className="config-grid">
              <div className="config-card">
                <label>Model</label>
                <input value={config?.model?.default || ''} onChange={e => setConfig(prev => ({ ...prev, model: { ...prev?.model, default: e.target.value } }))} />
              </div>
              <div className="config-card">
                <label>Provider</label>
                <input value={config?.model?.provider || ''} onChange={e => setConfig(prev => ({ ...prev, model: { ...prev?.model, provider: e.target.value } }))} />
              </div>
              <div className="config-card">
                <label>Base URL</label>
                <input value={config?.model?.base_url || ''} onChange={e => setConfig(prev => ({ ...prev, model: { ...prev?.model, base_url: e.target.value } }))} />
              </div>
              <div className="config-card">
                <label>Max Turns</label>
                <input type="number" value={config?.agent?.max_turns || 90} onChange={e => setConfig(prev => ({ ...prev, agent: { ...prev?.agent, max_turns: parseInt(e.target.value) } }))} />
              </div>
            </div>
            <button onClick={saveConfig} className="btn-primary">Save Config</button>
            <button onClick={restartContainer} className="btn-warn" style={{ marginLeft: 8 }}>Restart Container</button>

            <h3 style={{ marginTop: 24 }}>Raw YAML</h3>
            <textarea value={configText} onChange={e => setConfigText(e.target.value)} rows={15} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, background: '#111', color: '#e2e8f0', border: '1px solid #333', borderRadius: 6, padding: 12 }} />
            <button onClick={saveConfig} className="btn-primary" style={{ marginTop: 8 }}>Save Raw</button>
          </section>
        )}

        {tab === 'cron' && (
          <section>
            <h2>Cron Jobs</h2>
            <table className="cron-table">
              <thead>
                <tr><th>Job</th><th>Schedule</th><th>Health</th><th>Last Run</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {cronJobs.map(j => (
                  <tr key={j.id}>
                    <td><strong>{j.name}</strong></td>
                    <td><code>{j.schedule?.expr || '-'}</code></td>
                    <td><span className={'health ' + j.health}>{j.health}</span></td>
                    <td className="muted">{j.last_run_at ? new Date(j.last_run_at).toLocaleString() : '-'}</td>
                    <td>
                      <button className={'btn-small ' + (j.enabled ? 'btn-green' : 'btn-gray')} onClick={() => toggleCron(j.id)}>
                        {j.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === 'pipeline' && (
          <section>
            <h2>Job Pipeline</h2>
            <div className="stats-row">
              <div className="stat-card">
                <div className="num">{pipeline?.mehdi?.total || 0}</div>
                <div className="label">Mehdi Leads</div>
              </div>
              <div className="stat-card">
                <div className="num">{pipeline?.mehdi?.applied || 0}</div>
                <div className="label">Mehdi Applied</div>
              </div>
              <div className="stat-card">
                <div className="num">{pipeline?.kourchal?.total || 0}</div>
                <div className="label">Mohammed Leads</div>
              </div>
              <div className="stat-card">
                <div className="num">{pipeline?.kourchal?.applied || 0}</div>
                <div className="label">Mohammed Applied</div>
              </div>
            </div>
            {pipeline?.recent && (
              <>
                <h3>Recent</h3>
                {pipeline.recent.slice().reverse().map((j, i) => (
                  <div key={i} className="job-item">
                    <strong>{j.company}</strong> — {j.title}
                    <span className={'tag ' + j.status}>{j.status}</span>
                  </div>
                ))}
              </>
            )}
          </section>
        )}

        {tab === 'credits' && (
          <section>
            <h2>API Credits</h2>
            <div className="credits-grid">
              {Object.entries(credits).map(([k, v]) => (
                <div key={k} className="credit-card">
                  <div className="key-name">{k}</div>
                  <div className={'key-status ' + (v ? 'active' : 'inactive')}>{v ? '✓ Active' : '✗ Missing'}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'container' && (
          <section>
            <h2>Container</h2>
            <button onClick={loadContainerInfo} className="btn-primary">Refresh</button>
            <button onClick={restartContainer} className="btn-warn" style={{ marginLeft: 8 }}>Restart Container</button>
            <button onClick={loadLogs} className="btn-gray" style={{ marginLeft: 8 }}>Load Logs</button>
            {container && (
              <pre className="log-box">
                {JSON.stringify(container, null, 2)}
              </pre>
            )}
            {logs && (
              <>
                <h3 style={{ marginTop: 16 }}>Recent Logs</h3>
                <pre className="log-box">{logs}</pre>
              </>
            )}
          </section>
        )}

        {tab === 'soul' && (
          <section>
            <h2>Missions</h2>
            {soul?.missions?.map((m, i) => (
              <div key={i} className="mission-item">P{i + 1}: {m}</div>
            ))}
            <h3 style={{ marginTop: 24 }}>Cron Schedule</h3>
            <table className="cron-table">
              <thead><tr><th>Time</th><th>Job</th><th>Profile</th><th>Deliver</th></tr></thead>
              <tbody>
                {soul?.schedule?.map((s, i) => (
                  <tr key={i}><td>{s.time}</td><td><strong>{s.job}</strong></td><td>{s.profile}</td><td>{s.deliver}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
