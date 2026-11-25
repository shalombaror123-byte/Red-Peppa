let audioCtx = null

// One mallet-style note: a warm triangle fundamental with a soft fourth
// harmonic for the "strike", run through a lowpass so it isn't harsh.
const note = (ctx, t, freq, vol, dur) => {
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 3400
  lp.connect(ctx.destination)
  for (const [mult, g, dec] of [
    [1, vol, dur],
    [4, vol * 0.22, dur * 0.3],
  ]) {
    const o = ctx.createOscillator()
    const e = ctx.createGain()
    o.type = mult === 1 ? 'triangle' : 'sine'
    o.frequency.value = freq * mult
    e.gain.setValueAtTime(0.0001, t)
    e.gain.exponentialRampToValueAtTime(g, t + 0.005)
    e.gain.exponentialRampToValueAtTime(0.0001, t + dec)
    o.connect(e).connect(lp)
    o.start(t)
    o.stop(t + dec + 0.05)
  }
}

// Warm two-note chime for incoming messages/calls — a soft rising
// interval (E5 -> B5), synthesized so no audio file is needed.
export const playDing = () => {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const t = audioCtx.currentTime
    note(audioCtx, t, 659.25, 0.4, 0.55)
    note(audioCtx, t + 0.09, 987.77, 0.34, 0.7)
  } catch {
    // audio unsupported / still locked — skip silently
  }
}

// Call ringtone: repeated soft pling bursts until cancelled.
export const startRing = (ref) => {
  playDing()
  clearInterval(ref.current)
  ref.current = setInterval(playDing, 2500)
}

export const stopRing = (ref) => {
  clearInterval(ref.current)
  ref.current = null
}

export const resumeAudio = () => {
  if (audioCtx?.state === 'suspended') audioCtx.resume()
}
