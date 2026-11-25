import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { fmtDate } from './time'

/**
 * Call history: incoming/outgoing/missed calls with a call-back button.
 */
export default function CallLog({ me, onCall }) {
  const [calls, setCalls] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const d = await api.getCallLog(me.id)
      setCalls(d.calls)
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

  if (!calls) return <p className="board-empty">Loading…</p>

  return (
    <div className="call-log">
      {error && <p className="error">{error}</p>}
      {calls.length === 0 && (
        <p className="board-empty">
          No calls yet — tap 📞 inside a chat to start one.
        </p>
      )}
      {calls.map((c) => {
        const outgoing = c.caller === me.id
        const name = outgoing ? c.callee_name : c.caller_name
        const missed = !c.answered
        const dur = c.answered ? Math.max(1, Math.round(c.ended_ts - c.ts)) : 0
        const label = missed
          ? outgoing
            ? 'No answer'
            : 'Missed call'
          : outgoing
            ? 'Outgoing'
            : 'Incoming'
        return (
          <div key={c.id} className="call-log-row">
            <span className="avatar">{name[0]?.toUpperCase()}</span>
            <span className="call-log-body">
              <strong className={missed && !outgoing ? 'missed' : ''}>
                {name}
              </strong>
              <small className={missed && !outgoing ? 'missed' : ''}>
                {outgoing ? '↗' : '↙'} {label}
                {c.video ? ' · video' : ''}
                {dur > 0 &&
                  ` · ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`}
              </small>
            </span>
            <span className="call-log-time">{fmtDate(c.ts)}</span>
            <button
              className="link call-back"
              title={c.video ? 'Video call back' : 'Voice call back'}
              onClick={() =>
                onCall({
                  id: outgoing ? c.callee : c.caller,
                  name,
                  video: c.video,
                })
              }
            >
              {c.video ? '📹' : '📞'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
