import { useCallback, useEffect, useRef, useState } from 'react'

import './App.css'

import NoticeBar     from './components/NoticeBar.jsx'
import Topbar        from './components/Topbar.jsx'
import OverviewPage  from './components/OverviewPage.jsx'
import KanbanBoard   from './components/KanbanBoard.jsx'
import CronPanel     from './components/CronPanel.jsx'
import PipelinePage  from './components/PipelinePage.jsx'
import ConfigPanel   from './components/ConfigPanel.jsx'
import ScriptsPage   from './components/ScriptsPage.jsx'
import ContainerPanel from './components/ContainerPanel.jsx'
import MissionsPage  from './components/MissionsPage.jsx'
import ChatPage      from './components/ChatPage.jsx'
import TaskDrawer    from './components/TaskDrawer.jsx'
import { api, getApiToken, setApiToken } from './lib/api.js'

// ── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview',   label: 'Overview' },
  { key: 'chat',       label: 'Terminal' },
  { key: 'kanban',     label: 'Kanban' },
  { key: 'cron',       label: 'Cron' },
  { key: 'pipeline',   label: 'Pipeline' },
  { key: 'config',     label: 'Config' },
  { key: 'scripts',    label: 'Scripts' },
  { key: 'container',  label: 'Container' },
  { key: 'soul',       label: 'Missions' },
]

// ── API helper ────────────────────────────────────────────────────────────────

