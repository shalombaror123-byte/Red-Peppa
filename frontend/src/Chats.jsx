import { useCallback, useEffect, useRef, useState } from 'react'
import { api, mediaUrl } from './api'
import { fmtLastSeen, fmtLastSeenShort, fmtTime } from './time'

const POLL_MS = 2000

const EMOJIS = [
  '😀', '😂', '🤣', '😊', '😍', '😘', '😜', '🤪', '😎', '🥳', '🤩', '😇',
  '🙃', '😉', '😋', '😛', '🤗', '🤔', '🤨', '😐', '😑', '🙄', '😏', '😴',
  '😪', '😌', '🤤', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '😱', '😨',
  '😰', '😥', '😢', '😭', '😤', '😡', '🤬', '🤯', '😳', '🥺', '❤️', '🧡',
  '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗',
  '💖', '💘', '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '✌️', '🤞', '👋',
]

const REACT_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

const WAVE_BUCKETS = 36
const DEFAULT_WAVE = [
  0.3, 0.5, 0.7, 0.45, 0.8, 0.6, 0.9, 0.5, 0.35, 0.65, 0.85, 0.4,
  0.55, 0.75, 0.95, 0.5, 0.3, 0.6, 0.8, 0.45, 0.7, 0.9, 0.55, 0.35,
  0.6, 0.75, 0.5, 0.85, 0.4, 0.65, 0.8, 0.45, 0.6, 0.5, 0.35, 0.4,
]

// Turn a recorded blob into ~36 normalized amplitude bars.
async function blobToWave(blob) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const data = buf.getChannelData(0)
    const step = Math.max(1, Math.floor(data.length / WAVE_BUCKETS))
    const wave = []
    for (let i = 0; i < WAVE_BUCKETS; i++) {
      let peak = 0
      const end = Math.min((i + 1) * step, data.length)
      for (let j = i * step; j < end; j += 32) {
        const v = Math.abs(data[j])
        if (v > peak) peak = v
      }
      wave.push(peak)
    }
    ctx.close()
    const max = Math.max(...wave, 0.01)
    return wave.map((v) => Math.max(0.08, Math.round((v / max) * 100) / 100))
  } catch {
    return []
  }
}

function fmtSecs(s) {
  s = Math.max(0, Math.floor(s || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function VoiceMsg({ msg }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const wave = msg.wave?.length ? msg.wave : DEFAULT_WAVE

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setPos(a.currentTime)
    const onMeta = () => setDur(a.duration || 0)
    const onEnd = () => {
      setPlaying(false)
      setPos(0)
    }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('ended', onEnd)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('ended', onEnd)
    }
  }, [])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) {
      a.pause()
    } else {
      a.play().catch(() => {})
    }
    setPlaying(!playing)
  }

  const playedBars = dur ? Math.floor((pos / dur) * wave.length) : 0

  return (
    <div className="voice-msg">
      <audio ref={audioRef} src={mediaUrl(msg.media)} preload="metadata" />
      <button type="button" className="voice-play" onClick={toggle}>
        {playing ? '⏸' : '▶'}
      </button>
      <span className="voice-wave">
        {wave.map((h, i) => (
          <i
            key={i}
            className={i < playedBars ? 'wbar played' : 'wbar'}
            style={{ height: `${6 + h * 24}px` }}
          />
        ))}
      </span>
      <span className="voice-dur">{fmtSecs(playing ? pos : dur)}</span>
    </div>
  )
}

