import { useCallback, useEffect, useRef, useState } from 'react'
import { api, mediaUrl } from './api'
import { fmtTime } from './time'

const POLL_MS = 2000

const EMOJIS = [
  '😀', '😂', '🤣', '😊', '😍', '😘', '😜', '🤪', '😎', '🥳', '🤩', '😇',
  '🙃', '😉', '😋', '😛', '🤗', '🤔', '🤨', '😐', '😑', '🙄', '😏', '😴',
  '😪', '😌', '🤤', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '😱', '😨',
  '😰', '😥', '😢', '😭', '😤', '😡', '🤬', '🤯', '😳', '🥺', '❤️', '🧡',
  '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗',
  '💖', '💘', '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '✌️', '🤞', '👋',
]

const STICKERS = [
  '🌶️', '🔥', '🎉', '🎂', '🎈', '🏆', '⚽', '🏀', '🎮', '🎸', '🍕', '🍔',
  '🍩', '☕', '💯', '👑', '🚀', '⭐', '🌈', '☀️', '🌙', '⚡', '🎁', '🏅',
  '🥇', '🎯', '🎲', '🎧', '📚', '✏️', '🤡', '👻', '💩', '🦄', '🐸', '🐶',
]

// Shrink a picked image before upload: JPEG at max 900px keeps KV small.
// GIFs pass through untouched (compressing would kill the animation).
function compressImage(file) {
  if (file.type === 'image/gif') {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(file)
    })
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.75))
    }
    img.onerror = reject
    img.src = url
  })
}

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
            <span className="chat-item-last">
              {c.last_mine && (
                <span className={c.seen ? 'ticks seen' : 'ticks'}>✓✓ </span>
              )}
              {c.last_kind === 'image'
                ? `📷 Photo${c.last_text ? `: ${c.last_text}` : ''}`
                : c.last_text || 'Say hi!'}
            </span>
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
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState('emoji')
  const bottomRef = useRef(null)
  const fileRef = useRef(null)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!pickerOpen) return
    const close = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [pickerOpen])

  const refresh = useCallback(async () => {
    try {
      const d = chat.group
        ? await api.getGroupMessages(me.id)
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

  const sendImage = async (media) => {
    setBusy(true)
    try {
      await api.sendMessage({
        sender: me.id,
        to: chat.id,
        text: text.trim(),
        kind: 'image',
        media,
      })
      setText('')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await compressImage(file)
      const { id } = await api.uploadMedia(dataUrl)
      await api.sendMessage({
        sender: me.id,
        to: chat.id,
        text: text.trim(),
        kind: 'image',
        media: `media:${id}`,
      })
      setText('')
      await refresh()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const sendLink = () => {
    const url = window.prompt('Paste an image or GIF link')
    const trimmed = url?.trim()
    if (trimmed && /^https?:\/\//.test(trimmed)) sendImage(trimmed)
  }

  const insertEmoji = (e) => setText((t) => t + e)

  const sendSticker = async (emoji) => {
    setPickerOpen(false)
    setBusy(true)
    try {
      await api.sendMessage({
        sender: me.id,
        to: chat.id,
        text: emoji,
        kind: 'sticker',
      })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
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
            {m.kind === 'image' && m.media && (
              <img className="bubble-img" src={mediaUrl(m.media)} alt="photo" />
            )}
            {m.kind === 'sticker' ? (
              <div className="bubble-sticker">{m.text}</div>
            ) : (
              m.text && <div className="bubble-text">{m.text}</div>
            )}
            <div className="bubble-time">
              {fmtTime(m.ts)}
              {m.sender === me.id && (
                <span className={m.seen ? 'ticks seen' : 'ticks'}>✓✓</span>
              )}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <p className="muted center">No messages yet — say hi!</p>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="composer-area" ref={pickerRef}>
        {pickerOpen && (
          <div className="emoji-panel">
            <div className="emoji-tabs">
              <button
                type="button"
                className={pickerTab === 'emoji' ? 'emoji-tab active' : 'emoji-tab'}
                onClick={() => setPickerTab('emoji')}
              >
                Emoji
              </button>
              <button
                type="button"
                className={pickerTab === 'sticker' ? 'emoji-tab active' : 'emoji-tab'}
                onClick={() => setPickerTab('sticker')}
              >
                Stickers
              </button>
            </div>
            <div className="emoji-grid">
              {(pickerTab === 'emoji' ? EMOJIS : STICKERS).map((e) => (
                <button
                  key={e}
                  type="button"
                  className="emoji-btn"
                  onClick={() =>
                    pickerTab === 'emoji' ? insertEmoji(e) : sendSticker(e)
                  }
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        <form className="composer" onSubmit={send}>
          <button
            type="button"
            className="link"
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Emoji and stickers"
            disabled={busy}
          >
            😀
          </button>
          <button
            type="button"
            className="link"
            onClick={() => fileRef.current?.click()}
            aria-label="Send a photo"
            disabled={busy}
          >
            📎
          </button>
          <button type="button" className="link" onClick={sendLink} disabled={busy}>
            GIF
          </button>
        <input
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={pickFile}
        />
        <button className="primary" type="submit" disabled={busy}>
          Send
        </button>
        </form>
      </div>
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
