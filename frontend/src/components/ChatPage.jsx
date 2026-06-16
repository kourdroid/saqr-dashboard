import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

const INITIAL_LINES = [
  { id: 'boot-1', kind: 'system', text: 'Hermes TUI attached to SAQR command queue.' },
  { id: 'boot-2', kind: 'system', text: 'Commands: help, status, logs, tasks, task <id>, clear. Any other input queues a Hermes task.' },
]

function formatTimestamp() {
  return new Date().toLocaleTimeString([], { hour12: false })
}

function statusClass(status) {
  return String(status || 'unknown').replaceAll('_', '-')
}

function summarizeTask(task) {
  const runs = task.runs || []
  const events = task.events || []
  const latestRun = runs.length > 0 ? runs[runs.length - 1] : null
  const summary = latestRun?.summary || task.result || task.last_failure_error || 'No Hermes summary recorded yet.'
  return [
    `task ${task.id} :: ${task.status}`,
    `title: ${task.title}`,
    `assignee: ${task.assignee || 'default'} | priority: ${task.priority ?? 0}`,
    `runs: ${runs.length} | events: ${events.length}`,
    summary,
  ].join('\n')
}

export default function ChatPage({ onOpenTaskDetail }) {
  const [lines, setLines] = useState(INITIAL_LINES)
  const [inputText, setInputText] = useState('')
  const [activeTaskId, setActiveTaskId] = useState('')
  const [busy, setBusy] = useState(false)
  const terminalEndRef = useRef(null)
  const pollIntervalRef = useRef(null)
  const lineIdRef = useRef(0)

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, busy])

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [])

  const appendLine = (kind, text, meta = {}) => {
    lineIdRef.current += 1
    setLines((current) => [
      ...current,
      { id: `line-${lineIdRef.current}`, kind, text, timestamp: formatTimestamp(), ...meta },
    ])
  }

  const appendBlock = (kind, rows, meta = {}) => {
    appendLine(kind, rows.filter(Boolean).join('\n'), meta)
  }

  const clearTerminal = () => {
    setLines(INITIAL_LINES)
  }

  const stopPolling = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    pollIntervalRef.current = null
    setActiveTaskId('')
    setBusy(false)
  }

  const pollTask = (taskId) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    setActiveTaskId(taskId)

    pollIntervalRef.current = setInterval(async () => {
      try {
        const task = await api(`/kanban-tasks/${taskId}`)
        appendBlock('event', [
          `poll ${taskId}: ${task.status}`,
          task.runs?.length ? `latest run: ${task.runs[task.runs.length - 1]?.outcome || 'unknown'}` : 'runs: none yet',
        ], { taskId })

        if (task.status !== 'done' && task.status !== 'blocked') return

        appendLine(task.status === 'done' ? 'success' : 'error', summarizeTask(task), { taskId })
        stopPolling()
      } catch (error) {
        appendLine('error', `poll failed for ${taskId}: ${error.message}`, { taskId })
        stopPolling()
      }
    }, 3000)
  }

  const queueHermesTask = async (prompt) => {
    setBusy(true)
    appendLine('input', prompt)
    appendLine('system', 'queueing Hermes task...')
    try {
      const task = await api('/kanban-tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: prompt,
          body: 'Triggered from Hermes terminal console',
          status: 'ready',
          priority: 1,
          assignee: 'default',
        }),
      })
      appendLine('success', `queued ${task.id}; waiting for Hermes gateway to claim it`, { taskId: task.id })
      pollTask(task.id)
    } catch (error) {
      appendLine('error', `queue failed: ${error.message}`)
      setBusy(false)
    }
  }

  const runTerminalCommand = async (raw) => {
    const command = raw.trim()
    if (!command) return
    setInputText('')

    const [verb, ...args] = command.split(/\s+/)
    const normalized = verb.toLowerCase()

    if (normalized === 'clear') {
      clearTerminal()
      return
    }

    if (normalized === 'help') {
      appendLine('input', command)
      appendBlock('system', [
        'help',
        '  status      show container and queue health',
        '  logs        tail Hermes container logs',
        '  tasks       list current command queue',
        '  task <id>   inspect one task',
        '  clear       clear terminal output',
        '  <anything>  queue text as a Hermes task',
      ])
      return
    }

    if (normalized === 'status') {
      appendLine('input', command)
      try {
        const overview = await api('/overview')
        appendBlock('system', [
          `container: ${overview.container?.status || 'unknown'}`,
          `tasks: ${overview.tasks?.total || 0}`,
          `ready: ${overview.tasks?.by_status?.ready || 0}`,
          `running: ${overview.tasks?.by_status?.in_progress || 0}`,
          `blocked: ${overview.tasks?.by_status?.blocked || 0}`,
          `cron errors: ${overview.cron?.by_health?.error || 0}`,
        ])
      } catch (error) {
        appendLine('error', `status failed: ${error.message}`)
      }
      return
    }

    if (normalized === 'logs') {
      appendLine('input', command)
      try {
        const logs = await api('/container/logs?lines=80')
        appendLine(logs.ok ? 'system' : 'error', logs.stdout || logs.stderr || 'no logs')
      } catch (error) {
        appendLine('error', `logs failed: ${error.message}`)
      }
      return
    }

    if (normalized === 'tasks') {
      appendLine('input', command)
      try {
        const tasks = await api('/kanban-tasks')
        appendLine('system', tasks.slice(0, 12).map((task) => (
          `${task.id}  ${task.status.padEnd(11)}  p${task.priority}  ${task.title}`
        )).join('\n') || 'no tasks')
      } catch (error) {
        appendLine('error', `tasks failed: ${error.message}`)
      }
      return
    }

    if (normalized === 'task') {
      const taskId = args[0]
      appendLine('input', command)
      if (!taskId) {
        appendLine('error', 'usage: task <id>')
        return
      }
      try {
        const task = await api(`/kanban-tasks/${taskId}`)
        appendLine('system', summarizeTask(task), { taskId })
      } catch (error) {
        appendLine('error', `task inspect failed: ${error.message}`)
      }
      return
    }

    await queueHermesTask(command)
  }

  return (
    <section className="terminal-page">
      <div className="terminal-window">
        <div className="terminal-titlebar">
          <div>
            <strong>Hermes TUI</strong>
            <span>SAQR queue terminal</span>
          </div>
          <div className="terminal-title-actions">
            {activeTaskId && (
              <button className="terminal-link" onClick={() => onOpenTaskDetail(activeTaskId)}>
                inspect {activeTaskId.substring(0, 6)}
              </button>
            )}
            <button className="terminal-link" onClick={stopPolling} disabled={!busy}>
              stop
            </button>
          </div>
        </div>

        <div className="terminal-screen" aria-live="polite">
          {lines.map((line) => (
            <div key={line.id} className={`terminal-line ${statusClass(line.kind)}`}>
              <span className="terminal-time">{line.timestamp || '--:--:--'}</span>
              <span className="terminal-prompt">
                {line.kind === 'input' ? '>' : line.kind}
              </span>
              <pre>{line.text}</pre>
              {line.taskId && (
                <button className="terminal-inspect" onClick={() => onOpenTaskDetail(line.taskId)}>
                  inspect
                </button>
              )}
            </div>
          ))}
          {busy && (
            <div className="terminal-line system">
              <span className="terminal-time">{formatTimestamp()}</span>
              <span className="terminal-prompt">wait</span>
              <pre>Hermes task active; polling queue state...</pre>
            </div>
          )}
          <div ref={terminalEndRef} />
        </div>

        <div className="terminal-input-row">
          <span>saqr@hermes:~$</span>
          <input
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runTerminalCommand(inputText)
            }}
            placeholder={busy ? 'wait for active task, or press stop' : 'type help or enter a Hermes task'}
            disabled={false}
            autoFocus
          />
          <button className="primary" onClick={() => runTerminalCommand(inputText)} disabled={!inputText.trim()}>
            run
          </button>
        </div>
      </div>
    </section>
  )
}
