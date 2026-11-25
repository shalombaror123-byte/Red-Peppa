let audioCtx = null

// Soft "pling" for incoming messages/calls, synthesized so no audio file
// is needed. Bell-like: a bright strike with a faint harmonic shimmer and
// a smooth decay — in the spirit of Google Chat's notification.
export const playDing = () => {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const t = audioCtx.currentTime
    for (const [freq, vol, decay] of [
      [1568, 0.45, 0.5],
      [3136, 0.14, 0.3],
    ]) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.006)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(t)
      osc.stop(t + decay + 0.05)
    }
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
