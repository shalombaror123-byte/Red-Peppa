import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import Login from './Login'
import Chats from './Chats'
import Statuses from './Statuses'
import Directory from './Directory'
import { PostBoard } from './Boards'
import Jokes from './Jokes'
import Birthdays from './Birthdays'
import CallManager from './Call'
import { playDing, resumeAudio } from './sound'
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
  { id: 'important', label: 'Important' },
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
  const [annUnread, setAnnUnread] = useState(false)
  const [callPeer, setCallPeer] = useState(null)
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

  // Watch for new incoming messages and fire a browser notification when
  // the user isn't looking at the tab (same as WhatsApp Web).
  const lastMsgTs = useRef({})
  const unreadChats = useRef(new Set())
  const baseTitle = useRef(null)
  const baseIcon = useRef(null)

  // Google-Chat-style tab badge: red dot on the favicon + (n) in title.
  const setBadge = useCallback((count) => {
    baseTitle.current ??= document.title
    document.title =
      count > 0 ? `(${count}) ${baseTitle.current}` : baseTitle.current
    let link = document.querySelector("link[rel~='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    baseIcon.current ??= link.href
    if (count === 0) {
      link.href = baseIcon.current
      return
    }
    const img = new Image()
    img.onload = () => {
      if (unreadChats.current.size === 0) return
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, 64, 64)
      ctx.fillStyle = '#e53935'
      ctx.beginPath()
      ctx.arc(46, 18, 15, 0, Math.PI * 2)
      ctx.fill()
      link.href = canvas.toDataURL('image/png')
    }
    img.src = baseIcon.current
  }, [])

  // Clear a chat's unread badge once the user opens that conversation.
  const markChatRead = useCallback(
    (chatId) => {
      if (unreadChats.current.delete(chatId)) {
        setBadge(unreadChats.current.size)
      }
    },
    [setBadge]
  )

  useEffect(() => {
    if (!me) return
    lastMsgTs.current = {}
    unreadChats.current.clear()
    let alive = true
    const check = async () => {
      try {
        const [d, ann] = await Promise.all([
          api.getChatList(me.id),
          api.getAnnouncements(),
        ])
        if (!alive) return
        const map = lastMsgTs.current
        const newest = ann.announcements[0]
        if (newest) {
          const prev = map['__ann']
          map['__ann'] = newest.ts
          if (prev !== undefined && newest.ts > prev && newest.author !== me.id) {
            playDing()
            if (
              !(document.visibilityState === 'visible' && document.hasFocus())
            ) {
              unreadChats.current.add('important')
              setBadge(unreadChats.current.size)
              setAnnUnread(true)
              if (
                'Notification' in window &&
                Notification.permission === 'granted'
              ) {
                new Notification('📢 Important announcement', {
                  body: `${newest.author_name}: ${newest.text}`,
                  icon: '/pepper.png',
                })
              }
            }
          }
        }
        for (const c of d.chats) {
          const prev = map[c.id]
          map[c.id] = c.last_ts
          if (prev === undefined || c.last_ts <= prev || c.last_mine) continue
          playDing()
          if (!(document.visibilityState === 'visible' && document.hasFocus())) {
            unreadChats.current.add(c.id)
            setBadge(unreadChats.current.size)
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(c.name, {
                body: c.last_kind === 'image' ? '📷 Photo' : c.last_text,
                icon: '/pepper.png',
              })
            }
          }
        }
      } catch {
        // ignore transient poll errors
      }
    }
    check()
    const t = setInterval(check, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [me])

  // Browsers only allow audio after a user gesture — resume the shared
  // context on any tap so the first ding isn't silent.
  useEffect(() => {
    const unlock = () => {
      resumeAudio()
    }
    document.addEventListener('pointerdown', unlock)
    return () => document.removeEventListener('pointerdown', unlock)
  }, [])

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
              onClick={() => {
                setTab(t.id)
                if (t.id === 'important') {
                  setAnnUnread(false)
                  markChatRead('important')
                }
              }}
            >
              {t.label}
              {t.id === 'important' && annUnread && (
                <span className="tab-dot" />
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="tab-content" key={tab}>
        {tab === 'chats' && (
          <Chats
            me={me}
            onChatRead={markChatRead}
            unread={unreadChats.current}
            onCall={setCallPeer}
          />
        )}
        {tab === 'important' && (
          <PostBoard
            title="Important Announcements"
            placeholder="Post an important announcement…"
            fetchPosts={api.getAnnouncements}
            sendPost={(text) => api.postAnnouncement({ author: me.id, text })}
            itemsKey="announcements"
          />
        )}
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
      <CallManager
        me={me}
        outgoing={callPeer}
        onDone={() => setCallPeer(null)}
      />
    </div>
  )
}