const GIFS = [
  'mindblown', 'facepalm', 'pulpfiction', 'surprised-pikachu', 'homerbush',
  'nod', 'hellno', 'nope', 'nopesimpsons', 'notsure', 'woohoo',
  'itshappening', 'entertained', 'kermit', 'kidthumbsup', 'gladiatorthumbsup',
  'excellentburns', 'whatever', 'magic', 'makeitrain', 'thinkaboutit',
  'themoreyouknow', 'ohsnap', 'doit', 'butwhy', 'babyconfused', 'grimacing',
  'disappointed-fan', 'evil-laughter', 'idowhatiwant', 'jokerclapping',
  'panda', 'patrick', 'raiseglass', 'yougotitdude', '9000',
  'holdontoyourbutts', 'bees', 'goodgood', 'stopgirl', 'itsatrap',
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

function ChatList({ me, onOpen, unread }) {
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
        <button
          key={c.id}
          className={unread?.has(c.id) ? 'chat-item unread' : 'chat-item'}
          onClick={() => onOpen(c)}
        >
          <span className={`avatar ${c.group ? 'group' : ''}`}>
            {c.group ? '👥' : c.name[0]?.toUpperCase()}
          </span>
          <span className="chat-item-body">
            <span className="chat-item-name">
              {c.name}
              {!c.group && c.last_seen > 0 && (
                <small
                  className={
                    Date.now() / 1000 - c.last_seen < 75
                      ? 'presence online'
                      : 'presence'
                  }
                >
                  {' '}
                  · {fmtLastSeenShort(c.last_seen)}
                </small>
              )}
              {unread?.has(c.id) && <span className="unread-dot" />}
            </span>
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

function ChatWindow({ me, chat, onBack, onCall }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState('emoji')
  const [msgMenu, setMsgMenu] = useState(null)
  const [editing, setEditing] = useState(null)
  const [reactFor, setReactFor] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [typing, setTyping] = useState([])
  const [peerSeen, setPeerSeen] = useState(chat.last_seen || 0)
  const [callMenu, setCallMenu] = useState(false)
  const typingSent = useRef(0)
  const bottomRef = useRef(null)
  const fileRef = useRef(null)
  const pickerRef = useRef(null)
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const recRef = useRef(null)
  const recChunks = useRef([])
  const recTimer = useRef(null)

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
      setTyping(d.typing || [])
      if (!chat.group) setPeerSeen(d.peer_last_seen || 0)
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
      if (editing) {
        await api.editMessage(editing.id, { text: trimmed })
        setEditing(null)
      } else {
        await api.sendMessage({
          sender: me.id,
          to: chat.id,
          text: trimmed,
          reply_to: replyTo,
        })
        setReplyTo(null)
      }
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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      const rec = new MediaRecorder(stream)
      recChunks.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size) recChunks.current.push(e.data)
      }
      recRef.current = rec
      rec.start()
      setRecSecs(0)
      recTimer.current = setInterval(() => setRecSecs((s) => s + 1), 1000)
      setRecording(true)
    } catch {
      setError('Microphone access denied — allow mic to send voice messages')
    }
  }

  const stopRecording = (sendIt) => {
    const rec = recRef.current
    if (!rec) return
    clearInterval(recTimer.current)
    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop())
      recRef.current = null
      setRecording(false)
      const blob = new Blob(recChunks.current, {
        type: rec.mimeType || 'audio/webm',
      })
      recChunks.current = []
      if (!sendIt || blob.size < 500) return
      setBusy(true)
      try {
        const [dataUrl, wave] = await Promise.all([
          new Promise((res, rej) => {
            const fr = new FileReader()
            fr.onload = () => res(fr.result)
            fr.onerror = rej
            fr.readAsDataURL(blob)
          }),
          blobToWave(blob),
        ])
        const { id } = await api.uploadMedia(dataUrl)
        await api.sendMessage({
          sender: me.id,
          to: chat.id,
          text: '',
          kind: 'audio',
          media: `media:${id}`,
          wave,
        })
        await refresh()
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(false)
      }
    }
    rec.stop()
  }

  const sendLink = () => {
    const url = window.prompt('Paste an image or GIF link')
    const trimmed = url?.trim()
    if (trimmed && /^https?:\/\//.test(trimmed)) sendImage(trimmed)
  }

  const sendGif = async (name) => {
    setPickerOpen(false)
    try {
      await api.sendMessage({
        sender: me.id,
        to: chat.id,
        text: '',
        kind: 'image',
        media: `/gifs/${name}.gif`,
      })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const deleteMsg = async (id) => {
    if (!window.confirm('Delete this message for everyone?')) return
    try {
      await api.deleteMessage(id)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const react = async (m, emoji) => {
    setMsgMenu(null)
    try {
      await api.reactMessage(m.id, { user: me.id, emoji })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const reportMsg = async (m) => {
    const name = m.sender_name || chat.name
    if (!window.confirm(`Report this message from ${name} to the admin?`))
      return
    try {
      await api.reportMessage({ reporter: me.id, message_id: m.id })
      window.alert('Reported — the admin will review it.')
    } catch (err) {
      setError(err.message)
    }
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
        <span className="chat-peer">
          <strong>{chat.name}</strong>
          {!chat.group && (
            <small
              className={
                peerSeen && Date.now() / 1000 - peerSeen < 75
                  ? 'presence online'
                  : 'presence'
              }
            >
              {fmtLastSeen(peerSeen)}
            </small>
          )}
        </span>
        {!chat.group && onCall && (
          <span className="call-menu-wrap">
            <button
              className="link call-btn"
              onClick={() => setCallMenu((o) => !o)}
              title="Call"
            >
              📞
            </button>
            {callMenu && (
              <span className="msg-menu call-menu">
                <button
                  className="menu-item"
                  onClick={() => {
                    setCallMenu(false)
                    onCall({ id: chat.id, name: chat.name, video: false })
                  }}
                >
                  📞 Voice call
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setCallMenu(false)
                    onCall({ id: chat.id, name: chat.name, video: true })
                  }}
                >
                  📹 Video call
                </button>
              </span>
            )}
          </span>
        )}
      </div>

      <div className="messages">
        {msgMenu && (
          <div className="msg-overlay" onClick={() => setMsgMenu(null)} />
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`bubble ${m.sender === me.id ? 'mine' : 'theirs'}${msgMenu === m.id ? ' menu-open' : ''}`}
          >
            <span className="msg-menu-wrap">
              <button
                className="msg-menu-btn"
                onClick={() => {
                  setMsgMenu(msgMenu === m.id ? null : m.id)
                  setReactFor(null)
                }}
                title="Message options"
              >
                ⋮
              </button>
              {msgMenu === m.id && (
                <span className="msg-menu">
                  {reactFor === m.id ? (
                    <span className="react-row">
                      {REACT_EMOJIS.map((e) => (
                        <button
                          key={e}
                          className={
                            (m.reactions || []).some(
                              (r) => r.user === me.id && r.emoji === e
                            )
                              ? 'react-btn mine'
                              : 'react-btn'
                          }
                          onClick={() => react(m, e)}
                        >
                          {e}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <>
                      <button
                        className="menu-item"
                        onClick={() => setReactFor(m.id)}
                      >
                        😀 React
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => {
                          setReplyTo({
                            name:
                              m.sender === me.id
                                ? me.name
                                : m.sender_name || chat.name,
                            text:
                              m.kind === 'image'
                                ? '📷 Photo'
                                : (m.text || '').slice(0, 80),
                          })
                          setEditing(null)
                          setMsgMenu(null)
                        }}
                      >
                        ↩ Reply
                      </button>
                      {m.sender !== me.id && (
                        <button
                          className="menu-item"
                          onClick={() => {
                            setMsgMenu(null)
                            reportMsg(m)
                          }}
                        >
                          🚩 Report
                        </button>
                      )}
                      {m.sender === me.id &&
                        (m.kind || 'text') === 'text' && (
                          <button
                            className="menu-item"
                            onClick={() => {
                              setEditing(m)
                              setText(m.text)
                              setReplyTo(null)
                              setMsgMenu(null)
                            }}
                          >
                            Edit
                          </button>
                        )}
                      {m.sender === me.id && (
                        <button
                          className="menu-item danger"
                          onClick={() => {
                            setMsgMenu(null)
                            deleteMsg(m.id)
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </span>
              )}
            </span>
            {chat.group && m.sender !== me.id && (
              <div className="bubble-sender">{m.sender_name}</div>
            )}
            {m.reply_to && (
              <div className="reply-quote">
                <strong>{m.reply_to.name}</strong>
                <div>{m.reply_to.text}</div>
              </div>
            )}
            {m.kind === 'image' && m.media && (
              <img className="bubble-img" src={mediaUrl(m.media)} alt="photo" />
            )}
            {m.kind === 'audio' && m.media && <VoiceMsg msg={m} />}
            {m.kind === 'sticker' ? (
              <div className="bubble-sticker">{m.text}</div>
            ) : (
              m.text && <div className="bubble-text">{m.text}</div>
            )}
            {(m.reactions || []).length > 0 && (
              <div className="reactions">
                {Object.entries(
                  m.reactions.reduce((acc, r) => {
                    acc[r.emoji] = acc[r.emoji] || { count: 0, mine: false }
                    acc[r.emoji].count++
                    if (r.user === me.id) acc[r.emoji].mine = true
                    return acc
                  }, {})
                ).map(([emoji, info]) => (
                  <button
                    key={emoji}
                    className={info.mine ? 'reaction-chip mine' : 'reaction-chip'}
                    onClick={() => react(m, emoji)}
                  >
                    {emoji}
                    {info.count > 1 && ` ${info.count}`}
                  </button>
                ))}
              </div>
            )}
            <div className="bubble-time">
              {m.edited && <span className="edited-tag">edited</span>}
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

      {typing.length > 0 && (
        <div className="typing-line">
          {typing.join(', ')} {typing.length === 1 ? 'is' : 'are'} typing…
        </div>
      )}

      <div className="composer-area" ref={pickerRef}>
        {editing && (
          <div className="editing-bar">
            <span>Editing message</span>
            <button
              className="link"
              onClick={() => {
                setEditing(null)
                setText('')
              }}
            >
              ✕
            </button>
          </div>
        )}
        {replyTo && (
          <div className="editing-bar">
            <span>
              Replying to <strong>{replyTo.name}</strong>: {replyTo.text}
            </span>
            <button className="link" onClick={() => setReplyTo(null)}>
              ✕
            </button>
          </div>
        )}
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
              <button
                type="button"
                className={pickerTab === 'gif' ? 'emoji-tab active' : 'emoji-tab'}
                onClick={() => setPickerTab('gif')}
              >
                GIFs
              </button>
            </div>
            {pickerTab === 'gif' ? (
              <div className="emoji-grid gif-grid">
                <button
                  type="button"
                  className="gif-cell link"
                  onClick={() => {
                    setPickerOpen(false)
                    sendLink()
                  }}
                >
                  🔗 link
                </button>
                {GIFS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className="gif-cell"
                    onClick={() => sendGif(g)}
                  >
                    <img src={`/gifs/${g}.gif`} alt={g} loading="lazy" />
                  </button>
                ))}
              </div>
            ) : (
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
            )}
          </div>
        )}
        {recording ? (
          <div className="composer rec-bar">
            <span className="rec-dot" />
            <span className="rec-time">
              {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}
            </span>
            <button
              type="button"
              className="link"
              onClick={() => stopRecording(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => stopRecording(true)}
            >
              Send 🎤
            </button>
          </div>
        ) : (
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
          <button
            type="button"
            className="link"
            onClick={() => {
              setPickerTab('gif')
              setPickerOpen(true)
            }}
            disabled={busy}
          >
            GIF
          </button>
          <button
            type="button"
            className="link"
            onClick={startRecording}
            aria-label="Record a voice message"
            disabled={busy}
          >
            🎤
          </button>
        <input
          placeholder="Type a message…"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const now = Date.now()
            if (now - typingSent.current > 3000) {
              typingSent.current = now
              api
                .sendTyping({ user: me.id, to: chat.id })
                .catch(() => {})
            }
          }}
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
        )}
      </div>
    </div>
  )
}

export default function Chats({ me, onChatRead, unread, onCall }) {
  const [openChat, setOpenChat] = useState(null)

  const open = (c) => {
    setOpenChat(c)
    onChatRead?.(c.id)
  }

  if (openChat) {
    return (
      <ChatWindow
        me={me}
        chat={openChat}
        onBack={() => setOpenChat(null)}
        onCall={onCall}
      />
    )
  }

  return <ChatList me={me} onOpen={open} unread={unread} />
}
