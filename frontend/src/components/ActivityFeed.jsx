import React from 'react';

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const seconds = Math.floor((new Date() - d) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export default function ActivityFeed({ activities, onItemClick }) {
  if (!activities || activities.length === 0) {
    return (
      <div className="empty" style={{ minHeight: '120px' }}>
        <span>No recent activity recorded. Run tasks or talk to the agent to populate this feed.</span>
      </div>
    );
  }

  return (
    <div className="activity-feed">
      {activities.map((item) => {
        const timeStr = timeAgo(item.completed_at || item.ended_at);
        const snippet = item.summary
          ? item.summary.length > 120
            ? `${item.summary.slice(0, 120)}...`
            : item.summary
          : item.status === 'blocked'
          ? 'Task is blocked. Inspection required.'
          : 'Task finished with no output summary.';

        return (
          <div
            key={item.id}
            className="activity-item"
            onClick={() => onItemClick(item.id)}
          >
            <div className="activity-header">
              <span className="activity-title">{item.title}</span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {item.duration_secs !== null && item.duration_secs !== undefined && (
                  <span className="uptime-badge" style={{ fontSize: '9px', padding: '1px 4px' }}>
                    ⏱ {item.duration_secs}s
                  </span>
                )}
                <span className={`status-pill ${item.status || 'unknown'}`} style={{ height: '18px', padding: '0 6px', fontSize: '9px' }}>
                  {item.status}
                </span>
              </div>
            </div>
            
            <div className="activity-summary">
              {snippet}
            </div>

            <div className="activity-meta">
              {timeStr && <span>Completed {timeStr}</span>}
              <span style={{ color: 'var(--accent)' }}>Inspect task detail →</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
