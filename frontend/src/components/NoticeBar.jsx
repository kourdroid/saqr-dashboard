import { useEffect, useState } from 'react'

export default function NoticeBar({ toasts = [], onDismiss, onToastClick, message, error }) {
  const [exiting, setExiting] = useState(false)
  const [visible, setVisible] = useState(false)
  const text = error || message

  useEffect(() => {
    if (!text) { setVisible(false); setExiting(false); return }
    setExiting(false)
    setVisible(true)
    if (!error) {
      const t = setTimeout(() => {
        setExiting(true)
        setTimeout(() => setVisible(false), 250)
      }, 4000)
      return () => clearTimeout(t)
    }
  }, [text, error])

  return (
    <>
      {/* Inline Top Page Banner (legacy) */}
      {visible && (
        <div className={`notice-wrap${exiting ? ' exiting' : ''}`}>
          <div className={`notice ${error ? 'error' : 'ok'}`}>
            <span>{error ? '⚠' : '✓'}</span>
            <span>{text}</span>
          </div>
        </div>
      )}

      {/* Floating Bottom-Right Toast Stack */}
      {toasts && toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.slice(-3).map((toast) => (
            <div
              key={toast.id}
              className={`toast-item ${toast.type || 'info'}`}
              onClick={() => toast.taskId && onToastClick && onToastClick(toast.taskId)}
            >
              <span className="toast-icon">
                {toast.type === 'ok' ? '✓' : toast.type === 'error' ? '⚠' : 'ℹ'}
              </span>
              <div className="toast-content">
                <span className="toast-text">{toast.text}</span>
                {toast.taskId && (
                  <span style={{ fontSize: '10px', color: 'var(--accent)', marginTop: '2px', textDecoration: 'underline' }}>
                    Click to inspect task detail →
                  </span>
                )}
              </div>
              <button
                className="toast-dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss && onDismiss(toast.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
