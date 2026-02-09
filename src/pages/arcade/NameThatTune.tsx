import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'

const SPOTIFY_TOKEN_KEY = 'spotify_access_token'
type Track = { name: string; artists: string; previewUrl: string; id?: string | null }
const FALLBACK_TRACKS: Track[] = [
  { name: 'Blinding Lights', artists: 'The Weeknd', previewUrl: '' },
  { name: 'Levitating', artists: 'Dua Lipa', previewUrl: '' },
  { name: 'Save Your Tears', artists: 'The Weeknd', previewUrl: '' },
  { name: 'Stay', artists: 'The Kid LAROI, Justin Bieber', previewUrl: '' },
  { name: 'Good 4 U', artists: 'Olivia Rodrigo', previewUrl: '' },
  { name: 'Heat Waves', artists: 'Glass Animals', previewUrl: '' },
]

function getStoredToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(SPOTIFY_TOKEN_KEY)
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function pickOptions(tracks: Track[], correct: Track, count: number): Track[] {
  const others = tracks.filter((t) => t.name !== correct.name)
  const shuffled = shuffle(others)
  const opts = [correct, ...shuffled.slice(0, count - 1)]
  return shuffle(opts)
}

// Spotify Embed (iframe) controller for full-quality playback; type from Spotify's iframe API
interface SpotifyEmbedController {
  loadUri: (uri: string) => void
  play: () => void
  pause: () => void
  resume: () => void
  destroy?: () => void
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (IFrameAPI: {
      createController: (
        element: HTMLElement,
        options: { uri?: string; width?: number; height?: number },
        callback: (controller: SpotifyEmbedController) => void
      ) => void
    }) => void
  }
}

