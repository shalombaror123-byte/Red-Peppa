import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { fmtDate } from './time'

export default function Jokes({ me }) {
  const [data, setData] = useState(null)
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const d = await api.getJokes()
      setData(d)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const submit = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      await api.postJoke({ author: me.id, text: text.trim() })
      setText('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const jotd = data?.joke_of_the_day

  return (
    <div className="board">
      <h2>Joke of the Day</h2>

      {jotd ? (
        <div className="jotd-card">
          <div className="jotd-text">"{jotd.text}"</div>
          <div className="muted">— {jotd.author_name}</div>
        </div>
      ) : (
        <p className="muted">No jokes yet — add one below!</p>
      )}

      <form className="post-form" onSubmit={submit}>
        <textarea
          placeholder="Got a joke? Add it to the pile…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add joke'}
        </button>
      </form>

      {error && <div className="banner error">{error}</div>}

      <h3>All jokes</h3>
      <div className="post-list">
        {data?.jokes?.map((j) => (
          <div key={j.id} className="post">
            <div className="post-header">
              <span className="avatar small">
                {j.author_name?.[0]?.toUpperCase() || '?'}
              </span>
              <strong>{j.author_name}</strong>
              <span className="muted small">{fmtDate(j.ts)}</span>
            </div>
            <div className="post-text">{j.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
