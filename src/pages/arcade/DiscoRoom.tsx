import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'

const PANEL_DEFAULT_W = 340
const PANEL_DEFAULT_H = 420
const PANEL_MIN_W = 280
const PANEL_MIN_H = 320
const SHOW_BTN_MARGIN = 6
const BOUNCE = 0.6
const FRICTION = 0.98
const TOSS_MULT = 0.4
const SHOW_BTN_W = 140
const SHOW_BTN_H = 44
const PANEL_MARGIN = 8

function visibleViewport(): { w: number; h: number } {
  if (typeof document === 'undefined') return { w: 800, h: 600 }
  return {
    w: document.documentElement.clientWidth,
    h: document.documentElement.clientHeight,
  }
}

// Panel uses position:fixed; use innerWidth/innerHeight so bounds match the viewport it's drawn in
function panelViewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 800, h: 600 }
  return { w: window.innerWidth, h: window.innerHeight }
}

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
  const [panelVisible, setPanelVisible] = useState(true)
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 })
  const [panelSize, setPanelSize] = useState({ w: PANEL_DEFAULT_W, h: PANEL_DEFAULT_H })
  const [panelVelocity, setPanelVelocity] = useState({ vx: 0, vy: 0 })
  const [showBtnPos, setShowBtnPos] = useState({ x: 0, y: 0 })
  const [showBtnVel, setShowBtnVel] = useState({ vx: 0, vy: 0 })
  const showBtnBounceRef = useRef<number | null>(null)
  const showBtnJetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showBtnDragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const showBtnWasDraggingRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const beatSyncRef = useRef<BeatSync>(beatSync)
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const lastMoveRef = useRef<{ x: number; y: number; t: number }[]>([])
  const physicsRef = useRef<number | null>(null)
  const resizingRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const panelInitialized = useRef(false)
  beatSyncRef.current = beatSync

  // Clamp panel position and size so right/bottom edges never go off-screen (position:fixed viewport)
  const clampPanelInView = useCallback(() => {
    const { w: W, h: H } = panelViewport()
    const { w: cw, h: ch } = panelSizeRef.current
    const { x: cx, y: cy } = panelPosRef.current
    const w = Math.max(PANEL_MIN_W, Math.min(600, W - PANEL_MARGIN * 2, cw))
    const h = Math.max(PANEL_MIN_H, Math.min(800, H - PANEL_MARGIN * 2, ch))
    const maxX = Math.max(0, W - w - PANEL_MARGIN)
    const maxY = Math.max(0, H - h - PANEL_MARGIN)
    const x = Math.max(0, Math.min(maxX, cx))
    const y = Math.max(0, Math.min(maxY, cy))
    setPanelSize({ w, h })
    setPanelPos({ x, y })
  }, [])

  // Center panel on first mount; keep fully inside viewport
  useEffect(() => {
    if (panelInitialized.current) return
    panelInitialized.current = true
    const place = () => {
      const { w: W, h: H } = panelViewport()
      const maxX = Math.max(0, W - PANEL_DEFAULT_W - PANEL_MARGIN)
      const maxY = Math.max(0, H - PANEL_DEFAULT_H - PANEL_MARGIN)
      setPanelPos({
        x: Math.max(0, Math.min(maxX, (W - PANEL_DEFAULT_W) / 2)),
        y: Math.max(0, Math.min(maxY, (H - PANEL_DEFAULT_H) / 2)),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [])

  // Keep panel in bounds on resize and whenever panel becomes visible
  useEffect(() => {
    if (!panelVisible) return
    const onResize = () => clampPanelInView()
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [panelVisible, clampPanelInView])

  const [token, setToken] = useState<string | null>(() =>
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SPOTIFY_TOKEN_KEY) : null
  )

  // Read OAuth redirect hash (Sign in from Disco Room returns here with #access_token=...)
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const params = Object.fromEntries(new URLSearchParams(hash))
    if (params.access_token) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SPOTIFY_TOKEN_KEY, params.access_token)
      setToken(params.access_token)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

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

  const panelPosRef = useRef(panelPos)
  const panelVelRef = useRef(panelVelocity)
  const panelSizeRef = useRef(panelSize)
  panelPosRef.current = panelPos
  panelVelRef.current = panelVelocity
  panelSizeRef.current = panelSize

  // Bounce physics when panel is tossed; use panelViewport so right edge never off-screen
  useEffect(() => {
    const step = () => {
      const { x, y } = panelPosRef.current
      let { vx, vy } = panelVelRef.current
      if (Math.abs(vx) < 0.3 && Math.abs(vy) < 0.3) return
      const { w: W, h: H } = panelViewport()
      const { w, h } = panelSize
      const maxX = Math.max(0, W - w - PANEL_MARGIN)
      const maxY = Math.max(0, H - h - PANEL_MARGIN)
      let nx = x + vx
      let ny = y + vy
      if (nx < 0) { nx = 0; vx = -vx * BOUNCE }
      if (nx + w > W - PANEL_MARGIN) { nx = maxX; vx = -vx * BOUNCE }
      if (ny < 0) { ny = 0; vy = -vy * BOUNCE }
      if (ny + h > H - PANEL_MARGIN) { ny = maxY; vy = -vy * BOUNCE }
      vx *= FRICTION
      vy *= FRICTION
      setPanelPos({ x: nx, y: ny })
      setPanelVelocity({ vx, vy })
      if (Math.abs(vx) >= 0.3 || Math.abs(vy) >= 0.3) physicsRef.current = requestAnimationFrame(step)
    }
    if (Math.abs(panelVelocity.vx) >= 0.3 || Math.abs(panelVelocity.vy) >= 0.3)
      physicsRef.current = requestAnimationFrame(step)
    return () => { if (physicsRef.current) cancelAnimationFrame(physicsRef.current) }
  }, [panelVelocity.vx, panelVelocity.vy, panelSize.w, panelSize.h])

  const handlePanelPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.disco-resize-handle')) return
    if ((e.target as HTMLElement).closest('.disco-hide-btn')) return
    if ((e.target as HTMLElement).closest('a')) return
    if (!(e.target as HTMLElement).closest('.disco-drag-handle')) return
    e.preventDefault()
    dragStartRef.current = { x: e.clientX, y: e.clientY, px: panelPos.x, py: panelPos.y }
    lastMoveRef.current = [{ x: e.clientX, y: e.clientY, t: Date.now() }]
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [panelPos])

  const handlePanelPointerMove = useCallback((e: React.PointerEvent) => {
    if (resizingRef.current) {
      const { w: startW, h: startH, x: startX, y: startY } = resizingRef.current
      const { w: W, h: H } = panelViewport()
      const rawW = startW + (e.clientX - startX)
      const rawH = startH + (e.clientY - startY)
      const maxW = W - panelPosRef.current.x - PANEL_MARGIN
      const maxH = H - panelPosRef.current.y - PANEL_MARGIN
      setPanelSize({
        w: Math.max(PANEL_MIN_W, Math.min(600, maxW, rawW)),
        h: Math.max(PANEL_MIN_H, Math.min(800, maxH, rawH)),
      })
      return
    }
    if (!dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    const { w: W, h: H } = panelViewport()
    const maxX = Math.max(0, W - panelSize.w - PANEL_MARGIN)
    const maxY = Math.max(0, H - panelSize.h - PANEL_MARGIN)
    let nx = dragStartRef.current.px + dx
    let ny = dragStartRef.current.py + dy
    nx = Math.max(0, Math.min(maxX, nx))
    ny = Math.max(0, Math.min(maxY, ny))
    setPanelPos({ x: nx, y: ny })
    lastMoveRef.current = [...lastMoveRef.current.slice(-4), { x: e.clientX, y: e.clientY, t: Date.now() }]
  }, [panelSize.w, panelSize.h])

  const handlePanelPointerUp = useCallback((e: React.PointerEvent) => {
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (resizingRef.current) {
      resizingRef.current = null
      return
    }
    if (!dragStartRef.current) return
    const moves = lastMoveRef.current
    dragStartRef.current = null
    if (moves.length >= 2) {
      const last = moves[moves.length - 1]
      const prev = moves[moves.length - 2]
      const dt = (last.t - prev.t) / 1000
      if (dt > 0) {
        const vx = ((last.x - prev.x) * TOSS_MULT) / dt
        const vy = ((last.y - prev.y) * TOSS_MULT) / dt
        setPanelVelocity({ vx, vy })
      }
    }
  }, [])

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = { x: e.clientX, y: e.clientY, w: panelSize.w, h: panelSize.h }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [panelSize])

  function clampShowBtnToViewport(pos: { x: number; y: number }): { x: number; y: number } {
    const { w: W, h: H } = visibleViewport()
    const minX = SHOW_BTN_MARGIN
    const maxX = Math.max(minX, W - SHOW_BTN_W - SHOW_BTN_MARGIN)
    const minY = SHOW_BTN_MARGIN
    const maxY = Math.max(minY, H - SHOW_BTN_H - SHOW_BTN_MARGIN)
    return {
      x: Math.max(minX, Math.min(maxX, pos.x)),
      y: Math.max(minY, Math.min(maxY, pos.y)),
    }
  }

  // When panel is first hidden, place "Show controls" button within visible viewport (with margin)
  useEffect(() => {
    if (!panelVisible && showBtnPos.x === 0 && showBtnPos.y === 0) {
      const { w: W, h: H } = visibleViewport()
      setShowBtnPos(clampShowBtnToViewport({
        x: W - SHOW_BTN_W - 20,
        y: H - SHOW_BTN_H - 20,
      }))
    }
  }, [panelVisible, showBtnPos.x, showBtnPos.y])

  // Keep Show controls button inside visible viewport on resize (strong walls)
  useEffect(() => {
    if (panelVisible) return
    const onResize = () => {
      setShowBtnPos(p => clampShowBtnToViewport(p))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [panelVisible])

  const showBtnPosRef = useRef(showBtnPos)
  const showBtnVelRef = useRef(showBtnVel)
  showBtnPosRef.current = showBtnPos
  showBtnVelRef.current = showBtnVel

  // Bounce physics for "Show controls" button; strong walls with margin so it never gets stuck off-screen
  useEffect(() => {
    if (panelVisible) return
    const step = () => {
      if (showBtnDragRef.current) {
        showBtnBounceRef.current = requestAnimationFrame(step)
        return
      }
      const { w: W, h: H } = visibleViewport()
      const minX = SHOW_BTN_MARGIN
      const maxX = Math.max(minX, W - SHOW_BTN_W - SHOW_BTN_MARGIN)
      const minY = SHOW_BTN_MARGIN
      const maxY = Math.max(minY, H - SHOW_BTN_H - SHOW_BTN_MARGIN)
      let { x, y } = showBtnPosRef.current
      // Rescue: clamp current position every frame so we never stay off-screen
      x = Math.max(minX, Math.min(maxX, x))
      y = Math.max(minY, Math.min(maxY, y))
      let { vx, vy } = showBtnVelRef.current
      let nx = x + vx
      let ny = y + vy
      if (nx < minX) { nx = minX; vx = -vx * BOUNCE }
      if (nx + SHOW_BTN_W > W - SHOW_BTN_MARGIN) { nx = maxX; vx = -vx * BOUNCE }
      if (ny < minY) { ny = minY; vy = -vy * BOUNCE }
      if (ny + SHOW_BTN_H > H - SHOW_BTN_MARGIN) { ny = maxY; vy = -vy * BOUNCE }
      vx *= FRICTION
      vy *= FRICTION
      setShowBtnPos({ x: nx, y: ny })
      setShowBtnVel({ vx, vy })
      showBtnBounceRef.current = requestAnimationFrame(step)
    }
    showBtnBounceRef.current = requestAnimationFrame(step)
    return () => {
      if (showBtnBounceRef.current) cancelAnimationFrame(showBtnBounceRef.current)
    }
  }, [panelVisible])

  // Random "jet" every 30s–1min for Show controls button (like hit with a bat)
  useEffect(() => {
    if (panelVisible) return
    const schedule = () => {
      const delay = 30000 + Math.random() * 30000 // 30–60 s
      const t = setTimeout(() => {
        setShowBtnVel(v => ({
          vx: v.vx + (Math.random() - 0.5) * 24,
          vy: v.vy + (Math.random() - 0.5) * 24,
        }))
        schedule()
      }, delay)
      showBtnJetRef.current = t
    }
    schedule()
    return () => {
      if (showBtnJetRef.current) clearTimeout(showBtnJetRef.current)
    }
  }, [panelVisible])

  const handleShowBtnPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    showBtnDragRef.current = { x: e.clientX, y: e.clientY, startX: showBtnPos.x, startY: showBtnPos.y }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [showBtnPos])

  useEffect(() => {
    if (!showBtnDragRef.current) return
    const onMove = (e: PointerEvent) => {
      const d = showBtnDragRef.current
      if (!d) return
      showBtnWasDraggingRef.current = true
      setShowBtnPos(clampShowBtnToViewport({
        x: d.startX + (e.clientX - d.x),
        y: d.startY + (e.clientY - d.y),
      }))
    }
    const onUp = () => {
      showBtnDragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  return (
    <div className="disco-page">
      <canvas ref={canvasRef} className="disco-canvas" aria-hidden="true" />

      {!panelVisible && (
        <button
          type="button"
          className="disco-show-panel-btn"
          style={{ left: showBtnPos.x, top: showBtnPos.y }}
          onClick={() => {
            if (showBtnWasDraggingRef.current) {
              showBtnWasDraggingRef.current = false
              return
            }
            setPanelVisible(true)
          }}
          onPointerDown={handleShowBtnPointerDown}
          aria-label="Show controls"
        >
          Show controls
        </button>
      )}

      <div
        className={`disco-content disco-panel ${!panelVisible ? 'disco-panel--minimized' : ''}`}
        style={{
          left: panelPos.x,
          top: panelPos.y,
          width: panelSize.w,
          height: panelSize.h,
        }}
        onPointerDown={handlePanelPointerDown}
        onPointerMove={handlePanelPointerMove}
        onPointerUp={handlePanelPointerUp}
        onPointerLeave={handlePanelPointerUp}
      >
        <div className="disco-drag-handle" title="Drag to move, toss to bounce">
          <span className="disco-drag-grip" aria-hidden>⋮⋮</span>
          <Link to="/arcade" className="disco-back">← Arcade</Link>
          <span className="disco-panel-title">Disco Room</span>
          {!token && (
            <a href={typeof window !== 'undefined' ? `/api/spotify/login?frontend_redirect=${encodeURIComponent(window.location.origin + '/arcade/spotify-full')}` : '#'} className="disco-header-signin">Sign in</a>
          )}
          <button type="button" className="disco-hide-btn" onClick={() => setPanelVisible(false)} title="Hide panel">−</button>
        </div>

        {!token && (
          <a
            href={typeof window !== 'undefined' ? `/api/spotify/login?frontend_redirect=${encodeURIComponent(window.location.origin + '/arcade/spotify-full')}` : '#'}
            className="disco-signin-btn"
          >
            Sign in with Spotify
          </a>
        )}
        {premiumError && <div className="disco-premium-err">{premiumError}</div>}

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
            height="280"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="disco-embed"
          />
        </div>
        <div
          className="disco-resize-handle"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handlePanelPointerMove}
          onPointerUp={handlePanelPointerUp}
          onPointerLeave={handlePanelPointerUp}
          aria-label="Resize panel"
        />
      </div>

      <style>{`
        .disco-page { position: relative; min-height: 100vh; overflow: hidden; }
        .disco-canvas { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; }
        .disco-show-panel-btn {
          position: fixed; z-index: 10;
          padding: 0.6rem 1rem; background: var(--arcade); border: none; border-radius: 999px;
          color: var(--bg); font-weight: 600; font-size: 0.9rem; cursor: grab; font-family: var(--font);
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .disco-show-panel-btn:hover { opacity: 0.95; transform: scale(1.02); }
        .disco-show-panel-btn:active { cursor: grabbing; }
        .disco-panel { position: fixed; z-index: 5; display: flex; flex-direction: column; overflow: hidden; border-radius: 16px; box-sizing: border-box; }
        .disco-panel--minimized { visibility: hidden; pointer-events: none; }
        .disco-content { position: relative; z-index: 1; padding: 0 0.9rem 0.9rem; padding-top: 0; flex: 1; display: flex; flex-direction: column; overflow: auto; background: rgba(0,0,0,0.35); border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
        .disco-drag-handle {
          display: flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.75rem; cursor: grab; user-select: none;
          background: linear-gradient(180deg, rgba(255,107,157,0.25) 0%, rgba(0,0,0,0.4) 100%);
          border: 2px solid rgba(255,107,157,0.5); border-bottom-width: 3px;
          border-radius: 16px 16px 0 0;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.1);
        }
        .disco-drag-handle:active { cursor: grabbing; }
        .disco-drag-grip { color: var(--arcade); font-size: 0.9rem; opacity: 0.9; margin-right: 0.25rem; }
        .disco-header-signin { font-size: 0.85rem; font-weight: 600; color: var(--arcade); margin-right: 0.5rem; text-decoration: none; }
        .disco-header-signin:hover { text-decoration: underline; }
        .disco-panel-title { font-weight: 700; color: var(--arcade); font-size: 1rem; flex: 1; }
        .disco-hide-btn { width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px; background: rgba(255,255,255,0.1); color: var(--text); font-size: 1.2rem; line-height: 1; cursor: pointer; }
        .disco-hide-btn:hover { background: rgba(255,255,255,0.2); }
        .disco-resize-handle {
          position: absolute; right: 0; bottom: 0; width: 24px; height: 24px; cursor: nwse-resize;
          background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 50%);
          border-radius: 0 0 12px 0;
        }
        .disco-resize-handle:hover { background: linear-gradient(135deg, transparent 50%, rgba(255,107,157,0.4) 50%); }
        .disco-back { font-size: 0.9rem; color: var(--text-muted); }
        .disco-back:hover { color: var(--arcade); }
        .disco-signin-btn {
          display: inline-block; padding: 0.4rem 0.75rem; background: var(--arcade); color: var(--bg); font-weight: 600;
          border-radius: 8px; text-decoration: none; font-size: 0.85rem; margin-bottom: 0.5rem;
        }
        .disco-signin-btn:hover { opacity: 0.95; }
        .disco-premium-err { font-size: 0.75rem; color: #e74c3c; margin-bottom: 0.5rem; padding: 0.25rem 0; }
        .disco-sdk-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem; padding: 0.5rem; background: rgba(0,0,0,0.4); border-radius: 10px; border: 1px solid var(--arcade); }
        .disco-sdk-label { font-size: 0.75rem; color: var(--text-muted); margin-right: 0.25rem; }
        .disco-sdk-btn { padding: 0.4rem 0.75rem; background: var(--arcade); border: none; border-radius: 8px; color: var(--bg); font-weight: 600; font-size: 0.85rem; cursor: pointer; font-family: var(--font); }
        .disco-sdk-btn:hover { opacity: 0.9; }
        .disco-sdk-btn.disco-sdk-icon { padding: 0.4rem 0.5rem; font-size: 1rem; }
        .disco-controls { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
        .disco-label { font-size: 0.75rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.2rem; }
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
        .disco-embed-wrap { border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.5); position: relative; margin-bottom: 16px; }
        .disco-embed { display: block; border: none; }
        @media (min-width: 600px) {
          .disco-content { margin: 1.5rem auto; }
        }
      `}</style>
    </div>
  )
}
