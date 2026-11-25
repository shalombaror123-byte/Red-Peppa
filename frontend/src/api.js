const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8002/api').replace(/\/+$/, '')

// Resolve a message's media field to a displayable URL: "media:<id>" is an
// uploaded image served by the backend; anything else is used as-is (a
// pasted image/GIF link).
export const mediaUrl = (m) =>
  m.startsWith('media:') ? `${API_BASE}/media/${m.slice(6)}` : m

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body.detail) detail = body.detail
    } catch {
      // keep default message
    }
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // users / directory
  getUsers: () => request('/users'),
  login: (name, password) =>
    request('/login', { method: 'POST', body: JSON.stringify({ name, password }) }),
  addUser: (user) => request('/users', { method: 'POST', body: JSON.stringify(user) }),
  updateUser: (id, update) =>
    request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(update) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  // chats
  getChatList: (userId) => request(`/chats/${userId}`),
  getGroupMessages: (me) => request(`/messages/group?me=${me}`),
  getDmMessages: (otherId, me) => request(`/messages/dm/${otherId}?me=${me}`),
  sendMessage: (msg) => request('/messages', { method: 'POST', body: JSON.stringify(msg) }),
  uploadMedia: (data) => request('/media', { method: 'POST', body: JSON.stringify({ data }) }),

  // boards
  getNews: () => request('/news'),
  postNews: (post) => request('/news', { method: 'POST', body: JSON.stringify(post) }),
  getStudy: () => request('/study'),
  postStudy: (post) => request('/study', { method: 'POST', body: JSON.stringify(post) }),
  getJokes: () => request('/jokes'),
  postJoke: (post) => request('/jokes', { method: 'POST', body: JSON.stringify(post) }),
  getBirthdays: () => request('/birthdays'),
}
