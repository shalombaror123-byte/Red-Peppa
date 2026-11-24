import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

function fmtBirthday(mmdd) {
  const [month, day] = mmdd.split('-').map(Number)
  return new Date(2000, month - 1, day).toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
  })
}

export default function Birthdays() {
  const [birthdays, setBirthdays] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const d = await api.getBirthdays()
      setBirthdays(d.birthdays)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="board">
      <h2>Birthdays</h2>
      {error && <div className="banner error">{error}</div>}
      <div className="post-list">
        {birthdays?.map((b) => (
          <div key={b.id} className={`post birthday ${b.today ? 'today' : ''}`}>
            <div className="post-header">
              <span className="avatar small">{b.name[0]?.toUpperCase()}</span>
              <strong>{b.name}</strong>
              <span className="muted small">{fmtBirthday(b.birthday)}</span>
            </div>
            <div className="post-text">
              {b.today
                ? '🎂 Today! Wish them happy birthday!'
                : b.days_until === 1
                  ? 'Tomorrow!'
                  : `in ${b.days_until} days`}
            </div>
          </div>
        ))}
        {birthdays && birthdays.length === 0 && (
          <p className="muted">
            No birthdays yet — add yours in the Directory tab (edit your row).
          </p>
        )}
        {!birthdays && !error && <p className="muted">Loading…</p>}
      </div>
    </div>
  )
}