async function fetchSnapshot() {
  const [overview, tasks, cronJobs, pipeline, credits, config, soul, env, scripts, activities] = await Promise.all([
    api('/overview'),
    api('/kanban-tasks'),
    api('/cron-jobs'),
    api('/pipeline'),
    api('/credits'),
    api('/config'),
    api('/soul-summary'),
    api('/env'),
    api('/scripts'),
    api('/activity').catch(() => []), // Fallback if DB table not yet ready
  ])
  return { overview, tasks, cronJobs, pipeline, credits, config, soul, env, scripts, activities }
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState('overview')

  // Core data
  const [overview,   setOverview]   = useState(null)
  const [tasks,      setTasks]      = useState([])
  const [cronJobs,   setCronJobs]   = useState([])
  const [pipeline,   setPipeline]   = useState(null)
  const [credits,    setCredits]    = useState({})
  const [config,     setConfig]     = useState(null)
  const [soul,       setSoul]       = useState(null)
  const [envKeys,    setEnvKeys]    = useState([])
  const [scripts,    setScripts]    = useState([])
  const [activities, setActivities] = useState([])

  // Config editing
  const [configText,      setConfigText]      = useState('')
  const [configTextDirty, setConfigTextDirty] = useState(false)

  // Container / logs / script output
  const [container,    setContainer]    = useState(null)
  const [logs,         setLogs]         = useState('')
  const [scriptOutput, setScriptOutput] = useState(null)

  // UI state
  const [loading,  setLoading]  = useState(true)
  const [busyKey,  setBusyKey]  = useState('')
  const [message,  setMessage]  = useState('')
  const [error,    setError]    = useState('')

  // Toast stack & drawer state
  const [toasts, setToasts] = useState([])
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [apiToken, setApiTokenState] = useState(() => getApiToken())
  const prevTasksRef = useRef([])
  const toastIdRef = useRef(0)

  // ── Toast methods ───────────────────────────────────────────────────────────

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((text, type = 'info', taskId = null) => {
    toastIdRef.current += 1
    const id = `toast-${toastIdRef.current}`
    setToasts((prev) => [...prev, { id, text, type, taskId }])
    setTimeout(() => {
      dismissToast(id)
    }, 4000)
  }, [dismissToast])

  const handleApiTokenChange = useCallback((token) => {
    setApiToken(token)
    setApiTokenState(token.trim())
  }, [])

  // Task status transitions detection
  useEffect(() => {
    if (prevTasksRef.current && prevTasksRef.current.length > 0) {
      tasks.forEach((newTask) => {
        const oldTask = prevTasksRef.current.find((t) => t.id === newTask.id)
        if (oldTask) {
          if (oldTask.status !== 'done' && newTask.status === 'done') {
            addToast(`✓ Task Completed: "${newTask.title}"`, 'ok', newTask.id)
          } else if (oldTask.status !== 'blocked' && newTask.status === 'blocked') {
            addToast(`⚠ Task Blocked: "${newTask.title}"`, 'error', newTask.id)
          }
        }
      })
    }
    prevTasksRef.current = tasks
  }, [tasks, addToast])

  // ── Data loading ────────────────────────────────────────────────────────────

  const applySnapshot = useCallback((snap) => {
    setOverview(snap.overview)
    setTasks(snap.tasks)
    setCronJobs(snap.cronJobs)
    setPipeline(snap.pipeline)
    setCredits(snap.credits)
    setConfig(snap.config)
    setSoul(snap.soul)
    setEnvKeys(snap.env.keys || [])
    setScripts(snap.scripts)
    setActivities(snap.activities || [])
    if (!configTextDirty) setConfigText(snap.config.raw || '')
  }, [configTextDirty])

  const refreshNow = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const snap = await fetchSnapshot()
      applySnapshot(snap)
      setError('')
      if (!silent) setMessage('Dashboard refreshed')
    } catch (e) {
      setError(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [applySnapshot])

  // Initial load + 15s poll
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      fetchSnapshot()
        .then((snap)  => { if (!cancelled) { applySnapshot(snap); setError('') } })
        .catch((e)    => { if (!cancelled) setError(e.message) })
        .finally(()   => { if (!cancelled) setLoading(false) })
    }
    const starter  = window.setTimeout(tick, 0)
    const interval = window.setInterval(tick, 15000)
    return () => { cancelled = true; clearTimeout(starter); clearInterval(interval) }
  }, [applySnapshot])

  // ── Action helper ───────────────────────────────────────────────────────────

  const runAction = async (key, action, successMsg) => {
    setBusyKey(key)
    setMessage('')
    setError('')
    try {
      const result = await action()
      if (successMsg) setMessage(successMsg)
      await refreshNow(true)
      return result
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setBusyKey('')
    }
  }

  // ── Kanban actions ──────────────────────────────────────────────────────────

  const addTask = ({ title, status, priority }) =>
    runAction('add-task',
      () => api('/kanban-tasks', { method: 'POST', body: JSON.stringify({ title, status, priority }) }),
      'Task added')

  const moveTask = (id, status) =>
    runAction(`move-${id}`,
      () => api(`/kanban-tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
      'Task moved')

  const deleteTask = (id) =>
    runAction(`delete-${id}`,
      () => api(`/kanban-tasks/${id}`, { method: 'DELETE' }),
      'Task deleted')

  // ── Cron actions ────────────────────────────────────────────────────────────

  const toggleCron  = (id) => runAction(`cron-${id}`,    () => api(`/cron/${id}/toggle`,  { method: 'POST' }), 'Cron state updated')
  const triggerCron = (id) => runAction(`trigger-${id}`, () => api(`/cron/${id}/trigger`, { method: 'POST' }), 'Cron trigger requested')

  // ── Config actions ──────────────────────────────────────────────────────────

  const saveStructuredConfig = () =>
    runAction('save-config',
      () => api('/config', {
        method: 'PUT',
        body: JSON.stringify({
          model:       config?.model?.default  || '',
          provider:    config?.model?.provider || '',
          base_url:    config?.model?.base_url || '',
          max_turns:   Number(config?.agent?.max_turns || 0),
          temperature: config?.model?.temperature !== undefined ? Number(config.model.temperature) : undefined,
        }),
      }),
      'Config fields saved')

  const saveRawConfig = async () => {
    await runAction('save-raw-config',
      () => api('/config/raw', { method: 'PUT', body: JSON.stringify({ text: configText }) }),
      'Raw config saved')
    setConfigTextDirty(false)
  }

  const restartContainer = () =>
    runAction('restart-container',
      () => api('/container/restart', { method: 'POST' }),
      'Container restart requested')

  // ── Container actions ───────────────────────────────────────────────────────

  const loadContainerInfo = async () => {
    const result = await runAction('container-info', () => api('/container'), 'Container snapshot loaded')
    if (result) setContainer(result)
  }

  const loadLogs = async () => {
    const result = await runAction('container-logs', () => api('/container/logs?lines=120'), 'Logs loaded')
    if (result) setLogs(result.stdout || result.stderr || 'no logs')
  }

  // ── Script actions ──────────────────────────────────────────────────────────

  const runScript = async (name) => {
    const result = await runAction(`script-${name}`,
      () => api(`/scripts/${encodeURIComponent(name)}/run`, { method: 'POST' }),
      'Script finished')
    if (result) setScriptOutput({ name, result })
  }

  // ── Handle tab change ───────────────────────────────────────────────────────

  const handleTabChange = (key) => {
    setActiveTab(key)
    if (key === 'container') loadContainerInfo()
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      <Topbar
        overview={overview}
        loading={loading}
        busyKey={busyKey}
        activeTab={activeTab}
        tabs={TABS}
        onRefresh={() => refreshNow(false)}
        onRestart={restartContainer}
        onTabChange={handleTabChange}
        apiToken={apiToken}
        onApiTokenChange={handleApiTokenChange}
      />

      <NoticeBar 
        toasts={toasts}
        onDismiss={dismissToast}
        onToastClick={(taskId) => setSelectedTaskId(taskId)}
        message={message} 
        error={error} 
      />

      {selectedTaskId && (
        <TaskDrawer
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      <main>
        {activeTab === 'overview' && (
          <OverviewPage
            overview={overview}
            tasks={tasks}
            pipeline={pipeline}
            credits={credits}
            cronJobs={cronJobs}
            envKeys={envKeys}
            activities={activities}
            onActivityClick={(id) => setSelectedTaskId(id)}
          />
        )}

        {activeTab === 'chat' && (
          <ChatPage 
            onOpenTaskDetail={(id) => setSelectedTaskId(id)} 
          />
        )}

        {activeTab === 'kanban' && (
          <KanbanBoard
            tasks={tasks}
            busyKey={busyKey}
            onAdd={addTask}
            onMove={moveTask}
            onDelete={deleteTask}
            onCardClick={(id) => setSelectedTaskId(id)}
          />
        )}

        {activeTab === 'cron' && (
          <CronPanel
            cronJobs={cronJobs}
            busyKey={busyKey}
            onToggle={toggleCron}
            onTrigger={triggerCron}
          />
        )}

        {activeTab === 'pipeline' && (
          <PipelinePage pipeline={pipeline} />
        )}

        {activeTab === 'config' && (
          <ConfigPanel
            config={config}
            configText={configText}
            busyKey={busyKey}
            configTextDirty={configTextDirty}
            onConfigChange={setConfig}
            onConfigTextChange={(text) => { setConfigText(text); setConfigTextDirty(true) }}
            onSaveStructured={saveStructuredConfig}
            onSaveRaw={saveRawConfig}
            onRestart={restartContainer}
          />
        )}

        {activeTab === 'scripts' && (
          <ScriptsPage
            scripts={scripts}
            envKeys={envKeys}
            scriptOutput={scriptOutput}
            busyKey={busyKey}
            onRun={runScript}
          />
        )}

        {activeTab === 'container' && (
          <ContainerPanel
            container={container}
            logs={logs}
            busyKey={busyKey}
            onInspect={loadContainerInfo}
            onLoadLogs={loadLogs}
            onRestart={restartContainer}
          />
        )}

        {activeTab === 'soul' && (
          <MissionsPage soul={soul} />
        )}
      </main>
    </div>
  )
}
