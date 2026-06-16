import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

const SUGGESTIONS = [
  'Find job leads for Python Developer',
  'Summarize container resource logs',
  'Check current cron operations health',
  'List active system alerts',
]

const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'agent',
  content: 'SAQR is ready. Submit a command to create a Hermes task, then inspect the task detail for execution evidence.',
  timestamp: '--:--',
}

function loadInitialMessages() {
  try {
    const saved = sessionStorage.getItem('saqr_chat_history')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    sessionStorage.removeItem('saqr_chat_history')
  }
  return [WELCOME_MESSAGE]
}

function currentTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPage({ onOpenTaskDetail }) {
  const [messages, setMessages] = useState(loadInitialMessages)
  const [inputText, setInputText] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const messagesEndRef = useRef(null)
  const pollIntervalRef = useRef(null)
  const messageIdRef = useRef(0)

  useEffect(() => {
    sessionStorage.setItem('saqr_chat_history', JSON.stringify(messages))
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  const nextMessageId = (prefix) => {
    messageIdRef.current += 1
    return `${prefix}-${messageIdRef.current}`
  }

  const appendMessage = (message) => {
    setMessages((current) => [...current, message])
  }

  const pollTaskStatus = (taskId) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const taskData = await api(`/kanban-tasks/${taskId}`)
        const { status, runs } = taskData

        if (status !== 'done' && status !== 'blocked') return

        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null

        const latestRun = runs && runs.length > 0 ? runs[runs.length - 1] : null
        const content = latestRun?.summary || taskData.result ||
          (status === 'done'
            ? 'Task completed, but Hermes did not record a summary.'
            : 'Task blocked. Inspect the task detail and container logs.')

        let durationSecs = null
        if (latestRun?.started_at && latestRun?.ended_at) {
          const start = new Date(latestRun.started_at)
          const end = new Date(latestRun.ended_at)
          if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
            durationSecs = Math.round((end - start) / 1000)
          }
        }

        appendMessage({
          id: taskId,
          role: 'agent',
          content,
          timestamp: currentTimestamp(),
          status,
          duration: durationSecs,
          outcome: latestRun?.outcome,
        })
        setIsThinking(false)
      } catch (error) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
        appendMessage({
          id: nextMessageId('agent-poll-error'),
          role: 'agent',
          content: `Lost connection while polling task ${taskId}: ${error.message}`,
          timestamp: currentTimestamp(),
          status: 'error',
          taskId,
        })
        setIsThinking(false)
      }
    }, 2000)
  }

  const handleSend = async (text) => {
    const promptText = text.trim()
    if (!promptText || isThinking) return

    setInputText('')
    appendMessage({
      id: nextMessageId('user'),
      role: 'user',
      content: promptText,
      timestamp: currentTimestamp(),
    })
    setIsThinking(true)

    try {
      const task = await api('/kanban-tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: promptText,
          body: 'Triggered via direct chat console command',
          status: 'ready',
          priority: 1,
          assignee: 'default',
        }),
      })
      pollTaskStatus(task.id)
    } catch (error) {
      appendMessage({
        id: nextMessageId('agent-error'),
        role: 'agent',
        content: `Unable to submit task: ${error.message}`,
        timestamp: currentTimestamp(),
        status: 'error',
      })
      setIsThinking(false)
    }
  }

  const clearHistory = () => {
    if (!window.confirm('Clear the chat console session history?')) return
    setMessages([{ ...WELCOME_MESSAGE, content: 'Console cleared. Submit a command to begin a new task.' }])
  }

  return (
    <div className="chat-container text-glow">
      <div className="chat-quick-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            className="quick-chip"
            onClick={() => handleSend(suggestion)}
            disabled={isThinking}
          >
            {suggestion}
          </button>
        ))}
        <button
          className="quick-chip"
          style={{ marginLeft: 'auto', background: 'rgba(242, 92, 92, 0.1)', color: '#fca5a5', borderColor: 'rgba(242, 92, 92, 0.2)' }}
          onClick={clearHistory}
        >
          Clear Session
        </button>
      </div>

      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble-wrap ${msg.role}`}>
            <div className={`chat-bubble ${msg.role}`}>{msg.content}</div>

            <div className="chat-meta-info">
              <span>{msg.timestamp}</span>
              {msg.role === 'agent' && msg.id !== 'welcome' && (
                <>
                  {msg.duration !== null && msg.duration !== undefined && (
                    <span className="status-pill ok" style={{ height: '16px', padding: '0 5px', fontSize: '9px' }}>
                      {msg.duration}s
                    </span>
                  )}
                  {msg.status && (
                    <span className={`status-pill ${msg.status}`} style={{ height: '16px', padding: '0 5px', fontSize: '9px' }}>
                      {msg.status.toUpperCase()}
                    </span>
                  )}
                  {msg.id && !msg.id.startsWith('agent-') && (
                    <span className="chat-meta-link" onClick={() => onOpenTaskDetail(msg.id)}>
                      Inspect #{msg.id.substring(0, 6)}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="chat-bubble-wrap agent">
            <div className="chat-bubble agent" style={{ padding: '8px 12px' }}>
              <div className="typing-indicator">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            </div>
            <div className="chat-meta-info">
              <span>SAQR is working...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <input
          type="text"
          className="chat-input"
          placeholder={isThinking ? 'Please wait for the current operation to complete...' : 'Ask SAQR to run a task'}
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSend(inputText)
          }}
          disabled={isThinking}
        />
        <button
          className="primary"
          style={{ minHeight: '40px', padding: '0 20px', borderRadius: '8px' }}
          onClick={() => handleSend(inputText)}
          disabled={isThinking || !inputText.trim()}
        >
          {isThinking ? 'Executing...' : 'Execute'}
        </button>
      </div>
    </div>
  )
}
