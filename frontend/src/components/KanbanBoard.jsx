import { useState } from 'react'

const COLUMNS = [
  { key: 'backlog',      label: 'Backlog',      color: '#64748b' },
  { key: 'ready',       label: 'Ready',        color: '#4a9eff' },
  { key: 'in_progress', label: 'In Progress',  color: '#f0a326' },
  { key: 'blocked',     label: 'Blocked',      color: '#f25c5c' },
  { key: 'done',        label: 'Done',         color: '#22d47a' },
]

export default function KanbanBoard({ tasks, busyKey, onAdd, onMove, onDelete }) {
  const [newTask, setNewTask] = useState({ title: '', status: 'backlog', priority: 0 })
  const [dragOverCol, setDragOverCol] = useState(null)

  const grouped = COLUMNS.reduce((acc, col) => {
    acc[col.key] = tasks.filter((t) => t.status === col.key)
    return acc
  }, {})

  const handleAdd = () => {
    const title = newTask.title.trim()
    if (!title) return
    onAdd({ title, status: newTask.status, priority: Number(newTask.priority) })
    setNewTask((p) => ({ ...p, title: '' }))
  }

  return (
    <section className="page-section">
      {/* Toolbar */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="toolbar">
          <input
            value={newTask.title}
            onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="New task title…"
          />
          <select
            value={newTask.status}
            onChange={(e) => setNewTask((p) => ({ ...p, status: e.target.value }))}
          >
            {COLUMNS.map((col) => (
              <option key={col.key} value={col.key}>{col.label}</option>
            ))}
          </select>
          <select
            value={newTask.priority}
            onChange={(e) => setNewTask((p) => ({ ...p, priority: Number(e.target.value) }))}
          >
            <option value={0}>Normal</option>
            <option value={1}>High</option>
            <option value={2}>Critical</option>
          </select>
          <button
            className="primary"
            onClick={handleAdd}
            disabled={busyKey === 'add-task' || !newTask.title.trim()}
          >
            {busyKey === 'add-task' ? <span className="spinner" /> : '+ Add'}
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="kanban">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            className={`kanban-col${dragOverCol === col.key ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key) }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOverCol(null)
              const id = e.dataTransfer.getData('text/plain')
              if (id) onMove(id, col.key)
            }}
          >
            <div className="col-header" style={{ borderLeftColor: col.color }}>
              <span style={{ color: col.color }}>{col.label}</span>
              <span className="col-count">{grouped[col.key]?.length || 0}</span>
            </div>
            <div className="col-body">
              {(grouped[col.key] || []).map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  busyKey={busyKey}
                  onDelete={onDelete}
                />
              ))}
              {(grouped[col.key] || []).length === 0 && (
                <div className="empty" style={{ marginTop: 4 }}>Drop here</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function TaskCard({ task, busyKey, onDelete }) {
  const [dragging, setDragging] = useState(false)

  return (
    <article
      className={`task-card${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); setDragging(true) }}
      onDragEnd={() => setDragging(false)}
    >
      {task.priority > 0 && (
        <span className={`priority p${task.priority}`} style={{ marginBottom: 6, display: 'inline-flex' }}>
          {task.priority === 2 ? '⚠ Critical' : '↑ High'}
        </span>
      )}
      <div className="task-title">{task.title}</div>
      {task.body && <div className="task-body">{task.body}</div>}
      <div className="task-meta">
        {task.assignee && <span className="task-assignee">👤 {task.assignee}</span>}
        <button
          className="danger"
          onClick={() => onDelete(task.id)}
          disabled={busyKey === `delete-${task.id}`}
          title="Delete task"
        >
          {busyKey === `delete-${task.id}` ? '…' : '✕'}
        </button>
      </div>
    </article>
  )
}
