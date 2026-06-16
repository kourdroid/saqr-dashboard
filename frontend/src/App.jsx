import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const API = ''

const COLUMNS = [
  { key: 'backlog', label: 'Backlog', color: '#64748b' },
  { key: 'ready', label: 'Ready', color: '#2563eb' },
  { key: 'in_progress', label: 'In Progress', color: '#d97706' },
  { key: 'blocked', label: 'Blocked', color: '#dc2626' },
  { key: 'done', label: 'Done', color: '#16a34a' },
]

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'cron', label: 'Cron' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'config', label: 'Config' },
  { key: 'scripts', label: 'Scripts' },
  { key: 'container', label: 'Container' },
  { key: 'soul', label: 'Missions' },
]

async function api(path, opts = {}) {
  const response = await fetch(API + '/api' + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })

  if (!response.ok) {
    const text = await response.text()
    let message = text || response.statusText
    try {
      const parsed = JSON.parse(text)
      message = parsed.detail || message
    } catch {
      // Keep the plain-text server response.
    }
    throw new Error(message)
  }

  return response.json()
}

async function fetchSnapshot() {
  const [overview, tasks, cronJobs, pipeline, credits, config, soul, env, scripts] = await Promise.all([
    api('/overview'),
    api('/kanban-tasks'),
    api('/cron-jobs'),
    api('/pipeline'),
    api('/credits'),
    api('/config'),
    api('/soul-summary'),
    api('/env'),
    api('/scripts'),
  ])

  return { overview, tasks, cronJobs, pipeline, credits, config, soul, env, scripts }
}

