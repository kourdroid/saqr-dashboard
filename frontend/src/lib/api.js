const TOKEN_STORAGE_KEY = 'saqr_api_token'

export function getApiToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || ''
}

export function setApiToken(token) {
  const clean = token.trim()
  if (clean) {
    localStorage.setItem(TOKEN_STORAGE_KEY, clean)
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  }
}

export async function api(path, opts = {}) {
  const token = getApiToken()
  const headers = { 'Content-Type': 'application/json', ...opts.headers }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch('/api' + path, {
    ...opts,
    headers,
  })
  if (!response.ok) {
    const text = await response.text()
    let message = text || response.statusText
    try {
      message = JSON.parse(text).detail || message
    } catch {
      // Keep the raw response.
    }
    throw new Error(message)
  }
  return response.json()
}
