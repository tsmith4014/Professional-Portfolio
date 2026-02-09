import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'

// Default: Spotify "Disco Forever" – full tracks via embed
const DEFAULT_PLAYLIST_ID = '37i9dQZF1DXa8NOEUWPn9W'

function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // Spotify playlist URL: open.spotify.com/playlist/ID or spotify:playlist:ID
  const urlMatch = trimmed.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/)
  if (urlMatch) return urlMatch[1]
  const uriMatch = trimmed.match(/spotify:playlist:([a-zA-Z0-9]+)/)
  if (uriMatch) return uriMatch[1]
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed
  return null
}

export function DiscoRoom() {
  const [playlistInput, setPlaylistInput] = useState('')
  const [playlistId, setPlaylistId] = useState(DEFAULT_PLAYLIST_ID)
  const [bpm, setBpm] = useState(120)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const handleLoadPlaylist = () => {
    const id = parsePlaylistId(playlistInput)
    if (id) setPlaylistId(id)
  }

  // Disco-style animated background (time-based; no audio access from embed)
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
      t += 0.01
      const pulse = 0.5 + 0.5 * Math.sin(t * (bpm / 60) * 2)
      const hue = (t * 20) % 360
      const hue2 = (hue + 180) % 360

      const gradient = ctx.createRadialGradient(
        width * 0.3, height * 0.3, 0,
        width * 0.5, height * 0.5, width * 0.8
      )
      gradient.addColorStop(0, `hsla(${hue}, 70%, 15%, ${0.4 + pulse * 0.2})`)
      gradient.addColorStop(0.5, `hsla(${hue2}, 60%, 8%, 0.5)`)
      gradient.addColorStop(1, `hsla(${hue}, 80%, 5%, 0.9)`)

      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)

      // Floating orbs
      const orbCount = 8
      for (let i = 0; i < orbCount; i++) {
        const x = width * (0.2 + 0.6 * Math.sin(t + i * 0.8) * 0.5)
        const y = height * (0.3 + 0.4 * Math.cos(t * 0.7 + i * 0.5) * 0.5)
        const r = 40 + 60 * (0.5 + 0.5 * Math.sin(t * 2 + i))
        const orbGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r)
        orbGrad.addColorStop(0, `hsla(${(hue + i * 40) % 360}, 80%, 60%, ${0.15 + pulse * 0.1})`)
        orbGrad.addColorStop(1, 'transparent')
        ctx.fillStyle = orbGrad
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }

      frameId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(frameId)
    }
  }, [bpm])

  return (
    <div className="disco-page">
      <canvas ref={canvasRef} className="disco-canvas" aria-hidden="true" />
      <div className="disco-content">
        <header className="disco-header">
          <Link to="/arcade" className="disco-back">← Arcade</Link>
          <h1 className="disco-title">Disco Room</h1>
          <p className="disco-sub">Full playlist — play via Spotify embed. Set BPM below to sync the lights.</p>
        </header>

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
            BPM (for light pulse)
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
        .disco-content { position: relative; z-index: 1; padding: 2rem 1.5rem 3rem; max-width: 28rem; margin: 0 auto; }
        .disco-header { text-align: center; margin-bottom: 1.5rem; }
        .disco-back { font-size: 0.9rem; color: var(--text-muted); display: inline-block; margin-bottom: 0.5rem; }
        .disco-back:hover { color: var(--arcade); }
        .disco-title { font-size: 1.75rem; margin: 0 0 0.25rem; color: var(--arcade); font-weight: 700; }
        .disco-sub { font-size: 0.85rem; color: var(--text-muted); margin: 0; }
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
        .disco-embed-wrap { border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
        .disco-embed { display: block; border: none; }
      `}</style>
    </div>
  )
}
