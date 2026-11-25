import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { playDing, startRing, stopRing } from './sound'

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const RING_FRESH_SEC = 45 // ignore ringing calls older than this

/**
 * Video-call manager: polls the backend for incoming calls, runs the
 * WebRTC handshake (offer/answer/candidates/hand/chat are relayed through
 * the API), and renders the incoming-call and in-call overlays.
 * `outgoing` is {id, name} of the user to call; `onDone` clears it.
 */
export default function CallManager({ me, outgoing, onDone }) {
  const [incoming, setIncoming] = useState(null)
  const [active, setActive] = useState(null) // {id, peerName, role, status}
  const [seconds, setSeconds] = useState(0)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [handUp, setHandUp] = useState(false)
  const [remoteHand, setRemoteHand] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [callChat, setCallChat] = useState([])
  const [chatDraft, setChatDraft] = useState('')
  const pcRef = useRef(null)
  const streamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const remoteRef = useRef(null)
  const localRef = useRef(null)
  const videoSenderRef = useRef(null)
  const camTrackRef = useRef(null)
  const chatBottomRef = useRef(null)
  const pollRef = useRef(null)
  const ringRef = useRef(null)
  const callIdRef = useRef(null)
  const answeredRef = useRef(false)
  const pendingCands = useRef([])
  const connTimeoutRef = useRef(null)
  const offer2HandledRef = useRef(false)
  const waitingAnswer2Ref = useRef(false)
  const [upgrading, setUpgrading] = useState(false)

  const stopAll = useCallback(() => {
    clearInterval(pollRef.current)
    pollRef.current = null
    clearTimeout(connTimeoutRef.current)
    connTimeoutRef.current = null
    stopRing(ringRef)
    pcRef.current?.close()
    pcRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    callIdRef.current = null
    answeredRef.current = false
    offer2HandledRef.current = false
    waitingAnswer2Ref.current = false
    setUpgrading(false)
    pendingCands.current = []
    videoSenderRef.current = null
    camTrackRef.current = null
    setActive(null)
    setIncoming(null)
    setSeconds(0)
    setMicOn(true)
    setCamOn(true)
    setSharing(false)
    setHandUp(false)
    setRemoteHand(false)
    setChatOpen(false)
    setCallChat([])
    setChatDraft('')
    onDone?.()
  }, [onDone])

  const endCall = useCallback(
    async (id) => {
      if (id) {
        try {
          await api.endCall(id)
        } catch {
          // call doc may already be gone
        }
      }
      stopAll()
    },
    [stopAll]
  )

  const getMedia = async (video) => {
    if (video) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 640 } },
        })
      } catch {
        // camera denied — fall back to audio-only
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: true })
  }

  const attachPC = useCallback(
    (who) => {
      const pc = new RTCPeerConnection(RTC_CONFIG)
      pcRef.current = pc
      pc.onicecandidate = (e) => {
        if (!e.candidate) return
        const cand = e.candidate.toJSON()
        if (callIdRef.current) {
          api
            .callCandidate(callIdRef.current, { who, candidate: cand })
            .catch(() => {})
        } else {
          pendingCands.current.push(cand)
        }
      }
      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0]
        if (remoteRef.current) {
          remoteRef.current.srcObject = e.streams[0]
          remoteRef.current.play().catch(() => {})
        }
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          clearTimeout(connTimeoutRef.current)
          setActive((a) => (a ? { ...a, status: 'in call' } : a))
        } else if (['failed', 'closed'].includes(pc.connectionState)) {
          endCall(callIdRef.current)
        }
      }
      // If no connection within 30s, say so instead of spinning forever.
      clearTimeout(connTimeoutRef.current)
      connTimeoutRef.current = setTimeout(() => {
        if (pcRef.current?.connectionState === 'connected') return
        setActive((a) =>
          a
            ? {
                ...a,
                status:
                  a.status === 'calling…' ? 'no answer' : "couldn't connect",
              }
            : a
        )
        setTimeout(() => endCall(callIdRef.current), 3500)
      }, 30000)
      streamRef.current
        .getTracks()
        .forEach((t) => pc.addTrack(t, streamRef.current))
      videoSenderRef.current =
        pc.getSenders().find((s) => s.track?.kind === 'video') || null
      camTrackRef.current =
        streamRef.current.getVideoTracks()[0] || null
      setCamOn(Boolean(camTrackRef.current))
      return pc
    },
    [endCall]
  )

  const flushCands = (id, who) => {
    for (const c of pendingCands.current) {
      api.callCandidate(id, { who, candidate: c }).catch(() => {})
    }
    pendingCands.current = []
  }

  // Both sides poll the call doc: caller waits for the answer, everyone
  // drains the other side's ICE candidates, hand flag, and chat.
  const pollCall = useCallback(
    (callId, remoteKey, remoteHand, role) => {
      let consumed = 0
      clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const c = await api.getCall(callId)
          if (c.state === 'ended') {
            stopAll()
            return
          }
          if (role === 'caller' && c.answer && !answeredRef.current) {
            answeredRef.current = true
            await pcRef.current?.setRemoteDescription(c.answer)
            setActive((a) => (a ? { ...a, status: 'connecting…' } : a))
          }
          // Mid-call upgrade: peer offered video on a running voice call.
          if (c.offer2 && !offer2HandledRef.current) {
            offer2HandledRef.current = true
            try {
              await pcRef.current?.setRemoteDescription(c.offer2)
              try {
                const cam = await navigator.mediaDevices.getUserMedia({
                  video: { width: { ideal: 640 } },
                })
                const track = cam.getVideoTracks()[0]
                streamRef.current.addTrack(track)
                camTrackRef.current = track
                videoSenderRef.current = pcRef.current.addTrack(
                  track,
                  streamRef.current
                )
                setCamOn(true)
              } catch {
                // camera denied — we still receive their video one-way
              }
              await pcRef.current.setLocalDescription(
                await pcRef.current.createAnswer()
              )
              await api.answer2Call(callId, {
                sdp: pcRef.current.localDescription,
              })
              setActive((a) => (a ? { ...a, video: true } : a))
            } catch {
              offer2HandledRef.current = false
            }
          }
          // Our upgrade offer was answered.
          if (c.answer2 && waitingAnswer2Ref.current) {
            waitingAnswer2Ref.current = false
            try {
              await pcRef.current?.setRemoteDescription(c.answer2)
              setActive((a) => (a ? { ...a, video: true } : a))
            } catch {
              // bad answer — stay on voice
            }
          }
          setRemoteHand(Boolean(c[remoteHand]))
          setCallChat(c.chat || [])
          const list = c[remoteKey] || []
          for (; consumed < list.length; consumed++) {
            try {
              await pcRef.current?.addIceCandidate(list[consumed])
            } catch {
              // malformed/duplicate candidate — skip
            }
          }
        } catch {
          // transient poll error
        }
      }, 2000)
    },
    [stopAll]
  )

  // Watch for incoming calls while idle.
  useEffect(() => {
    if (!me) return
    const t = setInterval(async () => {
      if (active || incoming) return
      try {
        const { call } = await api.incomingCall(me.id)
        if (
          call &&
          Date.now() / 1000 - call.ts < RING_FRESH_SEC &&
          callIdRef.current !== call.id
        ) {
          setIncoming(call)
          startRing(ringRef)
        }
      } catch {
        // transient poll error
      }
    }, 4000)
    return () => clearInterval(t)
  }, [me, active, incoming])

  // Outgoing call: media → offer → POST call → poll for answer.
  useEffect(() => {
    if (!outgoing || active) return
    let cancelled = false
    ;(async () => {
      try {
        streamRef.current = await getMedia(outgoing.video)
        const pc = attachPC('caller')
        await pc.setLocalDescription(await pc.createOffer())
        const { id } = await api.startCall({
          caller: me.id,
          callee: outgoing.id,
          offer: pc.localDescription,
          video: Boolean(outgoing.video),
        })
        callIdRef.current = id
        flushCands(id, 'caller')
        if (cancelled) {
          api.endCall(id).catch(() => {})
          return
        }
        setActive({
          id,
          peerName: outgoing.name,
          role: 'caller',
          status: 'calling…',
          video: Boolean(outgoing.video),
        })
        pollCall(id, 'cand_callee', 'hand_callee', 'caller')
      } catch {
        if (!cancelled) stopAll()
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outgoing])

  const accept = async () => {
    const call = incoming
    stopRing(ringRef)
    setIncoming(null)
    try {
      streamRef.current = await getMedia(call.video)
      callIdRef.current = call.id
      const pc = attachPC('callee')
      await pc.setRemoteDescription(call.offer)
      await pc.setLocalDescription(await pc.createAnswer())
      await api.answerCall(call.id, { answer: pc.localDescription })
      flushCands(call.id, 'callee')
      setActive({
        id: call.id,
        peerName: call.caller_name,
        role: 'callee',
        status: 'connecting…',
        video: Boolean(call.video),
      })
      pollCall(call.id, 'cand_caller', 'hand_caller', 'callee')
    } catch {
      stopAll()
    }
  }

  const decline = () => {
    api.endCall(incoming.id).catch(() => {})
    stopAll()
  }

  // Attach local video preview whenever the call overlay is up.
  useEffect(() => {
    if (active && localRef.current && streamRef.current) {
      localRef.current.srcObject = streamRef.current
    }
  }, [active, camOn])

  // Reattach remote stream if tracks arrived before the element mounted.
  useEffect(() => {
    if (remoteRef.current && remoteStreamRef.current) {
      remoteRef.current.srcObject = remoteStreamRef.current
      remoteRef.current.play().catch(() => {})
    }
  }, [active])

  // Ringback tone while the other side hasn't picked up yet.
  useEffect(() => {
    if (active?.status === 'calling…') {
      startRing(ringRef)
      return () => stopRing(ringRef)
    }
  }, [active?.status])

  const toggleMic = () => {
    const t = streamRef.current?.getAudioTracks()[0]
    if (t) {
      t.enabled = !micOn
      setMicOn(!micOn)
    }
  }

  // Upgrade a running voice call to video: add a camera track to the
  // live peer connection and renegotiate through the call doc.
  const switchToVideo = async () => {
    if (upgrading) return
    setUpgrading(true)
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 } },
      })
      const track = cam.getVideoTracks()[0]
      streamRef.current.addTrack(track)
      camTrackRef.current = track
      videoSenderRef.current = pcRef.current.addTrack(
        track,
        streamRef.current
      )
      setCamOn(true)
      await pcRef.current.setLocalDescription(
        await pcRef.current.createOffer()
      )
      waitingAnswer2Ref.current = true
      await api.offer2Call(callIdRef.current, {
        sdp: pcRef.current.localDescription,
      })
    } catch {
      // camera denied or renegotiation failed — stay on voice
    }
    setUpgrading(false)
  }

  const toggleCam = () => {
    const t = camTrackRef.current
    if (t) {
      t.enabled = !camOn
      setCamOn(!camOn)
    }
  }

  const toggleShare = async () => {
    if (!sharing) {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        })
        const track = screen.getVideoTracks()[0]
        track.onended = () => {
          videoSenderRef.current
            ?.replaceTrack(camTrackRef.current)
            .catch(() => {})
          setSharing(false)
        }
        await videoSenderRef.current?.replaceTrack(track)
        setSharing(true)
      } catch {
        // user cancelled the picker — stay on camera
      }
    } else {
      await videoSenderRef.current?.replaceTrack(camTrackRef.current)
      setSharing(false)
    }
  }

  const toggleHand = () => {
    const up = !handUp
    setHandUp(up)
    api
      .handCall(callIdRef.current, {
        who: active.role,
        up,
      })
      .catch(() => {})
  }

  const sendCallChat = async (e) => {
    e.preventDefault()
    const text = chatDraft.trim()
    if (!text) return
    setChatDraft('')
    try {
      await api.chatCall(callIdRef.current, {
        who: active.role,
        name: me.name,
        text,
      })
    } catch {
      // transient — message drops, acceptable
    }
  }

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [callChat.length])

  // In-call duration timer.
  useEffect(() => {
    if (active?.status !== 'in call') return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [active?.status])

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <>
      {incoming && (
        <div className="call-overlay">
          <div className="call-card">
            <div className="call-icon">📹</div>
            <div className="call-name">{incoming.caller_name}</div>
            <div className="muted">
              {incoming.video ? 'is video calling you' : 'is calling you'}
            </div>
            <div className="call-actions">
              <button className="call-accept" onClick={accept}>
                Accept
              </button>
              <button className="call-decline" onClick={decline}>
                Decline
              </button>
            </div>
          </div>
        </div>
      )}
      {active && (
        <div className="call-overlay video">
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            className={active.video ? 'remote-video' : 'remote-hidden'}
          />
          {active.video ? (
            <video
              ref={localRef}
              autoPlay
              playsInline
              muted
              className="local-video"
            />
          ) : (
            <div className="voice-avatar">
              {active.peerName[0]?.toUpperCase()}
            </div>
          )}
          {(remoteHand || handUp) && (
            <div className="hand-banner">
              ✋ {remoteHand ? `${active.peerName} raised a hand` : 'You raised a hand'}
            </div>
          )}
          <div className="call-status-line">
            {active.peerName} —{' '}
            {active.status === 'in call' ? clock : active.status}
          </div>
          {chatOpen && (
            <div className="call-chat">
              <div className="call-chat-msgs">
                {callChat.map((cm, i) => (
                  <div key={i} className="call-chat-msg">
                    <strong>{cm.name}:</strong> {cm.text}
                  </div>
                ))}
                {callChat.length === 0 && (
                  <div className="muted small">No messages yet</div>
                )}
                <div ref={chatBottomRef} />
              </div>
              <form className="call-chat-form" onSubmit={sendCallChat}>
                <input
                  placeholder="Message…"
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                />
                <button type="submit" className="link">
                  Send
                </button>
              </form>
            </div>
          )}
          <div className="call-controls">
            <button onClick={toggleMic}>
              {micOn ? '🎤 Mute' : '🔇 Unmute'}
            </button>
            {active.video ? (
              <>
                <button
                  onClick={toggleCam}
                  disabled={!camTrackRef.current}
                >
                  {camOn ? '📹 Camera' : '📷 Camera off'}
                </button>
                <button
                  onClick={toggleShare}
                  className={sharing ? 'on' : ''}
                >
                  {sharing ? '🖥️ Stop share' : '🖥️ Share'}
                </button>
              </>
            ) : (
              <button onClick={switchToVideo} disabled={upgrading}>
                {upgrading ? '📹 Adding…' : '📹 Switch to video'}
              </button>
            )}
            <button onClick={toggleHand} className={handUp ? 'on' : ''}>
              {handUp ? '✋ Hand down' : '✋ Hand'}
            </button>
            <button
              onClick={() => setChatOpen((o) => !o)}
              className={chatOpen ? 'on' : ''}
            >
              💬 Chat
            </button>
            <button
              className="call-decline"
              onClick={() => endCall(active.id)}
            >
              End call
            </button>
          </div>
        </div>
      )}
    </>
  )
}
