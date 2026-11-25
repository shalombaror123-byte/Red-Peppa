import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { fmtDate } from './time'

/**
 * Admin-only view: pending message reports with Warn/Dismiss actions.
 */
export default function Reports() {
  const [reports, setReports] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const d = await api.getReports()
      setReports(d.reports.filter((r) => r.status === 'pending'))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [refresh])

  const resolve = async (id, warn) => {
    let text = ''
    if (warn) {
      text = window.prompt(
        'Warning message to send the user:',
        'You received a warning for a reported message.'
      )
      if (text === null) return
    }
    try {
      await api.resolveReport(id, { warn, text })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="board">
      <h2>🚩 Reports</h2>
      {error && <div className="banner error">{error}</div>}
      <div className="post-list">
        {reports?.map((r) => (
          <div key={r.id} className="post">
            <div className="post-header">
              <span className="avatar small">
                {r.reported_name?.[0]?.toUpperCase() || '?'}
              </span>
              <strong>{r.reported_name}</strong>
              <span className="muted small">
                reported by {r.reporter_name} · {fmtDate(r.ts)}
              </span>
            </div>
            <div className="post-text">“{r.message_text}”</div>
            <div className="report-actions">
              <button className="primary" onClick={() => resolve(r.id, true)}>
                Warn user
              </button>
              <button className="link" onClick={() => resolve(r.id, false)}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
        {reports && reports.length === 0 && (
          <p className="muted">No pending reports 🎉</p>
        )}
        {!reports && !error && <p className="muted">Loading…</p>}
      </div>
    </div>
  )
}
