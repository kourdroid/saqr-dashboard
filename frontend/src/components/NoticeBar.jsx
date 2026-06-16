export default function NoticeBar({ toasts = [], onDismiss, onToastClick, message, error }) {
  const text = error || message

  return (
    <>
      {text && (
        <div className="notice-wrap">
          <div className={`notice ${error ? 'error' : 'ok'}`}>
            <span>{error ? '!' : '✓'}</span>
            <span>{text}</span>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.slice(-3).map((toast) => (
            <div
              key={toast.id}
              className={`toast-item ${toast.type || 'info'}`}
              onClick={() => toast.taskId && onToastClick && onToastClick(toast.taskId)}
            >
              <span className="toast-icon">
                {toast.type === 'ok' ? '✓' : toast.type === 'error' ? '!' : 'i'}
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
                onClick={(event) => {
                  event.stopPropagation()
                  onDismiss && onDismiss(toast.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