function formatTime(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function statusClass(value) {
  return String(value || 'unknown').replaceAll('_', '-')
}

function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [overview, setOverview] = useState(null)
  const [tasks, setTasks] = useState([])
  const [cronJobs, setCronJobs] = useState([])
  const [pipeline, setPipeline] = useState(null)
  const [credits, setCredits] = useState({})
  const [config, setConfig] = useState(null)
  const [configText, setConfigText] = useState('')
  const [configTextDirty, setConfigTextDirty] = useState(false)
  const [soul, setSoul] = useState(null)
  const [envKeys, setEnvKeys] = useState([])
  const [scripts, setScripts] = useState([])
  const [container, setContainer] = useState(null)
  const [logs, setLogs] = useState('')
  const [scriptOutput, setScriptOutput] = useState(null)
  const [newTask, setNewTask] = useState({ title: '', status: 'backlog', priority: 0 })
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const applySnapshot = useCallback((snapshot) => {
    setOverview(snapshot.overview)
    setTasks(snapshot.tasks)
    setCronJobs(snapshot.cronJobs)
    setPipeline(snapshot.pipeline)
    setCredits(snapshot.credits)
    setConfig(snapshot.config)
    setSoul(snapshot.soul)
    setEnvKeys(snapshot.env.keys || [])
    setScripts(snapshot.scripts)
    if (!configTextDirty) {
      setConfigText(snapshot.config.raw || '')
    }
  }, [configTextDirty])

  const refreshNow = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const snapshot = await fetchSnapshot()
      applySnapshot(snapshot)
      setError('')
      if (!silent) setMessage('Dashboard refreshed')
    } catch (cause) {
      setError(cause.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [applySnapshot])

  useEffect(() => {
    let cancelled = false

    const tick = () => {
      fetchSnapshot()
        .then((snapshot) => {
          if (!cancelled) {
            applySnapshot(snapshot)
            setError('')
          }
        })
        .catch((cause) => {
          if (!cancelled) setError(cause.message)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }

    const starter = window.setTimeout(tick, 0)
    const interval = window.setInterval(tick, 15000)
    return () => {
      cancelled = true
      window.clearTimeout(starter)
      window.clearInterval(interval)
    }
  }, [applySnapshot])

  const groupedTasks = useMemo(() => {
    return COLUMNS.reduce((acc, column) => {
      acc[column.key] = tasks.filter((task) => task.status === column.key)
      return acc
    }, {})
  }, [tasks])

  const runAction = async (key, action, success) => {
    setBusyKey(key)
    setMessage('')
    setError('')
    try {
      const result = await action()
      setMessage(success)
      await refreshNow(true)
      return result
    } catch (cause) {
      setError(cause.message)
      return null
    } finally {
      setBusyKey('')
    }
  }

  const addTask = async () => {
    const title = newTask.title.trim()
    if (!title) return
    await runAction(
      'add-task',
      () => api('/kanban-tasks', {
        method: 'POST',
        body: JSON.stringify({ title, status: newTask.status, priority: Number(newTask.priority) }),
      }),
      'Task added',
    )
    setNewTask((current) => ({ ...current, title: '' }))
  }

  const moveTask = async (id, status) => {
    await runAction(
      `move-${id}`,
      () => api('/kanban-tasks/' + id, { method: 'PATCH', body: JSON.stringify({ status }) }),
      'Task moved',
    )
  }

  const deleteTask = async (id) => {
    await runAction(
      `delete-${id}`,
      () => api('/kanban-tasks/' + id, { method: 'DELETE' }),
      'Task deleted',
    )
  }

  const toggleCron = async (id) => {
    await runAction(
      `cron-${id}`,
      () => api('/cron/' + id + '/toggle', { method: 'POST' }),
      'Cron state updated',
    )
  }

  const triggerCron = async (id) => {
    await runAction(
      `trigger-${id}`,
      () => api('/cron/' + id + '/trigger', { method: 'POST' }),
      'Cron trigger requested',
    )
  }

  const saveStructuredConfig = async () => {
    await runAction(
      'save-config',
      () => api('/config', {
        method: 'PUT',
        body: JSON.stringify({
          model: config?.model?.default || '',
          provider: config?.model?.provider || '',
          base_url: config?.model?.base_url || '',
          max_turns: Number(config?.agent?.max_turns || 0),
          temperature: config?.model?.temperature === undefined ? undefined : Number(config.model.temperature),
        }),
      }),
      'Config fields saved',
    )
  }

  const saveRawConfig = async () => {
    await runAction(
      'save-raw-config',
      () => api('/config/raw', { method: 'PUT', body: JSON.stringify({ text: configText }) }),
      'Raw config saved',
    )
    setConfigTextDirty(false)
  }

  const restartContainer = async () => {
    await runAction(
      'restart-container',
      () => api('/container/restart', { method: 'POST' }),
      'Container restart requested',
    )
  }

  const loadContainerInfo = async () => {
    const result = await runAction('container-info', () => api('/container'), 'Container snapshot loaded')
    if (result) setContainer(result)
  }

  const loadLogs = async () => {
    const result = await runAction('container-logs', () => api('/container/logs?lines=120'), 'Logs loaded')
    if (result) setLogs(result.stdout || result.stderr || 'no logs')
  }

  const runScript = async (name) => {
    const result = await runAction(
      `script-${name}`,
      () => api('/scripts/' + encodeURIComponent(name) + '/run', { method: 'POST' }),
      'Script finished',
    )
    if (result) setScriptOutput({ name, result })
  }

  const activeCredits = Object.values(credits).filter(Boolean).length
  const cronHealth = overview?.cron?.by_health || {}
  const taskCounts = overview?.tasks?.by_status || {}
  const containerStatus = overview?.container?.status || 'unknown'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-row">
            <span className="brand-mark">SAQR</span>
            <span className={'status-dot ' + statusClass(containerStatus)} />
          </div>
          <div className="subtitle">Hermes Agent Command Center</div>
        </div>
        <div className="topbar-actions">
          <span className={'status-pill ' + statusClass(containerStatus)}>{containerStatus}</span>
          <button onClick={() => refreshNow(false)} disabled={loading || busyKey === 'refresh'}>
            {loading ? 'Loading' : 'Refresh'}
          </button>
          <button className="danger" onClick={restartContainer} disabled={busyKey === 'restart-container'}>
            Restart
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Command center sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? 'active' : ''}
            onClick={() => {
              setActiveTab(tab.key)
              if (tab.key === 'container') void loadContainerInfo()
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {(message || error) && (
        <div className={'notice ' + (error ? 'error' : 'ok')}>
          {error || message}
        </div>
      )}

      <main>
        {activeTab === 'overview' && (
          <section className="page-grid">
            <div className="metric-card">
              <span>Container</span>
              <strong>{containerStatus}</strong>
              <small>{overview?.generated_at ? `Updated ${formatTime(overview.generated_at)}` : 'Awaiting pulse'}</small>
            </div>
            <div className="metric-card">
              <span>Tasks</span>
              <strong>{overview?.tasks?.total || 0}</strong>
              <small>{taskCounts.blocked || 0} blocked, {overview?.tasks?.critical || 0} critical</small>
            </div>
            <div className="metric-card">
              <span>Cron</span>
              <strong>{cronHealth.error || 0}</strong>
              <small>{cronHealth.ok || 0} ok, {cronHealth.stale || 0} stale</small>
            </div>
            <div className="metric-card">
              <span>Pipeline</span>
              <strong>{pipeline?.total || 0}</strong>
              <small>{(pipeline?.mehdi?.applied || 0) + (pipeline?.kourchal?.applied || 0)} applied</small>
            </div>
            <div className="metric-card">
              <span>API Keys</span>
              <strong>{activeCredits}/{Object.keys(credits).length}</strong>
              <small>{envKeys.length} env keys visible</small>
            </div>
            <div className="metric-card">
              <span>Model</span>
              <strong>{overview?.config?.model?.default || '-'}</strong>
              <small>{overview?.config?.model?.provider || 'provider unset'}</small>
            </div>

            <div className="panel span-2">
              <div className="panel-header">
                <h2>Operations Pulse</h2>
                <span>{overview?.config?.agent?.max_turns || '-'} max turns</span>
              </div>
              <div className="status-grid">
                {COLUMNS.map((column) => (
                  <div key={column.key} className="status-cell" style={{ borderColor: column.color }}>
                    <span>{column.label}</span>
                    <strong>{taskCounts[column.key] || 0}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>Cron Faults</h2>
                <span>{overview?.cron?.total || 0} jobs</span>
              </div>
              <div className="stack">
                {(overview?.cron?.errors || []).length === 0 && <div className="empty">No active cron errors</div>}
                {(overview?.cron?.errors || []).map((job) => (
                  <div className="row-card" key={job.id || job.name}>
                    <strong>{job.name || job.id}</strong>
                    <span className="status-pill error">error</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>Recent Pipeline</h2>
                <span>{pipeline?.total || 0} leads</span>
              </div>
              <div className="stack">
                {(pipeline?.recent || []).slice().reverse().map((job, index) => (
                  <div className="row-card" key={`${job.company || 'company'}-${index}`}>
                    <div>
                      <strong>{job.company || 'Unknown company'}</strong>
                      <span>{job.title || 'Untitled role'}</span>
                    </div>
                    <span className={'status-pill ' + statusClass(job.status)}>{job.status || 'new'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel span-2">
              <div className="panel-header">
                <h2>Credential Surface</h2>
                <span>{activeCredits} active</span>
              </div>
              <div className="chip-grid">
                {Object.entries(credits).map(([key, value]) => (
                  <span key={key} className={'chip ' + (value ? 'on' : 'off')}>
                    {key}: {value ? 'active' : 'missing'}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'kanban' && (
          <section>
            <div className="toolbar">
              <input
                value={newTask.title}
                onChange={(event) => setNewTask((current) => ({ ...current, title: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addTask()
                }}
                placeholder="New task"
              />
              <select
                value={newTask.status}
                onChange={(event) => setNewTask((current) => ({ ...current, status: event.target.value }))}
              >
                {COLUMNS.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
              </select>
              <select
                value={newTask.priority}
                onChange={(event) => setNewTask((current) => ({ ...current, priority: Number(event.target.value) }))}
              >
                <option value={0}>Normal</option>
                <option value={1}>High</option>
                <option value={2}>Critical</option>
              </select>
              <button onClick={addTask} disabled={busyKey === 'add-task'}>Add</button>
            </div>

            <div className="kanban">
              {COLUMNS.map((column) => (
                <div
                  key={column.key}
                  className="kanban-col"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const id = event.dataTransfer.getData('text/plain')
                    if (id) void moveTask(id, column.key)
                  }}
                >
                  <div className="col-header" style={{ borderLeftColor: column.color }}>
                    <span>{column.label}</span>
                    <strong>{groupedTasks[column.key]?.length || 0}</strong>
                  </div>
                  <div className="col-body">
                    {(groupedTasks[column.key] || []).map((task) => (
                      <article
                        key={task.id}
                        className="task-card"
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData('text/plain', task.id)}
                      >
                        <div className="task-title">{task.title}</div>
                        {task.body && <p>{task.body}</p>}
                        <div className="task-meta">
                          {task.priority > 0 && <span className={'priority p' + task.priority}>{task.priority === 2 ? 'Critical' : 'High'}</span>}
                          {task.assignee && <span>{task.assignee}</span>}
                          <button onClick={() => deleteTask(task.id)} disabled={busyKey === `delete-${task.id}`}>Delete</button>
                        </div>
                      </article>
                    ))}
                    {(groupedTasks[column.key] || []).length === 0 && <div className="empty">Drop tasks here</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'cron' && (
          <section className="panel">
            <div className="panel-header">
              <h2>Cron Jobs</h2>
              <span>{cronJobs.length} tracked</span>
            </div>
            <table>
              <thead>
                <tr><th>Job</th><th>Schedule</th><th>Health</th><th>Last Run</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {cronJobs.map((job) => (
                  <tr key={job.id}>
                    <td><strong>{job.name}</strong></td>
                    <td><code>{job.schedule?.expr || '-'}</code></td>
                    <td><span className={'status-pill ' + statusClass(job.health)}>{job.health}</span></td>
                    <td>{formatTime(job.last_run_at)}</td>
                    <td className="table-actions">
                      <button onClick={() => toggleCron(job.id)} disabled={busyKey === `cron-${job.id}`}>
                        {job.enabled ? 'Pause' : 'Enable'}
                      </button>
                      <button onClick={() => triggerCron(job.id)} disabled={busyKey === `trigger-${job.id}`}>Trigger</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === 'pipeline' && (
          <section className="page-grid">
            {['mehdi', 'kourchal'].map((profile) => (
              <div className="panel" key={profile}>
                <div className="panel-header">
                  <h2>{profile === 'mehdi' ? 'Mehdi' : 'Mohammed'}</h2>
                  <span>{pipeline?.[profile]?.total || 0} leads</span>
                </div>
                <div className="status-grid two">
                  <div className="status-cell">
                    <span>Total</span>
                    <strong>{pipeline?.[profile]?.total || 0}</strong>
                  </div>
                  <div className="status-cell">
                    <span>Applied</span>
                    <strong>{pipeline?.[profile]?.applied || 0}</strong>
                  </div>
                </div>
              </div>
            ))}
            <div className="panel span-2">
              <div className="panel-header">
                <h2>Recent Leads</h2>
                <span>{pipeline?.total || 0} total</span>
              </div>
              <div className="stack">
                {(pipeline?.recent || []).slice().reverse().map((job, index) => (
                  <div className="row-card" key={`${job.company || 'company'}-${job.title || 'role'}-${index}`}>
                    <div>
                      <strong>{job.company || '-'}</strong>
                      <span>{job.title || '-'}</span>
                    </div>
                    <span className={'status-pill ' + statusClass(job.status)}>{job.status || 'new'}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'config' && (
          <section className="page-grid">
            <div className="panel span-2">
              <div className="panel-header">
                <h2>LLM Configuration</h2>
                <button onClick={saveStructuredConfig} disabled={busyKey === 'save-config'}>Save Fields</button>
              </div>
              <div className="form-grid">
                <label>
                  Model
                  <input value={config?.model?.default || ''} onChange={(event) => setConfig((current) => ({ ...current, model: { ...current?.model, default: event.target.value } }))} />
                </label>
                <label>
                  Provider
                  <input value={config?.model?.provider || ''} onChange={(event) => setConfig((current) => ({ ...current, model: { ...current?.model, provider: event.target.value } }))} />
                </label>
                <label>
                  Base URL
                  <input value={config?.model?.base_url || ''} onChange={(event) => setConfig((current) => ({ ...current, model: { ...current?.model, base_url: event.target.value } }))} />
                </label>
                <label>
                  Max Turns
                  <input type="number" min="1" value={config?.agent?.max_turns || ''} onChange={(event) => setConfig((current) => ({ ...current, agent: { ...current?.agent, max_turns: Number(event.target.value) } }))} />
                </label>
                <label>
                  Temperature
                  <input type="number" step="0.1" value={config?.model?.temperature ?? ''} onChange={(event) => setConfig((current) => ({ ...current, model: { ...current?.model, temperature: event.target.value } }))} />
                </label>
              </div>
            </div>
            <div className="panel span-2">
              <div className="panel-header">
                <h2>Raw YAML</h2>
                <div className="table-actions">
                  <button onClick={saveRawConfig} disabled={busyKey === 'save-raw-config'}>Save Raw</button>
                  <button className="danger" onClick={restartContainer} disabled={busyKey === 'restart-container'}>Restart</button>
                </div>
              </div>
              <textarea
                value={configText}
                onChange={(event) => {
                  setConfigText(event.target.value)
                  setConfigTextDirty(true)
                }}
                spellCheck="false"
              />
            </div>
          </section>
        )}

        {activeTab === 'scripts' && (
          <section className="page-grid">
            <div className="panel span-2">
              <div className="panel-header">
                <h2>Agent Scripts</h2>
                <span>{scripts.length} runnable</span>
              </div>
              <table>
                <thead>
                  <tr><th>Name</th><th>Size</th><th>Modified</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {scripts.map((script) => (
                    <tr key={script.name}>
                      <td><strong>{script.name}</strong></td>
                      <td>{formatBytes(script.size)}</td>
                      <td>{formatTime(script.modified)}</td>
                      <td><button onClick={() => runScript(script.name)} disabled={busyKey === `script-${script.name}`}>Run</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <div className="panel-header">
                <h2>Environment Keys</h2>
                <span>{envKeys.length}</span>
              </div>
              <div className="chip-grid">
                {envKeys.map((key) => <span className="chip" key={key}>{key}</span>)}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header">
                <h2>Script Output</h2>
                <span>{scriptOutput?.name || '-'}</span>
              </div>
              <pre className="log-box">{scriptOutput ? (scriptOutput.result.stdout || scriptOutput.result.stderr || JSON.stringify(scriptOutput.result, null, 2)) : 'No script output'}</pre>
            </div>
          </section>
        )}

        {activeTab === 'container' && (
          <section className="page-grid">
            <div className="panel span-2">
              <div className="panel-header">
                <h2>Container Control</h2>
                <div className="table-actions">
                  <button onClick={loadContainerInfo} disabled={busyKey === 'container-info'}>Inspect</button>
                  <button onClick={loadLogs} disabled={busyKey === 'container-logs'}>Logs</button>
                  <button className="danger" onClick={restartContainer} disabled={busyKey === 'restart-container'}>Restart</button>
                </div>
              </div>
              <pre className="log-box">{container ? JSON.stringify(container, null, 2) : 'No container snapshot loaded'}</pre>
            </div>
            <div className="panel span-2">
              <div className="panel-header">
                <h2>Recent Logs</h2>
                <span>tail 120</span>
              </div>
              <pre className="log-box tall">{logs || 'No logs loaded'}</pre>
            </div>
          </section>
        )}

        {activeTab === 'soul' && (
          <section className="page-grid">
            <div className="panel">
              <div className="panel-header">
                <h2>Missions</h2>
                <span>{soul?.missions?.length || 0}</span>
              </div>
              <div className="stack">
                {(soul?.missions || []).map((mission, index) => (
                  <div className="row-card" key={`${mission}-${index}`}>
                    <strong>P{index + 1}</strong>
                    <span>{mission}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header">
                <h2>Schedule</h2>
                <span>{soul?.schedule?.length || 0}</span>
              </div>
              <table>
                <thead><tr><th>Time</th><th>Job</th><th>Profile</th><th>Deliver</th></tr></thead>
                <tbody>
                  {(soul?.schedule || []).map((item, index) => (
                    <tr key={`${item.time}-${item.job}-${index}`}>
                      <td>{item.time}</td>
                      <td><strong>{item.job}</strong></td>
                      <td>{item.profile}</td>
                      <td>{item.deliver}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
