import React, { useState, useEffect, useRef } from 'react';

const SUGGESTIONS = [
  "Find job leads for Python Developer",
  "Summarize container resource logs",
  "Check current cron operations health",
  "List active system alerts"
];

export default function ChatPage({ onOpenTaskDetail }) {
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [renderTrigger, setRenderTrigger] = useState(0);

  // Chat history in useRef as specified to prevent render loops on update
  const historyRef = useRef([]);
  const messagesEndRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Load chat history from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('saqr_chat_history');
      if (saved) {
        historyRef.current = JSON.parse(saved);
        setRenderTrigger(prev => prev + 1);
      } else {
        // Welcoming message if history is empty
        historyRef.current = [
          {
            id: 'welcome',
            role: 'agent',
            content: "Hello! I am SAQR, your autonomous agent. You can ask me to run any task, execute scripts, check system statuses, or look for leads. Type a message below or use one of the quick prompts to get started.",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ];
        saveHistory();
      }
    } catch (e) {
      console.error("Failed to load chat history", e);
    }
  }, []);

  // Scroll to bottom on message updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [renderTrigger, isThinking]);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const saveHistory = () => {
    sessionStorage.setItem('saqr_chat_history', JSON.stringify(historyRef.current));
    setRenderTrigger(prev => prev + 1);
  };

  const handleSend = async (text) => {
    if (!text || !text.trim() || isThinking) return;

    const promptText = text.trim();
    setInputText('');

    // Append user message
    historyRef.current.push({
      id: `user-${Date.now()}`,
      role: 'user',
      content: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    saveHistory();

    setIsThinking(true);

    try {
      // Create a Kanban task in the database for the agent to claim
      const res = await fetch('/api/kanban-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: promptText,
          body: "Triggered via direct chat console command",
          status: "ready",
          priority: 1,
          assignee: "default"
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to create task: ${res.statusText}`);
      }

      const task = await res.json();
      const taskId = task.id;

      // Start polling the created task status
      pollTaskStatus(taskId);
    } catch (err) {
      console.error(err);
      historyRef.current.push({
        id: `agent-error-${Date.now()}`,
        role: 'agent',
        content: `Error: Unable to submit task. ${err.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'error'
      });
      saveHistory();
      setIsThinking(false);
    }
  };

  const pollTaskStatus = (taskId) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/kanban-tasks/${taskId}`);
        if (!res.ok) {
          throw new Error("Task status check failed");
        }

        const taskData = await res.json();
        const { status, runs } = taskData;

        // If completed or blocked, stop polling and render response
        if (status === 'done' || status === 'blocked') {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;

          // Find the latest run summary
          const latestRun = runs && runs.length > 0 ? runs[runs.length - 1] : null;
          const content = latestRun?.summary || taskData.result || 
            (status === 'done' 
              ? "Task was completed successfully, but no run summary was output by the execution layer."
              : "Task execution failed/blocked. Please inspect logs.");
          
          let durationSecs = null;
          if (latestRun?.started_at && latestRun?.ended_at) {
            const start = new Date(latestRun.started_at);
            const end = new Date(latestRun.ended_at);
            if (!isNaN(start) && !isNaN(end)) {
              durationSecs = Math.round((end - start) / 1000);
            }
          }

          historyRef.current.push({
            id: taskId,
            role: 'agent',
            content: content,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: status,
            duration: durationSecs,
            outcome: latestRun?.outcome
          });
          saveHistory();
          setIsThinking(false);
        }
      } catch (err) {
        console.error("Error polling task:", err);
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        historyRef.current.push({
          id: `agent-poll-err-${Date.now()}`,
          role: 'agent',
          content: `Lost connection while polling task results. You can inspect the task details using ID: ${taskId}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'error',
          taskId: taskId
        });
        saveHistory();
        setIsThinking(false);
      }
    }, 2000); // Poll every 2 seconds during active processing
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSend(inputText);
    }
  };

  const clearHistory = () => {
    if (window.confirm("Are you sure you want to clear the chat console session history?")) {
      historyRef.current = [
        {
          id: 'welcome',
          role: 'agent',
          content: "Console cleared. Ask me anything to begin a new task.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ];
      saveHistory();
    }
  };

  return (
    <div className="chat-container text-glow">
      {/* Suggestions chips at the top */}
      <div className="chat-quick-suggestions">
        {SUGGESTIONS.map((s, idx) => (
          <button
            key={idx}
            className="quick-chip"
            onClick={() => handleSend(s)}
            disabled={isThinking}
          >
            {s}
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

      {/* Messages area */}
      <div className="chat-messages">
        {historyRef.current.map((msg) => (
          <div key={msg.id} className={`chat-bubble-wrap ${msg.role}`}>
            <div className={`chat-bubble ${msg.role}`}>
              {msg.content}
            </div>
            
            <div className="chat-meta-info">
              <span>{msg.timestamp}</span>
              {msg.role === 'agent' && msg.id !== 'welcome' && (
                <>
                  {msg.duration !== null && (
                    <span className="status-pill ok" style={{ height: '16px', padding: '0 5px', fontSize: '9px' }}>
                      ⏱ {msg.duration}s
                    </span>
                  )}
                  {msg.status && (
                    <span className={`status-pill ${msg.status}`} style={{ height: '16px', padding: '0 5px', fontSize: '9px' }}>
                      {msg.status.toUpperCase()}
                    </span>
                  )}
                  {msg.id && !msg.id.startsWith('agent-') && (
                    <span 
                      className="chat-meta-link"
                      onClick={() => onOpenTaskDetail(msg.id)}
                    >
                      Inspect #{msg.id.substring(0, 6)}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isThinking && (
          <div className="chat-bubble-wrap agent">
            <div className="chat-bubble agent" style={{ padding: '8px 12px' }}>
              <div className="typing-indicator">
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            </div>
            <div className="chat-meta-info">
              <span>SAQR is working...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input container */}
      <div className="chat-input-container">
        <input
          type="text"
          className="chat-input"
          placeholder={isThinking ? "Please wait for current operation to complete..." : "Ask SAQR to run a task (e.g. Find CEO of target company)..."}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyPress}
          disabled={isThinking}
        />
        <button
          className="primary"
          style={{ minHeight: '40px', padding: '0 20px', borderRadius: '8px' }}
          onClick={() => handleSend(inputText)}
          disabled={isThinking || !inputText.trim()}
        >
          {isThinking ? "Executing..." : "Execute"}
        </button>
      </div>
    </div>
  );
}
