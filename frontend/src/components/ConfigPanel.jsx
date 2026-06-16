export default function ConfigPanel({
  config,
  configText,
  busyKey,
  configTextDirty,
  onConfigChange,
  onConfigTextChange,
  onSaveStructured,
  onSaveRaw,
  onRestart,
}) {
  const set = (path, value) => {
    const [section, key] = path.split('.')
    onConfigChange((prev) => ({
      ...prev,
      [section]: { ...prev?.[section], [key]: value },
    }))
  }

  return (
    <section className="page-section">
      <div className="page-grid">
        {/* Structured Fields */}
        <div className="panel span-2">
          <div className="panel-header">
            <h2>⚙ LLM Configuration</h2>
            <button
              className="primary"
              onClick={onSaveStructured}
              disabled={busyKey === 'save-config'}
            >
              {busyKey === 'save-config' ? 'Saving…' : '↑ Save Fields'}
            </button>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Model</label>
              <input
                value={config?.model?.default || ''}
                onChange={(e) => set('model.default', e.target.value)}
                placeholder="e.g. gpt-4o"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Provider</label>
              <input
                value={config?.model?.provider || ''}
                onChange={(e) => set('model.provider', e.target.value)}
                placeholder="e.g. openrouter"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Base URL</label>
              <input
                value={config?.model?.base_url || ''}
                onChange={(e) => set('model.base_url', e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Max Turns</label>
              <input
                type="number"
                min="1"
                value={config?.agent?.max_turns || ''}
                onChange={(e) => set('agent.max_turns', Number(e.target.value))}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Temperature</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={config?.model?.temperature ?? ''}
                onChange={(e) => set('model.temperature', e.target.value)}
              />
            </div>
          </div>
          {/* Current model summary */}
          <div style={{ padding: '0 16px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {config?.model?.default && <span className="chip">{config.model.default}</span>}
            {config?.model?.provider && <span className="chip">{config.model.provider}</span>}
            {config?.agent?.max_turns && <span className="chip">{config.agent.max_turns} turns</span>}
            {config?.model?.temperature !== undefined && <span className="chip">temp {config.model.temperature}</span>}
          </div>
        </div>

        {/* Fallback Providers info */}
        <div className="panel">
          <div className="panel-header">
            <h2>Fallback Providers</h2>
            <span className="panel-badge">{(config?.fallback_providers || []).length}</span>
          </div>
          <div className="chip-grid">
            {(config?.fallback_providers || []).length === 0
              ? <div className="empty" style={{ width: '100%' }}>No fallback providers</div>
              : (config.fallback_providers.map((p, i) => (
                  <span key={i} className="chip">{typeof p === 'string' ? p : JSON.stringify(p)}</span>
                )))}
          </div>
        </div>

        {/* Delegation info */}
        <div className="panel">
          <div className="panel-header">
            <h2>Delegation</h2>
          </div>
          <div className="chip-grid">
            {config?.delegation && Object.entries(config.delegation).length > 0
              ? Object.entries(config.delegation).map(([k, v]) => (
                  <span key={k} className="chip">{k}: {String(v)}</span>
                ))
              : <div className="empty" style={{ width: '100%' }}>No delegation config</div>}
          </div>
        </div>

        {/* Raw YAML editor */}
        <div className="panel span-4">
          <div className="panel-header">
            <h2>Raw YAML {configTextDirty && <span style={{ color: 'var(--accent)', marginLeft: 6, fontSize: 11 }}>● unsaved</span>}</h2>
            <div className="table-actions">
              <button
                className="primary"
                onClick={onSaveRaw}
                disabled={busyKey === 'save-raw-config'}
              >
                {busyKey === 'save-raw-config' ? 'Saving…' : '↑ Save Raw'}
              </button>
              <button
                className="danger"
                onClick={onRestart}
                disabled={busyKey === 'restart-container'}
              >
                ⟳ Restart Container
              </button>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <textarea
              value={configText}
              onChange={(e) => onConfigTextChange(e.target.value)}
              spellCheck="false"
              style={{ minHeight: 420 }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
