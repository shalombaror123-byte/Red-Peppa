import { useState } from 'react'
import { api } from './api'
import PasswordInput from './PasswordInput'
import { formatBirthdayInput } from './time'

function fmtBirthday(mmdd) {
  if (!mmdd) return '—'
  const [month, day] = mmdd.split('-').map(Number)
  if (!month || !day) return '—'
  return new Date(2000, month - 1, day).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

function EditRow({ me, onDone, onMeUpdate }) {
  const [phone, setPhone] = useState(me.phone)
  const [email, setEmail] = useState(me.email)
  const [birthday, setBirthday] = useState(me.birthday)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateUser(me.id, { phone, email, birthday, password })
      onMeUpdate(updated)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="directory-edit">
      <input
        placeholder="Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <input
        placeholder="Gmail"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        placeholder="Birthday MM-DD"
        value={birthday}
        onChange={(e) => setBirthday(formatBirthdayInput(e.target.value))}
        pattern="\d{2}-\d{2}"
        inputMode="numeric"
      />
      <PasswordInput
        placeholder="New password (leave blank to keep current)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button className="primary" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button className="link" onClick={onDone}>
        cancel
      </button>
      {error && <div className="banner error">{error}</div>}
    </div>
  )
}

export default function Directory({ me, users, onRefresh, onMeUpdate }) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="directory">
      <h2>Class Directory</h2>

      <div className="table-scroll">
        <table className="directory-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Birthday</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <tr key={u.id} className={u.id === me.id ? 'me-row' : ''}>
              <td>
                <span className="avatar small">{u.name[0]?.toUpperCase()}</span>{' '}
                {u.name}
                {u.id === me.id && <span className="muted"> (you)</span>}
              </td>
              <td>
                {u.phone ? <a href={`tel:${u.phone}`}>{u.phone}</a> : '—'}
              </td>
              <td>
                {u.email ? <a href={`mailto:${u.email}`}>{u.email}</a> : '—'}
              </td>
              <td>{fmtBirthday(u.birthday)}</td>
              <td>
                {u.id === me.id && !editing && (
                  <button className="link" onClick={() => setEditing(true)}>
                    edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>

      {editing && (
        <EditRow me={me} onDone={() => { setEditing(false); onRefresh() }} onMeUpdate={onMeUpdate} />
      )}

      {!users && <p className="muted">Loading…</p>}
    </div>
  )
}
