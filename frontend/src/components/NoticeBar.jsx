import { useEffect, useState } from 'react'

export default function NoticeBar({ message, error }) {
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

  if (!visible) return null

  return (
    <div className={`notice-wrap${exiting ? ' exiting' : ''}`}>
      <div className={`notice ${error ? 'error' : 'ok'}`}>
        <span>{error ? '⚠' : '✓'}</span>
        <span>{text}</span>
      </div>
    </div>
  )
}
