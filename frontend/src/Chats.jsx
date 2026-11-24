import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { fmtTime } from './time'

const POLL_MS = 2000

function ChatList({ me, onOpen }) {
  const [chats, setChats] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const d = await api.getChatList(me.id)
      setChats(d.chats)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [me.id])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS * 2)
    return () => clearInterval(t)
  }, [refresh])

  if (error) return <div className="banner error">{error}</div>
  if (!chats) return <p className="muted">Loading…</p>

  return (
    <div className="chat-list">
      {chats.map((c) => (
        <button key={c.id} className="chat-item" onClick={() => onOpen(c)}>
          <span className={`avatar ${c.group ? 'group' : ''}`}>
            {c.group ? '👥' : c.name[0]?.toUpperCase()}
          </span>
          <span className="chat-item-body">
            <span className="chat-item-name">{c.name}</span>
            <span className="chat-item-last">{c.last_text || 'Say hi!'}</span>
          </span>
          {c.last_ts > 0 && <span className="chat-item-time">{fmtTime(c.last_ts)}</span>}
        </button>
      ))}
    </div>
  )
}

function ChatWindow({ me, chat, onBack }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const d = chat.group
        ? await api.getGroupMessages()
        : await api.getDmMessages(chat.id, me.id)
      setMessages(d.messages)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [chat, me.id])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const send = async (e) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    setText('')
    try {
      await api.sendMessage({ sender: me.id, to: chat.id, text: trimmed })
      await refresh()
    } catch (err) {
      setError(err.message)
      setText(trimmed)
    }
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        <button className="link" onClick={onBack}>
          ← back
        </button>
        <span className={`avatar ${chat.group ? 'group' : ''}`}>
          {chat.group ? '👥' : chat.name[0]?.toUpperCase()}
        </span>
        <strong>{chat.name}</strong>
      </div>

      <div className="messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`bubble ${m.sender === me.id ? 'mine' : 'theirs'}`}
          >
            {chat.group && m.sender !== me.id && (
              <div className="bubble-sender">{m.sender_name}</div>
            )}
            <div className="bubble-text">{m.text}</div>
            <div className="bubble-time">{fmtTime(m.ts)}</div>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="muted center">No messages yet — say hi!</p>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="banner error">{error}</div>}

      <form className="composer" onSubmit={send}>
        <input
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <button className="primary" type="submit">
          Send
        </button>
      </form>
    </div>
  )
}

export default function Chats({ me }) {
  const [openChat, setOpenChat] = useState(null)

  if (openChat) {
    return <ChatWindow me={me} chat={openChat} onBack={() => setOpenChat(null)} />
  }

  return <ChatList me={me} onOpen={setOpenChat} />
}
