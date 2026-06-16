import { useState } from 'react'

const COLUMNS = [
  { key: 'backlog',      label: 'Backlog',      color: '#64748b' },
  { key: 'ready',       label: 'Ready',        color: '#4a9eff' },
  { key: 'in_progress', label: 'In Progress',  color: '#f0a326' },
  { key: 'blocked',     label: 'Blocked',      color: '#f25c5c' },
  { key: 'done',        label: 'Done',         color: '#22d47a' },
]

export default function KanbanBoard({ tasks = [], busyKey, onAdd, onMove, onDelete, onCardClick }) {
  const [newTask, setNewTask] = useState({ title: '', status: 'backlog', priority: 0 })
  const [dragOverCol, setDragOverCol] = useState(null)
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [columnFilter, setColumnFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')

  const handleAdd = () => {
    const title = newTask.title.trim()
    if (!title) return
    onAdd({ title, status: newTask.status, priority: Number(newTask.priority) })
    setNewTask((p) => ({ ...p, title: '' }))
  }

  // Extract unique assignees dynamically for filter
  const assignees = Array.from(
    new Set(tasks.map((t) => t.assignee).filter(Boolean))
  )

  // Filter tasks based on query variables
  const filteredTasks = tasks.filter((task) => {
    const matchesSearch = 
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (task.body && task.body.toLowerCase().includes(searchQuery.toLowerCase())) ||
      task.id.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesPriority = priorityFilter === 'all' || task.priority === Number(priorityFilter)
    const matchesAssignee = assigneeFilter === 'all' || task.assignee === assigneeFilter
    
    return matchesSearch && matchesPriority && matchesAssignee
  })

  // Filter columns to display based on status filter selection
  const activeColumns = columnFilter === 'all' 
    ? COLUMNS 
    : COLUMNS.filter((col) => col.key === columnFilter)

  const grouped = activeColumns.reduce((acc, col) => {
    acc[col.key] = filteredTasks.filter((t) => t.status === col.key)
    return acc
  }, {})

  return (
    <section className="page-section">
      {/* Add Task Toolbar */}
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

      {/* Search & Filter Bar */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="search-filter-bar">
          <div className="search-input-wrap">
            <span className="search-icon-inside">🔍</span>
            <input
              type="text"
              placeholder="Search by title, body description, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="filter-selects">
            <select
              value={columnFilter}
              onChange={(e) => setColumnFilter(e.target.value)}
            >
              <option value="all">All Columns</option>
              {COLUMNS.map((col) => (
                <option key={col.key} value={col.key}>{col.label}</option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <option value="all">All Priorities</option>
              <option value={0}>Normal Priority</option>
              <option value={1}>High Priority</option>
              <option value={2}>Critical Priority</option>
            </select>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
            >
              <option value="all">All Assignees</option>
              {assignees.map((assignee) => (
                <option key={assignee} value={assignee}>{assignee}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="kanban">
        {activeColumns.map((col) => (
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
                  onCardClick={onCardClick}
                />
              ))}
              {(grouped[col.key] || []).length === 0 && (
                <div className="empty" style={{ marginTop: 4 }}>No Tasks</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function TaskCard({ task, busyKey, onDelete, onCardClick }) {
  const [dragging, setDragging] = useState(false)

  const formatCompletedTime = (timeStr) => {
    if (!timeStr) return '';
    const d = new Date(timeStr);
    if (isNaN(d.getTime())) return '';
    const seconds = Math.floor((new Date() - d) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <article
      className={`task-card${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); setDragging(true) }}
      onDragEnd={() => setDragging(false)}
      onClick={() => onCardClick && onCardClick(task.id)}
      style={{ cursor: 'pointer' }}
    >
      {task.priority > 0 && (
        <span className={`priority p${task.priority}`} style={{ marginBottom: 6, display: 'inline-flex' }}>
          {task.priority === 2 ? '⚠ Critical' : '↑ High'}
        </span>
      )}
      <div className="task-title">{task.title}</div>
      {task.body && <div className="task-body" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.body}</div>}
      
      {task.status === 'done' && task.completed_at && (
        <div style={{ fontSize: '10px', color: 'var(--green)', marginTop: '6px' }}>
          ✓ Done {formatCompletedTime(task.completed_at)}
        </div>
      )}

      <div className="task-meta">
        {task.assignee && <span className="task-assignee">👤 {task.assignee}</span>}
        <button
          className="danger"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
          disabled={busyKey === `delete-${task.id}`}
          title="Delete task"
        >
          {busyKey === `delete-${task.id}` ? '…' : '✕'}
        </button>
      </div>
    </article>
  )
}
