import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

const FALLBACK = '/arcade/name-that-tune'

export function SpotifySuccess() {
  const [searchParams] = useSearchParams()
  const sid = searchParams.get('sid')
  const redirect = searchParams.get('redirect') || (window.location.origin + FALLBACK)
  const doneRef = useRef(false)

  useEffect(() => {
    if (!sid) {
      window.location.href = redirect + '#error=no_sid'
      return
    }
    if (doneRef.current) return
    doneRef.current = true
    fetch('/api/spotify/session?sid=' + encodeURIComponent(sid))
      .then((r) => r.json())
      .then((d: { access_token?: string; expires_in?: number; error?: string }) => {
        if (d.access_token) {
          const hash = '#access_token=' + encodeURIComponent(d.access_token) + '&expires_in=' + (d.expires_in ?? 3600)
          window.location.href = redirect + hash
        } else {
          window.location.href = redirect + '#error=' + (d.error || 'session_invalid')
        }
      })
      .catch(() => {
        window.location.href = redirect + '#error=session_failed'
      })
  }, [sid, redirect])

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p>Signed in with Spotify. Taking you back to the game…</p>
    </div>
  )
}
