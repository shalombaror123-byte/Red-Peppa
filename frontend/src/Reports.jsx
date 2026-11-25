import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { fmtDate } from './time'

/**
 * Admin-only view: pending message reports with Warn/Dismiss actions.
 */
export default function Reports({ me, users = [], onRefresh }) {
  const [reports, setReports] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const d = await api.getReports(me.id)
      setReports(d.reports.filter((r) => r.status === 'pending'))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [me.id])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [refresh])

  const resolve = async (id, action, name) => {
    let text = ''
    if (action === 'warn') {
      text = window.prompt(
        'Warning message to send the user:',
        'You received a warning for a reported message.'
      )
      if (text === null) return
    }
    if (action === 'ban2h' && !window.confirm(`Ban ${name} for 2 hours?`)) {
      return
    }
    if (
      action === 'ban' &&
      !window.confirm(`Ban ${name} until you lift it?`)
    ) {
      return
    }
    try {
      await api.resolveReport(id, { me: me.id, action, text })
      await refresh()
      onRefresh?.()
    } catch (err) {
      setError(err.message)
    }
  }

  const unban = async (u) => {
    try {
      await api.unbanUser(u.id, { me: me.id })
      onRefresh?.()
    } catch (err) {
      setError(err.message)
    }
  }

  const now = Date.now() / 1000
  const bannedUsers = users.filter(
    (u) => u.banned_until === -1 || u.banned_until > now
  )

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
              <button
                className="primary"
                onClick={() => resolve(r.id, 'warn', r.reported_name)}
              >
                Warn
              </button>
              <button
                className="primary"
                onClick={() => resolve(r.id, 'ban2h', r.reported_name)}
              >
                Ban 2h
              </button>
              <button
                className="primary"
                onClick={() => resolve(r.id, 'ban', r.reported_name)}
              >
                Ban forever
              </button>
              <button
                className="link"
                onClick={() => resolve(r.id, 'dismiss', r.reported_name)}
              >
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

      <h2>🔨 Banned users</h2>
      <div className="post-list">
        {bannedUsers.map((u) => (
          <div key={u.id} className="post">
            <div className="post-header">
              <span className="avatar small">
                {u.name?.[0]?.toUpperCase() || '?'}
              </span>
              <strong>{u.name}</strong>
              <span className="muted small">
                {u.banned_until === -1
                  ? 'banned until you lift it'
                  : `banned until ${fmtDate(u.banned_until)}`}
              </span>
            </div>
            <div className="report-actions">
              <button className="link" onClick={() => unban(u)}>
                Unban
              </button>
            </div>
          </div>
        ))}
        {bannedUsers.length === 0 && (
          <p className="muted">Nobody is banned.</p>
        )}
      </div>
    </div>
  )
}
