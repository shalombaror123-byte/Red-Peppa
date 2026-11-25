import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { playDing, startRing, stopRing } from './sound'

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const RING_FRESH_SEC = 45 // ignore ringing calls older than this

/**
 * Voice-call manager: polls the backend for incoming calls, runs the
 * WebRTC handshake (offer/answer/candidates are relayed through the API),
 * and renders the incoming-call and in-call overlays.
 * `outgoing` is {id, name} of the user to call; `onDone` clears it.
 */
export default function CallManager({ me, outgoing, onDone }) {
  const [incoming, setIncoming] = useState(null)
  const [active, setActive] = useState(null) // {id, peerName, role, status}
  const [seconds, setSeconds] = useState(0)
  const pcRef = useRef(null)
  const streamRef = useRef(null)
  const audioRef = useRef(null)
  const pollRef = useRef(null)
  const ringRef = useRef(null)
  const callIdRef = useRef(null)
  const answeredRef = useRef(false)
  const pendingCands = useRef([])
  const connTimeoutRef = useRef(null)

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
    pendingCands.current = []
    setActive(null)
    setIncoming(null)
    setSeconds(0)
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
        if (audioRef.current) audioRef.current.srcObject = e.streams[0]
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
  // drains the other side's ICE candidates and watches for "ended".
  const pollCall = useCallback(
    (callId, remoteKey, role) => {
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
          }
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

  // Outgoing call: mic → offer → POST call → poll for answer.
  useEffect(() => {
    if (!outgoing || active) return
    let cancelled = false
    ;(async () => {
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
        const pc = attachPC('caller')
        await pc.setLocalDescription(await pc.createOffer())
        const { id } = await api.startCall({
          caller: me.id,
          callee: outgoing.id,
          offer: pc.localDescription,
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
        })
        pollCall(id, 'cand_callee', 'caller')
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
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
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
      })
      pollCall(call.id, 'cand_caller', 'callee')
    } catch {
      stopAll()
    }
  }

  const decline = () => {
    api.endCall(incoming.id).catch(() => {})
    stopAll()
  }

  // In-call duration timer.
  useEffect(() => {
    if (active?.status !== 'in call') return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [active?.status])

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <>
      <audio ref={audioRef} autoPlay hidden />
      {incoming && (
        <div className="call-overlay">
          <div className="call-card">
            <div className="call-icon">📞</div>
            <div className="call-name">{incoming.caller_name}</div>
            <div className="muted">is calling you</div>
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
        <div className="call-overlay">
          <div className="call-card">
            <div className="call-icon">📞</div>
            <div className="call-name">{active.peerName}</div>
            <div className="muted">
              {active.status === 'in call' ? `In call — ${clock}` : active.status}
            </div>
            <div className="call-actions">
              <button
                className="call-decline"
                onClick={() => endCall(active.id)}
              >
                End call
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
