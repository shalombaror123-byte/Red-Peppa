import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import Login from './Login'
import Chats from './Chats'
import Statuses from './Statuses'
import Directory from './Directory'
import { PostBoard } from './Boards'
import Jokes from './Jokes'
import Birthdays from './Birthdays'
import './App.css'

const STORAGE_KEY = 'class-app-user-id'
const THEME_KEY = 'class-app-theme'

function ModeTabs({ theme, onToggle }) {
  return (
    <div className="auth-tabs mode-tabs">
      <button
        className={theme === 'light' ? 'auth-tab active' : 'auth-tab'}
        onClick={() => theme !== 'light' && onToggle()}
      >
        light
      </button>
      <button
        className={theme === 'dark' ? 'auth-tab active' : 'auth-tab'}
        onClick={() => theme !== 'dark' && onToggle()}
      >
        dark
      </button>
    </div>
  )
}

const TABS = [
  { id: 'chats', label: 'Chats' },
  { id: 'status', label: 'Status' },
  { id: 'directory', label: 'Directory' },
  { id: 'news', label: 'News' },
  { id: 'study', label: 'Study Help' },
  { id: 'jokes', label: 'Jokes' },
  { id: 'birthdays', label: 'Birthdays' },
]

export default function App() {
  const [users, setUsers] = useState(null)
  const [me, setMe] = useState(null)
  const [tab, setTab] = useState('chats')
  const [error, setError] = useState(null)
  const [theme, setTheme] = useState(
    () => localStorage.getItem(THEME_KEY) || 'dark'
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const footer = (
    <footer className="app-footer">
      <ModeTabs theme={theme} onToggle={toggleTheme} />
    </footer>
  )

  const loadUsers = useCallback(async () => {
    try {
      const d = await api.getUsers()
      setUsers(d.users)
      setError(null)
      return d.users
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [])

  useEffect(() => {
    loadUsers().then((list) => {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && list?.some((u) => u.id === saved)) {
        setMe(list.find((u) => u.id === saved))
      }
    })
    const t = setInterval(loadUsers, 15000)
    return () => clearInterval(t)
  }, [loadUsers])

  const loginAtRef = useRef(0)

  const login = (user) => {
    loginAtRef.current = Date.now()
    localStorage.setItem(STORAGE_KEY, user.id)
    setUsers((list) =>
      list && !list.some((u) => u.id === user.id) ? [...list, user] : list
    )
    setMe(user)
  }

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setMe(null)
    setTab('chats')
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const deleteAccount = async () => {
    setMenuOpen(false)
    if (!window.confirm('Delete your account? This cannot be undone.')) return
    try {
      await api.deleteUser(me.id)
      logout()
    } catch (err) {
      window.alert(err.message)
    }
  }

  // If the account was deleted/reset on the backend, send back to login
  // instead of getting stuck on "User not found". Skip for 30s after
  // sign-in so a stale in-flight users fetch can't bounce a fresh login.
  useEffect(() => {
    if (!me || !users || users.some((u) => u.id === me.id)) return
    if (Date.now() - loginAtRef.current < 30_000) return
    logout()
  }, [me, users, logout])

  if (!me) {
    return (
      <Login
        users={users}
        error={error}
        onLogin={login}
        onRefresh={loadUsers}
        footer={footer}
      />
    )
  }

  return (
    <div className="page">
      <header>
        <div className="header-row">
          <h1>
            <img src="/pepper.png" alt="" className="logo" /> Red Peppa
          </h1>
          <div className="me-chip">
            <span>{me.name}</span>
            <div className="me-menu" ref={menuRef}>
              <button
                className="link menu-btn"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Account menu"
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="me-dropdown">
                  <button onClick={() => { setMenuOpen(false); logout() }}>
                    Sign out
                  </button>
                  <button className="danger" onClick={deleteAccount}>
                    Delete my account
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="tab-content" key={tab}>
        {tab === 'chats' && <Chats me={me} />}
        {tab === 'status' && (
          <Statuses
            me={me}
            users={users}
            onRefresh={loadUsers}
            onMeUpdate={setMe}
          />
        )}
        {tab === 'directory' && (
          <Directory me={me} users={users} onRefresh={loadUsers} onMeUpdate={setMe} />
        )}
        {tab === 'news' && (
          <PostBoard
            title="Class News"
            placeholder="Share news with the class…"
            fetchPosts={api.getNews}
            sendPost={(text) => api.postNews({ author: me.id, text })}
            itemsKey="news"
          />
        )}
        {tab === 'study' && (
          <PostBoard
            title="Study & Homework Help"
            placeholder="Ask a question or share notes…"
            fetchPosts={api.getStudy}
            sendPost={(text, subject) => api.postStudy({ author: me.id, text, subject })}
            itemsKey="posts"
            withSubject
          />
        )}
        {tab === 'jokes' && <Jokes me={me} />}
        {tab === 'birthdays' && <Birthdays />}
      </main>
      {footer}
    </div>
  )
}