export function NameThatTune() {
  const [tracks, setTracks] = useState<Track[]>(FALLBACK_TRACKS)
  const [loading, setLoading] = useState(true)
  const [round, setRound] = useState(0)
  const [score, setScore] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [spotifyToken, setSpotifyToken] = useState<string | null>(getStoredToken)
  const [spotifyError, setSpotifyError] = useState<string | null>(null)
  const [embedReady, setEmbedReady] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const embedContainerRef = useRef<HTMLDivElement | null>(null)
  const embedControllerRef = useRef<SpotifyEmbedController | null>(null)

  // Build login URL so callback redirects back to current origin; backend must receive this at /api/spotify/login
  const spotifyLoginUrl = '/api/spotify/login?frontend_redirect=' + encodeURIComponent(window.location.origin + '/arcade/name-that-tune')

  // Read token or error from OAuth redirect hash
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const params = Object.fromEntries(new URLSearchParams(hash))
    if (params.access_token) {
      sessionStorage.setItem(SPOTIFY_TOKEN_KEY, params.access_token)
      setSpotifyToken(params.access_token)
      setSpotifyError(null)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    if (params.error) {
      setSpotifyError(params.error)
      // Clear hash so the error doesn't stick in the URL and persist on refresh
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const token = getStoredToken()
    const headers: HeadersInit = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const url = token ? `/api/tracks?limit=50&access_token=${encodeURIComponent(token)}` : '/api/tracks?limit=50'
    fetch(url, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.auth === 'user-token-no-tracks') {
          sessionStorage.removeItem(SPOTIFY_TOKEN_KEY)
          setSpotifyToken(null)
          setSpotifyError('Session expired or invalid. Sign in with Spotify again.')
        }
        const list = data?.tracks || FALLBACK_TRACKS
        setTracks(Array.isArray(list) && list.length >= 4 ? list : FALLBACK_TRACKS)
      })
      .catch(() => {
        if (!cancelled) setTracks(FALLBACK_TRACKS)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [spotifyToken])

  // If signed in but tracks have no id (demo list), refetch with token in URL so backend definitely gets it
  useEffect(() => {
    if (!spotifyToken || !tracks.length) return
    if (tracks.some((t) => t.id)) return
    const token = getStoredToken()
    if (!token) return
    fetch(`/api/tracks?limit=50&access_token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.auth === 'user-token-no-tracks') {
          sessionStorage.removeItem(SPOTIFY_TOKEN_KEY)
          setSpotifyToken(null)
          setSpotifyError('Session expired. Sign in with Spotify again.')
          return
        }
        const list = data?.tracks
        if (Array.isArray(list) && list.length >= 4 && list.some((t: Track) => t.id)) {
          setTracks(list)
        }
      })
      .catch(() => {})
  }, [spotifyToken, tracks])

  const track = tracks[round % tracks.length]
  const options = useMemo(
    () => (track ? pickOptions(tracks, track, 4) : []),
    [round, track, tracks]
  )
  const canUseEmbed = Boolean(spotifyToken && track?.id && embedReady)
  const hasSpotifyTrack = Boolean(spotifyToken && track?.id)
  const hasPreview = Boolean(track?.previewUrl) || canUseEmbed || hasSpotifyTrack

  const stopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = useCallback(() => {
    if (stopRef.current) {
      clearTimeout(stopRef.current)
      stopRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    const ctrl = embedControllerRef.current
    if (ctrl?.pause) ctrl.pause()
  }, [])

  useEffect(() => () => { stop() }, [stop])

  // Spotify Embed iframe API: set callback first, then load script so we never miss the ready event
  useEffect(() => {
    window.onSpotifyIframeApiReady = (IFrameAPI) => {
      const el = embedContainerRef.current
      if (!el) return
      IFrameAPI.createController(
        el,
        { width: 300, height: 80, uri: 'spotify:track:4u7OneTvm3kR6A9QJA6qTZ' },
        (controller) => {
          embedControllerRef.current = controller
          setEmbedReady(true)
        }
      )
    }
    if (!document.querySelector('script[src*="embed/iframe-api"]')) {
      const script = document.createElement('script')
      script.src = 'https://open.spotify.com/embed/iframe-api/v1'
      script.async = true
      document.body.appendChild(script)
    }
    return () => {
      window.onSpotifyIframeApiReady = undefined
      const ctrl = embedControllerRef.current
      if (ctrl?.destroy) ctrl.destroy()
      embedControllerRef.current = null
      setEmbedReady(false)
    }
  }, [])

  const choose = useCallback(
    (name: string) => {
      if (revealed || !track) return
      stop()
      setSelected(name)
      setRevealed(true)
      if (name === track.name) setScore((s) => s + 1)
    },
    [track, revealed, stop]
  )

  const next = useCallback(() => {
    setSelected(null)
    setRevealed(false)
    setRound((r) => r + 1)
  }, [])

  const refreshTracks = useCallback(() => {
    const token = getStoredToken()
    if (!token) return
    setLoading(true)
    fetch(`/api/tracks?limit=50&access_token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        const list = data?.tracks
        if (Array.isArray(list) && list.length >= 4) setTracks(list)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading || !track) {
    return (
      <div className="ntt-page">
        <header className="ntt-header">
          <Link to="/arcade" className="ntt-back">← Arcade</Link>
          <div className="ntt-header-right">
            {!spotifyToken && (
              <a href={spotifyLoginUrl} className="ntt-spotify-btn" onClick={() => setSpotifyError(null)}>Sign in with Spotify</a>
            )}
          </div>
        </header>
        <main className="ntt-main">
          <p className="ntt-desc">Loading tracks…</p>
        </main>
        <style>{`
          .ntt-page { min-height: 100vh; padding: 2rem 1.5rem; }
          .ntt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 0.5rem; }
          .ntt-back { color: var(--text-muted); font-size: 0.9rem; }
          .ntt-back:hover { color: var(--accent); }
          .ntt-spotify-btn { font-size: 0.8rem; padding: 0.4rem 0.75rem; background: #1db954; color: #fff; border-radius: 999px; font-weight: 600; }
          .ntt-spotify-btn:hover { opacity: 0.9; }
          .ntt-main { max-width: 24rem; margin: 0 auto; text-align: center; }
          .ntt-desc { color: var(--text-muted); font-size: 0.9rem; margin: 0; }
        `}</style>
      </div>
    )
  }

  return (
    <div className="ntt-page">
      <header className="ntt-header">
        <Link to="/arcade" className="ntt-back">← Arcade</Link>
        <div className="ntt-header-right">
          <span className="ntt-score">Score: {score}</span>
          {spotifyToken ? (
            <>
              <button type="button" className="ntt-spotify-btn ntt-spotify-out" onClick={refreshTracks}>
                Refresh tracks
              </button>
              <button type="button" className="ntt-spotify-btn ntt-spotify-out" onClick={() => { sessionStorage.removeItem(SPOTIFY_TOKEN_KEY); setSpotifyToken(null); setLoading(true); }}>
                Sign out Spotify
              </button>
            </>
          ) : (
            <a href={spotifyLoginUrl} className="ntt-spotify-btn" onClick={() => setSpotifyError(null)}>Sign in with Spotify</a>
          )}
        </div>
      </header>

      <main className="ntt-main">
        <h1 className="ntt-title">Name That Tune</h1>
        {spotifyError && (
          <div className="ntt-error">
            {spotifyError === 'invalid_or_expired' || spotifyError === 'session_failed' || spotifyError === 'session_invalid' ? (
              <>Session expired or the server was restarted. Click <strong>Sign in with Spotify</strong> below to try again.</>
            ) : (
              <>Spotify sign-in failed: <strong>{spotifyError}</strong>.{' '}
              {spotifyError === 'redirect_uri_mismatch' && 'Add the exact Redirect URI from GET /api/debug to your Spotify app Settings → Redirect URIs.'}</>
            )}
          </div>
        )}
        <p className="ntt-desc">Listen to the 30s preview and pick the track. {spotifyToken ? 'Using your Spotify — real previews with vocals.' : 'Sign in with Spotify for real 30s clips with vocals.'}</p>

        {hasPreview ? (
          <>
            <div className={'ntt-embed-wrap' + (spotifyToken ? '' : ' ntt-embed-wrap--hidden')} aria-label="Spotify player">
              <div className="ntt-mystery-wrap">
                <div ref={embedContainerRef} className={'ntt-embed-container' + (embedReady ? '' : ' ntt-embed-container--hidden')} />
                {!embedReady && track?.id && (
                  <iframe
                    title="Spotify track"
                    src={`https://open.spotify.com/embed/track/${track.id}?utm_source=generator`}
                    width="100%"
                    height="152"
                    frameBorder="0"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                    className="ntt-embed-iframe"
                  />
                )}
                <div className={'ntt-mystery-overlay' + (revealed ? ' ntt-mystery-overlay--revealed' : '')} aria-hidden="true" />
              </div>
            </div>
            <p className="ntt-hint">Listen with the play button — track stays hidden until you guess.</p>
            <div className="ntt-options">
              {options.map((opt) => (
                <button
                  key={opt.name + opt.artists}
                  type="button"
                  className={'ntt-opt' + (selected === opt.name ? (opt.name === track?.name ? ' ntt-opt--correct' : ' ntt-opt--wrong') : '')}
                  disabled={revealed}
                  onClick={() => choose(opt.name)}
                >
                  {opt.name} · {opt.artists}
                </button>
              ))}
            </div>
            {revealed && (
              <div className="ntt-result">
                <p>{selected === track?.name ? 'Correct!' : `It was: ${track?.name} · ${track?.artists}`}</p>
                <button type="button" className="ntt-next" onClick={next}>Next round</button>
              </div>
            )}
          </>
        ) : (
          <p className="ntt-no-preview">
            No preview for this track. Sign in with Spotify above for real 30s previews with vocals.
          </p>
        )}
      </main>

      <style>{`
        .ntt-page { min-height: 100vh; padding: 2rem 1.5rem; }
        .ntt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: 0.5rem; }
        .ntt-header-right { display: flex; align-items: center; gap: 0.75rem; }
        .ntt-back { color: var(--text-muted); font-size: 0.9rem; }
        .ntt-back:hover { color: var(--accent); }
        .ntt-spotify-btn { font-size: 0.8rem; padding: 0.4rem 0.75rem; background: #1db954; color: #fff; border-radius: 999px; font-weight: 600; }
        .ntt-spotify-btn:hover { opacity: 0.9; }
        .ntt-spotify-out { background: var(--surface); border: 1px solid var(--border); color: var(--text); font-weight: 500; cursor: pointer; font-family: var(--font); }
        .ntt-error { background: rgba(231,76,60,0.15); border: 1px solid #e74c3c; color: #e74c3c; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; }
        .ntt-main { max-width: 24rem; margin: 0 auto; text-align: center; }
        .ntt-title { font-size: 1.5rem; margin: 0 0 0.25rem; color: var(--arcade); }
        .ntt-desc { color: var(--text-muted); font-size: 0.9rem; margin: 0 0 1.5rem; }
        .ntt-play {
          display: inline-block;
          padding: 0.6rem 1.2rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: var(--font);
          font-size: 0.95rem;
          cursor: pointer;
          margin-bottom: 1.5rem;
        }
        .ntt-play:hover:not(:disabled) { border-color: var(--arcade); }
        .ntt-play:disabled { opacity: 0.6; cursor: default; }
        .ntt-embed-wrap { margin: 1rem 0; min-height: 80px; }
        .ntt-embed-wrap.ntt-embed-wrap--hidden { display: none; }
        .ntt-mystery-wrap { position: relative; width: 100%; max-width: 340px; margin: 0 auto; border-radius: 12px; overflow: hidden; }
        .ntt-mystery-overlay {
          position: absolute; inset: 0; border-radius: 12px;
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          background: rgba(0,0,0,0.4);
          -webkit-mask-image: radial-gradient(circle at 88% 72%, transparent 40px, black 40px);
          mask-image: radial-gradient(circle at 88% 72%, transparent 40px, black 40px);
          pointer-events: none;
          transition: opacity 0.45s ease;
        }
        .ntt-mystery-overlay--revealed {
          opacity: 0;
          pointer-events: none;
        }
        .ntt-embed-container { width: 100%; max-width: 340px; margin: 0 auto; min-height: 80px; }
        .ntt-embed-container.ntt-embed-container--hidden { display: none; }
        .ntt-embed-iframe { max-width: 100%; border-radius: 12px; display: block; }
        .ntt-embed-msg { font-size: 0.85rem; color: var(--arcade); margin: 0.5rem 0; }
        .ntt-hint { font-size: 0.75rem; color: var(--text-muted); margin: -0.5rem 0 0.75rem; }
        .ntt-next-track { margin-top: 0.5rem; padding: 0.4rem 0.9rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.85rem; cursor: pointer; }
        .ntt-next-track:hover { border-color: var(--arcade); }
        .ntt-score { font-family: var(--font-mono); font-size: 0.9rem; color: var(--arcade); margin-right: 0.5rem; }
        .ntt-no-preview { font-size: 0.85rem; color: var(--text-muted); margin: 0 0 1rem; }
        .ntt-no-preview code { font-family: var(--font-mono); font-size: 0.8rem; }
        .ntt-options { display: flex; flex-direction: column; gap: 0.5rem; }
        .ntt-opt {
          padding: 0.9rem 1rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: var(--font);
          font-size: 0.9rem;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .ntt-opt:hover:not(:disabled) { border-color: var(--accent); background: var(--surface-hover); }
        .ntt-opt:disabled { cursor: default; }
        .ntt-opt--correct { border-color: var(--accent); background: rgba(0,212,170,0.1); }
        .ntt-opt--wrong { border-color: #e74c3c; background: rgba(231,76,60,0.1); }
        .ntt-result { margin-top: 1.5rem; }
        .ntt-result p { margin: 0 0 0.75rem; font-size: 0.95rem; }
        .ntt-next {
          padding: 0.5rem 1rem;
          background: var(--arcade);
          border: none;
          border-radius: 6px;
          color: var(--bg);
          font-family: var(--font);
          font-size: 0.9rem;
          cursor: pointer;
        }
        .ntt-next:hover { opacity: 0.9; }
      `}</style>
    </div>
  )
}
