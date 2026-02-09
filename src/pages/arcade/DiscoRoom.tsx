import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'

const SPOTIFY_TOKEN_KEY = 'spotify_access_token'
const DEFAULT_PLAYLIST_ID = '37i9dQZF1DXa8NOEUWPn9W'
const SDK_URL = 'https://sdk.scdn.co/spotify-player.js'

// Web Playback SDK types (Spotify loads at runtime)
interface SpotifyPlayer {
  connect: () => Promise<boolean>
  disconnect: () => void
  addListener: (event: string, fn: (...args: unknown[]) => void) => void
  togglePlay: () => Promise<void>
  nextTrack: () => Promise<void>
  previousTrack: () => Promise<void>
}
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void
    Spotify?: { Player: new (opts: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume?: number }) => SpotifyPlayer }
  }
}

function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/)
  if (urlMatch) return urlMatch[1]
  const uriMatch = trimmed.match(/spotify:playlist:([a-zA-Z0-9]+)/)
  if (uriMatch) return uriMatch[1]
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed
  return null
}

type BeatSync = { pulse: number; kick: number; bpm: number } // 0-1, 0-1, derived BPM

export function DiscoRoom() {
  const [playlistInput, setPlaylistInput] = useState('')
  const [playlistId, setPlaylistId] = useState(DEFAULT_PLAYLIST_ID)
  const [bpm, setBpm] = useState(120)
  const [beatSync, setBeatSync] = useState<BeatSync>({ pulse: 0.5, kick: 0, bpm: 120 })
  const [sdkDeviceId, setSdkDeviceId] = useState<string | null>(null)
  const [premiumError, setPremiumError] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const beatSyncRef = useRef<BeatSync>(beatSync)
  const playerRef = useRef<SpotifyPlayer | null>(null)
  beatSyncRef.current = beatSync

  const token =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SPOTIFY_TOKEN_KEY) : null

  const handleLoadPlaylist = () => {
    const id = parsePlaylistId(playlistInput)
    if (id) setPlaylistId(id)
  }

  // Web Playback SDK: load script and create player (Premium required for device to appear)
  useEffect(() => {
    if (!token) {
      setSdkDeviceId(null)
      setPremiumError(null)
      return
    }
    setPremiumError(null)
    const accessToken = token

    const initPlayer = () => {
      if (!window.Spotify) return
      const player = new window.Spotify.Player({
        name: 'Disco Room Player',
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.7,
      })
      playerRef.current = player

      player.addListener('ready', (...args: unknown[]) => {
        const payload = args[0] as { device_id: string }
        setSdkDeviceId(payload?.device_id ?? null)
        setPremiumError(null)
      })
      player.addListener('not_ready', () => {
        setSdkDeviceId(null)
        setPremiumError('Premium required for in-page playback')
      })
      player.addListener('player_state_changed', (...args: unknown[]) => {
        const state = args[0] as { paused?: boolean } | null
        if (state) setIsPlaying(!state.paused)
      })

      player.connect().catch(() => setPremiumError('Could not connect player (Premium required)'))
    }

    if (window.Spotify) {
      initPlayer()
      return () => {
        playerRef.current?.disconnect()
        playerRef.current = null
        setSdkDeviceId(null)
      }
    }

    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    document.body.appendChild(script)
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.onSpotifyWebPlaybackSDKReady = undefined
      initPlayer()
    }
    return () => {
      script.remove()
      window.onSpotifyWebPlaybackSDKReady = undefined
      playerRef.current?.disconnect()
      playerRef.current = null
      setSdkDeviceId(null)
    }
  }, [token])

  const handlePlayPlaylist = async () => {
    if (!token || !sdkDeviceId) return
    const r = await fetch('/api/spotify/play', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        device_id: sdkDeviceId,
        context_uri: `spotify:playlist:${playlistId}`,
      }),
    })
    if (!r.ok && r.status === 402) setPremiumError('Premium required')
    if (r.ok) setIsPlaying(true)
  }

  const handleTogglePlay = () => playerRef.current?.togglePlay()
  const handleNext = () => playerRef.current?.nextTrack()
  const handlePrev = () => playerRef.current?.previousTrack()

  // Poll currently playing + audio analysis for beat sync (when signed in)
  useEffect(() => {
    if (!token) return
    let cancelled = false
    const analysisCache: Record<string, { beats: { start: number }[] }> = {}

    const poll = async () => {
      if (cancelled) return
      try {
        const url = `/api/spotify/now?access_token=${encodeURIComponent(token)}`
        const r = await fetch(url)
        const data = r.ok ? await r.json() : null
        if (!data?.is_playing || !data?.track_id) {
          setBeatSync((s) => ({ ...s, kick: 0 }))
          return
        }
        const progressMs = data.progress_ms || 0
        const progressSec = progressMs / 1000

        let beats = analysisCache[data.track_id]?.beats
        if (!beats) {
          const ar = await fetch(
            `/api/spotify/audio-analysis/${data.track_id}?access_token=${encodeURIComponent(token)}`
          )
          const analysis = ar.ok ? await ar.json() : null
          if (analysis?.beats?.length) {
            beats = analysis.beats.map((b: { start: number }) => ({ start: b.start }))
            analysisCache[data.track_id] = { beats }
          }
        }

        if (beats && beats.length > 0) {
          let idx = 0
          for (let i = 0; i < beats.length; i++) {
            if (beats[i].start <= progressSec) idx = i
          }
          const beatStart = beats[idx].start
          const beatEnd = beats[idx + 1]?.start ?? beatStart + 0.5
          const beatDuration = beatEnd - beatStart
          const phase = (progressSec - beatStart) / (beatDuration || 0.5)
          const pulse = Math.max(0, 1 - phase) // 1 at beat start, 0 by next beat
          const kick = phase < 0.15 ? 1 : Math.max(0, 1 - phase * 2)
          const derivedBpm = beatDuration > 0 ? 60 / beatDuration : 120
          setBeatSync({ pulse, kick, bpm: derivedBpm })
        }
      } catch {
        setBeatSync((s) => ({ ...s, kick: 0 }))
      }
    }

    poll()
    const interval = setInterval(poll, 500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [token])

  // Canvas: more lights, atmosphere, beat-driven strobe
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frameId: number
    let t = 0

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const { width, height } = canvas
      const sync = beatSyncRef.current
      t += 0.016

      // Manual BPM: one clear "beat" every (60/bpm) seconds so slider changes are obvious
      const beatsPerSec = bpm / 60
      const beatPhase = (t * beatsPerSec) % 1 // 0 at start of beat, 1 at next beat
      const manualPulse = Math.max(0, 1 - beatPhase * 1.8) // sharp drop after beat
      const manualKick = beatPhase < 0.06 ? 1 : Math.max(0, 1 - (beatPhase - 0.06) * 8)
      const useSync = token && sync.kick > 0
      const pulse = useSync ? 0.3 + 0.7 * sync.pulse : 0.2 + 0.8 * manualPulse
      const kick = useSync ? sync.kick : manualKick

      const hue = (t * 18) % 360
      const hue2 = (hue + 200) % 360

      // Base gradient – BPM pulse makes it much brighter on the beat
      const gradient = ctx.createRadialGradient(
        width * 0.35, height * 0.35, 0,
        width * 0.5, height * 0.5, width * 0.9
      )
      gradient.addColorStop(0, `hsla(${hue}, 80%, 25%, ${0.4 + pulse * 0.5})`)
      gradient.addColorStop(0.4, `hsla(${hue2}, 65%, 12%, ${0.5 + pulse * 0.2})`)
      gradient.addColorStop(1, `hsla(${hue}, 85%, 5%, 0.92)`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)

      // Beat strobe overlay (strong flash on kick – very visible when BPM changes)
      if (kick > 0) {
        ctx.fillStyle = `rgba(255,255,255,${kick * 0.22})`
        ctx.fillRect(0, 0, width, height)
      }

      // Rotating light beams (disco mirror ball effect)
      const beamCount = 12
      ctx.save()
      ctx.translate(width / 2, height / 2)
      for (let i = 0; i < beamCount; i++) {
        const angle = (t * 0.5 + (i / beamCount) * Math.PI * 2) % (Math.PI * 2)
        const beamGrad = ctx.createLinearGradient(0, 0, Math.cos(angle) * width, Math.sin(angle) * width)
        beamGrad.addColorStop(0, `hsla(${(hue + i * 30) % 360}, 90%, 70%, ${0.1 + pulse * 0.15 + kick * 0.1})`)
        beamGrad.addColorStop(0.5, 'transparent')
        ctx.fillStyle = beamGrad
        ctx.beginPath()
        ctx.moveTo(0, 0)
        const spread = 0.08
        ctx.lineTo(Math.cos(angle - spread) * width, Math.sin(angle - spread) * width)
        ctx.lineTo(Math.cos(angle + spread) * width, Math.sin(angle + spread) * width)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()

      // More floating orbs (larger set)
      const orbCount = 18
      for (let i = 0; i < orbCount; i++) {
        const x = width * (0.15 + 0.7 * Math.sin(t * 0.6 + i * 0.5) * 0.5)
        const y = height * (0.2 + 0.6 * Math.cos(t * 0.5 + i * 0.4) * 0.5)
        const r = 30 + 80 * (0.5 + 0.5 * Math.sin(t * 1.5 + i * 0.7))
        const orbGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r)
        orbGrad.addColorStop(0, `hsla(${(hue + i * 25) % 360}, 85%, 70%, ${0.25 + pulse * 0.35 + kick * 0.25})`)
        orbGrad.addColorStop(0.6, `hsla(${(hue + i * 25) % 360}, 70%, 40%, 0.08)`)
        orbGrad.addColorStop(1, 'transparent')
        ctx.fillStyle = orbGrad
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }

      // Small sparkle/particle layer
      const sparkCount = 40
      for (let i = 0; i < sparkCount; i++) {
        const sx = (Math.sin(t + i * 0.4) * 0.5 + 0.5) * width
        const sy = (Math.cos(t * 0.8 + i * 0.3) * 0.5 + 0.5) * height
        const size = 2 + 4 * (0.5 + 0.5 * Math.sin(t * 2 + i))
        const alpha = (0.4 + 0.5 * pulse + kick * 0.4) * (0.5 + 0.5 * Math.sin(t + i))
        ctx.fillStyle = `hsla(${(hue + i * 15) % 360}, 100%, 80%, ${alpha})`
        ctx.beginPath()
        ctx.arc(sx, sy, size, 0, Math.PI * 2)
        ctx.fill()
      }

      frameId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(frameId)
    }
  }, [bpm, token])

  const openInSpotifyUrl = `https://open.spotify.com/playlist/${playlistId}`

  return (
    <div className="disco-page">
      <canvas ref={canvasRef} className="disco-canvas" aria-hidden="true" />
      <div className="disco-content">
        <header className="disco-header">
          <Link to="/arcade" className="disco-back">← Arcade</Link>
          <h1 className="disco-title">Disco Room</h1>
          <p className="disco-sub">
            {token
              ? 'Lights can sync to the beat when you play from Spotify (embed or app).'
              : 'Sign in with Spotify (from Name That Tune) to sync lights to the beat; otherwise use BPM.'}
          </p>
        </header>

        <div className="disco-notice">
          <p><strong>Full songs in-browser</strong> need Spotify <strong>Premium</strong> and the player below. The embed is 30s previews only.</p>
          <p>For full tracks without Premium: <a href={openInSpotifyUrl} target="_blank" rel="noopener noreferrer" className="disco-open-link">Open in Spotify →</a></p>
        </div>

        {premiumError && (
          <div className="disco-premium-err">{premiumError}</div>
        )}

        {sdkDeviceId && (
          <div className="disco-sdk-bar">
            <span className="disco-sdk-label">Full playback (Premium)</span>
            <button type="button" className="disco-sdk-btn" onClick={handlePlayPlaylist}>Play playlist</button>
            <button type="button" className="disco-sdk-btn disco-sdk-icon" onClick={handlePrev} title="Previous">⏮</button>
            <button type="button" className="disco-sdk-btn disco-sdk-icon" onClick={handleTogglePlay} title={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? '⏸' : '▶'}</button>
            <button type="button" className="disco-sdk-btn disco-sdk-icon" onClick={handleNext} title="Next">⏭</button>
          </div>
        )}

        <div className="disco-controls">
          <label className="disco-label">
            Playlist (URL or ID)
            <input
              type="text"
              className="disco-input"
              placeholder="Paste Spotify playlist link or ID"
              value={playlistInput}
              onChange={(e) => setPlaylistInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadPlaylist()}
            />
          </label>
          <button type="button" className="disco-btn" onClick={handleLoadPlaylist}>
            Load playlist
          </button>
          <label className="disco-label disco-bpm">
            BPM (light pulse — move slider to see the beat)
            <input
                type="range"
                min="60"
                max="180"
                value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="disco-range"
              />
              <span className="disco-bpm-value">{bpm}</span>
            </label>
        </div>

        <div className="disco-embed-wrap">
          <iframe
            title="Spotify playlist"
            src={`https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator&theme=0`}
            width="100%"
            height="352"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="disco-embed"
          />
        </div>
      </div>

      <style>{`
        .disco-page { position: relative; min-height: 100vh; overflow: hidden; }
        .disco-canvas { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; }
        .disco-content { position: relative; z-index: 1; padding: 1.5rem 1.25rem 2rem; max-width: 26rem; margin: 0 auto; background: rgba(0,0,0,0.35); border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
        .disco-header { text-align: center; margin-bottom: 1rem; }
        .disco-back { font-size: 0.9rem; color: var(--text-muted); display: inline-block; margin-bottom: 0.5rem; }
        .disco-back:hover { color: var(--arcade); }
        .disco-title { font-size: 1.75rem; margin: 0 0 0.25rem; color: var(--arcade); font-weight: 700; }
        .disco-sub { font-size: 0.8rem; color: var(--text-muted); margin: 0; }
        .disco-notice {
          background: rgba(0,0,0,0.5); border: 1px solid var(--border); border-radius: 8px;
          padding: 0.6rem 0.9rem; margin-bottom: 1rem; font-size: 0.8rem; color: var(--text-muted);
        }
        .disco-notice p { margin: 0 0 0.4rem; }
        .disco-open-link { color: var(--arcade); font-weight: 600; }
        .disco-open-link:hover { text-decoration: underline; }
        .disco-premium-err { font-size: 0.8rem; color: #e74c3c; margin-bottom: 0.75rem; padding: 0.4rem 0; }
        .disco-sdk-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 1rem; padding: 0.6rem; background: rgba(0,0,0,0.4); border-radius: 10px; border: 1px solid var(--arcade); }
        .disco-sdk-label { font-size: 0.75rem; color: var(--text-muted); margin-right: 0.25rem; }
        .disco-sdk-btn { padding: 0.4rem 0.75rem; background: var(--arcade); border: none; border-radius: 8px; color: var(--bg); font-weight: 600; font-size: 0.85rem; cursor: pointer; font-family: var(--font); }
        .disco-sdk-btn:hover { opacity: 0.9; }
        .disco-sdk-btn.disco-sdk-icon { padding: 0.4rem 0.5rem; font-size: 1rem; }
        .disco-controls { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; }
        .disco-label { font-size: 0.8rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.25rem; }
        .disco-input {
          padding: 0.5rem 0.75rem; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 8px;
          color: var(--text); font-size: 0.9rem; font-family: var(--font);
        }
        .disco-input::placeholder { color: var(--text-muted); }
        .disco-btn {
          padding: 0.5rem 1rem; background: var(--arcade); border: none; border-radius: 8px;
          color: var(--bg); font-weight: 600; font-size: 0.9rem; cursor: pointer; font-family: var(--font);
        }
        .disco-btn:hover { opacity: 0.9; }
        .disco-bpm { flex-direction: row; align-items: center; flex-wrap: wrap; }
        .disco-range { flex: 1; min-width: 120px; accent-color: var(--arcade); }
        .disco-bpm-value { font-family: var(--font-mono); color: var(--arcade); margin-left: 0.5rem; min-width: 2rem; }
        .disco-embed-wrap { border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
        .disco-embed { display: block; border: none; }
        @media (min-width: 600px) {
          .disco-content { margin: 1.5rem auto; }
        }
      `}</style>
    </div>
  )
}
