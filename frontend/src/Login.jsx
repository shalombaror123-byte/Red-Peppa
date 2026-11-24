import { useState } from 'react'
import { api } from './api'
import PasswordInput from './PasswordInput'
import { formatBirthdayInput } from './time'

export default function Login({ users, error, onLogin, onRefresh, footer }) {
  const [mode, setMode] = useState('join') // 'login' | 'join'
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [birthday, setBirthday] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState(null)

  const switchMode = (m) => {
    setMode(m)
    setFormError(null)
  }

  const submitLogin = async (e) => {
    e.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      const user = await api.login(name.trim(), password)
      onLogin(user)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const join = async (e) => {
    e.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      const user = await api.addUser({
        name: newName.trim(),
        password: newPassword,
        phone: phone.trim(),
        email: email.trim(),
        birthday: birthday.trim(),
      })
      onLogin(user)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page login-page">
      <div className="login-main">
        <div className="login-brand">
          <img src="/pepper.svg" alt="Red Peppa" className="logo-big" />
          <h1>Red Peppa</h1>
          <p className="muted">The class chat — log in or join your class.</p>
        </div>

        <div className="login-auth">
      {error && (
        <div className="banner error">
          Backend unreachable: {error}{' '}
          <button className="link" onClick={onRefresh}>
            retry
          </button>
        </div>
      )}

      <div className="auth-tabs">
        <button
          className={mode === 'join' ? 'auth-tab active' : 'auth-tab'}
          onClick={() => switchMode('join')}
        >
          Sign up
        </button>
        <button
          className={mode === 'login' ? 'auth-tab active' : 'auth-tab'}
          onClick={() => switchMode('login')}
        >
          Log in
        </button>
      </div>

      {mode === 'login' ? (
        <form className="join-form" onSubmit={submitLogin}>
          <input
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <PasswordInput
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
          {formError && <div className="banner error">{formError}</div>}
          {users && users.length === 0 && (
            <p className="muted small center">
              Nobody has joined yet — hit Sign up to be the first!
            </p>
          )}
        </form>
      ) : (
        <form className="join-form" onSubmit={join}>
          <input
            placeholder="Your name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            required
          />
          <PasswordInput
            placeholder="Pick a password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <input
            placeholder="Phone number (for the directory)"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <input
            placeholder="Gmail (for the directory)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label className="muted small">
            Birthday (MM-DD, e.g. 03-14)
            <input
              placeholder="MM-DD"
              value={birthday}
              onChange={(e) => setBirthday(formatBirthdayInput(e.target.value))}
              pattern="\d{2}-\d{2}"
              inputMode="numeric"
              required
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Joining…' : 'Join the class'}
          </button>
          {formError && <div className="banner error">{formError}</div>}
        </form>
      )}
        </div>
      </div>
      {footer}
    </div>
  )
}
