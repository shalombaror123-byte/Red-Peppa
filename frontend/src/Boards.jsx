import { useCallback, useEffect, useState } from 'react'
import { fmtDate } from './time'

/**
 * Shared board used for News and Study Help: a post box on top,
 * newest-first list of posts below.
 */
export function PostBoard({
  title,
  placeholder,
  fetchPosts,
  sendPost,
  itemsKey,
  withSubject = false,
}) {
  const [items, setItems] = useState(null)
  const [text, setText] = useState('')
  const [subject, setSubject] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const d = await fetchPosts()
      setItems(d[itemsKey])
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [fetchPosts, itemsKey])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [refresh])

  const submit = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      await sendPost(text.trim(), subject.trim())
      setText('')
      setSubject('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="board">
      <h2>{title}</h2>
      <form className="post-form" onSubmit={submit}>
        {withSubject && (
          <input
            className="subject-input"
            placeholder="Subject (e.g. Math, English) — optional"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        )}
        <textarea
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </form>

      {error && <div className="banner error">{error}</div>}

      <div className="post-list">
        {items?.map((item) => (
          <div key={item.id} className="post">
            <div className="post-header">
              <span className="avatar small">
                {item.author_name?.[0]?.toUpperCase() || '?'}
              </span>
              <strong>{item.author_name}</strong>
              {item.subject && <span className="subject-chip">{item.subject}</span>}
              <span className="muted small">{fmtDate(item.ts)}</span>
            </div>
            <div className="post-text">{item.text}</div>
          </div>
        ))}
        {items && items.length === 0 && (
          <p className="muted">Nothing yet — post the first one!</p>
        )}
        {!items && !error && <p className="muted">Loading…</p>}
      </div>
    </div>
  )
}
