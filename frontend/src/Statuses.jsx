import { useEffect, useState } from 'react'
import { api } from './api'
import { fmtAgo } from './time'

export default function Statuses({ me, users, onRefresh, onMeUpdate }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    onRefresh()
    const t = setInterval(onRefresh, 5000)
    return () => clearInterval(t)
  }, [onRefresh])

  const post = async (e) => {
    e.preventDefault()
    const status = text.trim()
    if (!status) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateUser(me.id, { status })
      onMeUpdate(updated)
      setText('')
      onRefresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const meUser = users?.find((u) => u.id === me.id) ?? me
  const withStatus = (users || [])
    .filter((u) => u.status)
    .sort((a, b) => b.status_ts - a.status_ts)

  return (
    <div className="board">
      <h2>Status</h2>

      <form className="post-form" onSubmit={post}>
        <input
          placeholder="What's your status?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={120}
        />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Posting…' : 'Set status'}
        </button>
      </form>
      <p className="muted small">Statuses disappear after 24 hours.</p>

      {meUser.status && (
        <p className="muted your-status">
          Your status: "{meUser.status}"
        </p>
      )}

      {error && <div className="banner error">{error}</div>}

      <div className="post-list">
        {withStatus.map((u) => (
          <div key={u.id} className="post">
            <div className="post-header">
              <span className="avatar small">{u.name[0]?.toUpperCase()}</span>
              <strong>
                {u.name}
                {u.id === me.id && <span className="muted"> (you)</span>}
              </strong>
              <span className="muted small">{fmtAgo(u.status_ts)}</span>
            </div>
            <div className="post-text status-text">{u.status}</div>
          </div>
        ))}
        {users && withStatus.length === 0 && (
          <p className="muted">No statuses yet — set the first one!</p>
        )}
        {!users && !error && <p className="muted">Loading…</p>}
      </div>
    </div>
  )
}
