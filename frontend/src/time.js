export function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Turns "1218" into "12-18" as the user types a birthday (MM-DD).
export function formatBirthdayInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits
}

export function fmtAgo(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function fmtLastSeen(ts) {
  if (!ts) return ''
  if (Date.now() / 1000 - ts < 75) return 'online'
  const d = new Date(ts * 1000)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, today)) return `last seen today at ${time}`
  if (sameDay(d, yesterday)) return `last seen yesterday at ${time}`
  return `last seen ${d.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
  })} at ${time}`
}

export function fmtLastSeenShort(ts) {
  if (!ts) return ''
  if (Date.now() / 1000 - ts < 75) return 'online'
  const d = new Date(ts * 1000)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  if (sameDay(d, today)) {
    return `seen ${d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }
  if (sameDay(d, yesterday)) return 'seen yesterday'
  return `seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`
}

export function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
