"""
Small FastAPI backend for the arcade: fetches tracks with 30s preview URLs from Spotify.
Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI in backend/.env.
Sign in with Spotify (OAuth) gives real 30s previews with vocals; app-only token often returns null previews.
"""
import os
import secrets
from pathlib import Path
from urllib.parse import urlencode, quote, urlparse, unquote

from dotenv import load_dotenv

# Load .env from backend dir (so it works when run as uvicorn main:app from backend/)
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse, JSONResponse
import httpx

app = FastAPI(title="Career page API")

# CORS: local dev + production origin from env (e.g. https://devopschad.com)
_cors_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if os.environ.get("FRONTEND_ORIGIN"):
    _cors_origins.append(os.environ.get("FRONTEND_ORIGIN", "").strip())
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in _cors_origins if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SoundHelix: instrumental only, full-length (no lyrics). Frontend stops after 30s to mimic a preview.
# Spotify preview_url when present is a real 30-second clip (often with vocals); often null with Client Credentials.
_BASE = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-"
_DEMO_NAMES = [
    ("Blinding Lights", "The Weeknd"), ("Levitating", "Dua Lipa"), ("Save Your Tears", "The Weeknd"),
    ("Stay", "The Kid LAROI, Justin Bieber"), ("Good 4 U", "Olivia Rodrigo"), ("Heat Waves", "Glass Animals"),
    ("As It Was", "Harry Styles"), ("Shivers", "Ed Sheeran"), ("First Class", "Jack Harlow"),
    ("Super Gremlin", "Kodak Black"), ("Industry Baby", "Lil Nas X"), ("Woman", "Doja Cat"),
    ("Need to Know", "Doja Cat"), ("Montero", "Lil Nas X"), ("Kiss Me More", "Doja Cat, SZA"),
    ("Leave The Door Open", "Silk Sonic"), ("Peaches", "Justin Bieber"), ("Drivers License", "Olivia Rodrigo"),
    ("Positions", "Ariana Grande"), ("Mood", "24kGoldn, iann dior"), ("Dynamite", "BTS"),
    ("Watermelon Sugar", "Harry Styles"), ("Don't Start Now", "Dua Lipa"), ("Circles", "Post Malone"),
    ("Sunflower", "Post Malone, Swae Lee"), ("Bad Guy", "Billie Eilish"), ("Old Town Road", "Lil Nas X"),
    ("Uptown Funk", "Bruno Mars"), ("Shape of You", "Ed Sheeran"), ("Blinding Lights", "The Weeknd"),
    ("Someone Like You", "Adele"), ("Rolling in the Deep", "Adele"), ("Happy", "Pharrell Williams"),
    ("Get Lucky", "Daft Punk, Pharrell"), ("Radioactive", "Imagine Dragons"), ("Counting Stars", "OneRepublic"),
    ("Royals", "Lorde"), ("Locked Out of Heaven", "Bruno Mars"), ("We Are Young", "fun., Janelle Monáe"),
    ("Somebody That I Used to Know", "Gotye"), ("Pumped Up Kicks", "Foster the People"),
    ("Firework", "Katy Perry"), ("Just the Way You Are", "Bruno Mars"), ("Grenade", "Bruno Mars"),
    ("Love the Way You Lie", "Eminem, Rihanna"), ("California Gurls", "Katy Perry"), ("Teenage Dream", "Katy Perry"),
    ("Airplanes", "B.o.B, Hayley Williams"), ("Billionaire", "Travie McCoy, Bruno Mars"), ("Break Your Heart", "Taio Cruz"),
]
# Cycle through SoundHelix 1–16 so we have 50 tracks with 16 unique clips
DEMO_TRACKS = [
    {"name": name, "artists": artists, "previewUrl": f"{_BASE}{(i % 16) + 1}.mp3"}
    for i, (name, artists) in enumerate(_DEMO_NAMES)
]


def _get_spotify_credentials() -> tuple[str, str] | None:
    # Strip to avoid BOM/CRLF/space issues from .env or Docker env_file
    client_id = (os.environ.get("SPOTIFY_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("SPOTIFY_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        return None
    return (client_id, client_secret)


async def get_spotify_token(user_token: str | None = None) -> str | None:
    """Use user_token (from OAuth) if provided; else fall back to client credentials."""
    if user_token and (user_token or "").strip():
        return user_token.strip()
    creds = _get_spotify_credentials()
    if not creds:
        return None
    client_id, client_secret = creds
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "client_credentials"},
            auth=(client_id, client_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if r.status_code != 200:
            return None
        return r.json().get("access_token")


def _redirect_uri() -> str:
    # Spotify requires loopback as 127.0.0.1 or [::1], not localhost (as of 2025).
    # Default to frontend origin so callback is reached via Vite proxy (browser never hits backend port).
    return (os.environ.get("SPOTIFY_REDIRECT_URI") or "http://127.0.0.1:5173/api/spotify/callback").strip()


def _frontend_origin() -> str:
    return os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173").strip()


async def _user_market(token: str) -> str:
    """Get authenticated user's country for market parameter (improves preview_url availability)."""
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        if r.status_code != 200:
            return "US"
        data = r.json()
        return (data.get("country") or "US").upper()[:2]


# In-memory state for OAuth (validate callback). In production use Redis or similar.
_oauth_states: set[str] = set()
# Short-lived session for token handoff (sid -> {access_token, expires_in}). One-time use.
_session_tokens: dict[str, dict] = {}


@app.get("/api/spotify/login")
async def spotify_login(frontend_redirect: str | None = None):
    """Redirect to Spotify to sign in. After auth, user is sent back to frontend with token in hash."""
    creds = _get_spotify_credentials()
    if not creds:
        return {"error": "Spotify app credentials not configured."}
    client_id, _ = creds
    state = secrets.token_urlsafe(16)
    _oauth_states.add(state)
    redirect = _redirect_uri()
    params = {
        "response_type": "code",
        "client_id": client_id,
        "scope": "user-read-private user-read-email streaming user-modify-playback-state user-read-playback-state",
        "redirect_uri": redirect,
        "state": state,
    }
    if frontend_redirect:
        params["state"] = f"{state}|{frontend_redirect}"
    url = "https://accounts.spotify.com/authorize?" + urlencode(params)
    return RedirectResponse(url=url)


@app.get("/api/spotify/callback")
async def spotify_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Exchange code for access token and redirect to backend success page, then frontend gets token via session."""
    frontend = _frontend_origin() + "/arcade/name-that-tune"
    state_to_validate = state
    if state and "|" in state:
        state_part, frontend_redirect = state.split("|", 1)
        if frontend_redirect.startswith("http"):
            frontend = frontend_redirect
        state_to_validate = state_part
    # Pass through Spotify's error (e.g. redirect_uri_mismatch) so user can fix in Dashboard
    err = error or (None if code else "no_code")
    if err:
        return RedirectResponse(url=f"{frontend}#error={err}")
    if not state_to_validate or state_to_validate not in _oauth_states:
        return RedirectResponse(url=f"{frontend}#error=state_mismatch")
    _oauth_states.discard(state_to_validate)
    creds = _get_spotify_credentials()
    if not creds:
        return RedirectResponse(url=f"{frontend}#error=config")
    client_id, client_secret = creds
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://accounts.spotify.com/api/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _redirect_uri(),
            },
            auth=(client_id, client_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if r.status_code != 200:
        return RedirectResponse(url=f"{frontend}#error=token_exchange")
    data = r.json()
    access_token = data.get("access_token")
    expires_in = data.get("expires_in", 3600)
    if not access_token:
        return RedirectResponse(url=f"{frontend}#error=no_token")
    # Use session handoff: redirect to frontend success route so browser stays on same origin (no direct hit to backend port).
    sid = secrets.token_urlsafe(24)
    _session_tokens[sid] = {"access_token": access_token, "expires_in": expires_in}
    parsed = urlparse(frontend)
    frontend_origin = f"{parsed.scheme}://{parsed.netloc}"
    success_url = f"{frontend_origin}/arcade/spotify-success?sid={quote(sid, safe='')}&redirect={quote(frontend, safe='')}"
    return RedirectResponse(url=success_url)


def _js_escape(s: str) -> str:
    """Escape for use inside a JS double-quoted string."""
    return (
        s.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


@app.get("/api/spotify/session")
async def spotify_session(sid: str):
    """One-time exchange: return token for sid and remove from store. Used by success page (same-origin)."""
    data = _session_tokens.pop(sid, None)
    if not data:
        return {"error": "invalid_or_expired"}
    return {"access_token": data["access_token"], "expires_in": data["expires_in"]}


def _html_escape(s: str) -> str:
    """Escape for HTML attribute/text."""
    return (
        s.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


@app.get("/api/spotify/success", response_class=HTMLResponse)
async def spotify_success(redirect: str, sid: str):
    """Intermediate page after OAuth: land on backend (short URL), fetch token via sid, then redirect to frontend with token in hash."""
    redirect_esc = _js_escape(redirect)
    sid_esc = _js_escape(sid)
    fallback = _frontend_origin() + "/arcade/name-that-tune"
    fallback_esc = _js_escape(fallback)
    link_href = _html_escape(unquote(redirect) if redirect else fallback)
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Signed in</title></head>
<body><p>Signed in with Spotify. Taking you back to the game...</p>
<script>
(function() {{
  var redirect = decodeURIComponent("{redirect_esc}");
  var sid = decodeURIComponent("{sid_esc}");
  var fallback = decodeURIComponent("{fallback_esc}");
  if (!redirect) redirect = fallback;
  fetch("/api/spotify/session?sid=" + encodeURIComponent(sid))
    .then(function(r) {{ return r.json(); }})
    .then(function(d) {{
      if (d.access_token)
        window.location = redirect + "#access_token=" + encodeURIComponent(d.access_token) + "&expires_in=" + (d.expires_in || 3600);
      else
        window.location = redirect + "#error=" + (d.error || "session_invalid");
    }})
    .catch(function() {{ window.location = redirect + "#error=session_failed"; }});
}})();
</script>
<noscript><p><a href="{link_href}">Click here to continue</a></p></noscript>
</body></html>"""
    return HTMLResponse(html)


# Playlists likely to have 30s previews with vocals (pop, hip-hop, R&B, top hits). Skip instrumental-only.
_VOCAL_PLAYLIST_IDS = [
    "37i9dQZF1DXcBWIGoYBM5M",   # Today's Top Hits
    "37i9dQZEVXbMDoHDwVN2tF",   # Global Top 50
    "37i9dQZF1DX4JAvHpjipBk4",   # New Music Friday
    "37i9dQZF1DX76t2zv8pTV4",   # Pop
    "37i9dQZF1DX10zKzsJ2jva",   # Viva Latino
    "37i9dQZF1DWXRqgorJj26U",   # Rock Classics
    "37i9dQZF1DX4dyzvuaRJ0n",   # Chill Hits
    "37i9dQZF1DX0XUsuxWHRQd",   # RapCaviar
    "37i9dQZF1DX4SBhb3fQJuB",   # Are & Be
    "37i9dQZF1DX1lVhpt4YRCh",   # Hot Country
    "37i9dQZF1DX1s9knjP51Oa",   # Pop Rising
]
_SEARCH_QUERIES = ["pop", "top hits", "hip hop", "r&b", "country", "rock hits"]


@app.get("/api/tracks")
async def get_tracks(
    request: Request,
    limit: int = 50,
    authorization: str | None = Header(None),
    access_token: str | None = None,
):
    """Return tracks. Send Authorization: Bearer <token> or ?access_token=... when signed in with Spotify."""
    limit = min(max(1, limit), 100)
    user_token = None
    if authorization and authorization.startswith("Bearer "):
        user_token = authorization[7:].strip()
    if not user_token and access_token:
        user_token = access_token.strip()
    token = await get_spotify_token(user_token=user_token)
    if not token:
        return JSONResponse(
            content={"tracks": DEMO_TRACKS[:limit], "auth": "no-token"},
            headers={"X-Spotify-Auth": "no-token"},
        )

    # User's market improves preview availability (region-specific).
    market = "US"
    if user_token:
        market = await _user_market(token)

    async with httpx.AsyncClient() as client:
        headers = {"Authorization": f"Bearer {token}"}
        with_preview: list[dict] = []
        without_preview: list[dict] = []
        seen: set[tuple[str, str]] = set()

        def add_track(t: dict) -> None:
            name = (t.get("name") or "").strip()
            artists = ", ".join(a.get("name", "") for a in t.get("artists", []))
            key = (name, artists)
            if not name or key in seen:
                return
            seen.add(key)
            preview = (t.get("preview_url") or "").strip()
            track_id = (t.get("id") or "").strip() or None
            entry = {"name": name, "artists": artists, "previewUrl": preview, "id": track_id}
            if preview:
                with_preview.append(entry)
            else:
                without_preview.append(entry)

        # Playlists: when signed in we want any Spotify tracks (for embed by id); when not, fill up to limit.
        total = lambda: len(with_preview) + len(without_preview)
        for playlist_id in _VOCAL_PLAYLIST_IDS:
            if total() >= limit:
                break
            for offset in (0, 50, 100):
                if total() >= limit:
                    break
                r = await client.get(
                    f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
                    params={"limit": 50, "offset": offset, "market": market, "fields": "items(track(name,artists,preview_url,id))"},
                    headers=headers,
                )
                if r.status_code != 200:
                    break
                data = r.json()
                for item in data.get("items", []):
                    track = item.get("track")
                    if track:
                        add_track(track)
                if not data.get("next"):
                    break

        # Search: more vocal-heavy queries.
        for query in _SEARCH_QUERIES:
            if total() >= limit:
                break
            r = await client.get(
                "https://api.spotify.com/v1/search",
                params={"q": query, "type": "track", "limit": 50, "market": market},
                headers=headers,
            )
            if r.status_code != 200:
                continue
            for t in r.json().get("tracks", {}).get("items", []):
                add_track(t)

        # When signed in: return ALL Spotify tracks we got (with id for embed). Embed plays full track; we don't need preview_url.
        if user_token:
            all_spotify = (with_preview + without_preview)[:limit]
            if len(all_spotify) < 1:
                return JSONResponse(
                    content={"tracks": DEMO_TRACKS[:limit], "auth": "user-token-no-tracks"},
                    headers={"X-Spotify-Auth": "user-token-no-tracks"},
                )
            return JSONResponse(
                content={"tracks": all_spotify, "auth": "user-token"},
                headers={"X-Spotify-Auth": "user-token", "X-Spotify-Count": str(len(all_spotify))},
            )

        # App-only token: return mix; fall back to demo if too few with preview.
        tracks = (with_preview + without_preview)[:limit]
        if not tracks or sum(1 for t in tracks if t.get("previewUrl")) < 5 or len(tracks) < 15:
            return JSONResponse(
                content={"tracks": DEMO_TRACKS[:limit], "auth": "app-token-fallback"},
                headers={"X-Spotify-Auth": "app-token-fallback"},
            )
        return JSONResponse(
            content={"tracks": tracks, "auth": "app-token"},
            headers={"X-Spotify-Auth": "app-token", "X-Spotify-Count": str(len(tracks))},
        )


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/debug")
async def debug():
    """Check if Spotify credentials are visible to the backend (no secrets exposed)."""
    creds = _get_spotify_credentials()
    return {
        "has_credentials": creds is not None,
        "redirect_uri": _redirect_uri(),
        "hint": "Add this exact Redirect URI in Spotify Dashboard → Your app → Settings → Redirect URIs",
    }


@app.put("/api/spotify/play")
async def spotify_play(
    request: Request,
    authorization: str | None = Header(None),
    access_token: str | None = None,
):
    """Start playback on a Web Playback SDK device (Premium). Body: { device_id, context_uri? } or { device_id, uris? }."""
    user_token = None
    if authorization and authorization.startswith("Bearer "):
        user_token = authorization[7:].strip()
    if not user_token and access_token:
        user_token = access_token.strip()
    if not user_token:
        return JSONResponse(content={"error": "auth_required"}, status_code=401)
    token = await get_spotify_token(user_token=user_token)
    if not token:
        return JSONResponse(content={"error": "invalid_token"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(content={"error": "invalid_json"}, status_code=400)
    device_id = body.get("device_id")
    if not device_id:
        return JSONResponse(content={"error": "device_id required"}, status_code=400)
    play_body: dict = {}
    if body.get("context_uri"):
        play_body["context_uri"] = body["context_uri"]
    elif body.get("uris"):
        play_body["uris"] = body["uris"]
    async with httpx.AsyncClient() as client:
        r = await client.put(
            f"https://api.spotify.com/v1/me/player/play?device_id={device_id}",
            json=play_body if play_body else None,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
    if r.status_code == 204:
        return {"ok": True}
    if r.status_code == 404:
        return JSONResponse(content={"error": "Premium required", "detail": r.text}, status_code=402)
    if r.status_code != 200:
        return JSONResponse(content={"error": r.text}, status_code=r.status_code)
    return {"ok": True}


@app.get("/api/spotify/now")
async def spotify_now(
    authorization: str | None = Header(None),
    access_token: str | None = None,
):
    """Get the user's currently playing track (for beat sync). Requires user token."""
    user_token = None
    if authorization and authorization.startswith("Bearer "):
        user_token = authorization[7:].strip()
    if not user_token and access_token:
        user_token = access_token.strip()
    if not user_token:
        return JSONResponse(content={"error": "auth_required"}, status_code=401)
    token = await get_spotify_token(user_token=user_token)
    if not token:
        return JSONResponse(content={"error": "invalid_token"}, status_code=401)
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://api.spotify.com/v1/me/player/currently-playing",
            headers={"Authorization": f"Bearer {token}"},
        )
    if r.status_code == 204 or r.status_code == 200 and not r.content:
        return {"is_playing": False}
    if r.status_code != 200:
        return JSONResponse(content={"error": r.text}, status_code=r.status_code)
    data = r.json()
    item = data.get("item")
    if not item:
        return {"is_playing": False}
    return {
        "is_playing": data.get("is_playing", False),
        "progress_ms": data.get("progress_ms", 0),
        "track_id": item.get("id"),
        "duration_ms": item.get("duration_ms"),
    }


@app.get("/api/spotify/audio-analysis/{track_id:path}")
async def spotify_audio_analysis(
    track_id: str,
    authorization: str | None = Header(None),
    access_token: str | None = None,
):
    """Get beat/tatum data for a track (for light sync). Requires user token."""
    user_token = None
    if authorization and authorization.startswith("Bearer "):
        user_token = authorization[7:].strip()
    if not user_token and access_token:
        user_token = access_token.strip()
    if not user_token:
        return JSONResponse(content={"error": "auth_required"}, status_code=401)
    token = await get_spotify_token(user_token=user_token)
    if not token:
        return JSONResponse(content={"error": "invalid_token"}, status_code=401)
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"https://api.spotify.com/v1/audio-analysis/{track_id.strip()}",
            headers={"Authorization": f"Bearer {token}"},
        )
    if r.status_code != 200:
        return JSONResponse(content={"error": r.text}, status_code=r.status_code)
    data = r.json()
    beats = [{"start": b["start"], "duration": b.get("duration", 0.5)} for b in data.get("beats", [])]
    tatums = [{"start": t["start"]} for t in data.get("tatums", [])]
    return {"track_id": track_id, "beats": beats[:256], "tatums": tatums[:512]}


@app.get("/api/spotify/explore")
async def spotify_explore(playlist_id: str | None = None, track_id: str | None = None):
    """
    Return raw Spotify API response so you can inspect the object shape.
    Use ?playlist_id=... for Get Playlist Tracks, or ?track_id=... for Get Track.
    See backend/SPOTIFY_API.md for field reference.
    """
    token = await get_spotify_token()
    if not token:
        return {"error": "No Spotify credentials. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET."}
    async with httpx.AsyncClient() as client:
        headers = {"Authorization": f"Bearer {token}"}
        if track_id:
            r = await client.get(
                f"https://api.spotify.com/v1/tracks/{track_id}",
                params={"market": "US"},
                headers=headers,
            )
            if r.status_code != 200:
                return {"error": r.text, "status_code": r.status_code}
            return {"source": "GET /v1/tracks/{id}", "response": r.json()}
        if playlist_id:
            r = await client.get(
                f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
                params={"limit": 5, "market": "US"},
                headers=headers,
            )
            if r.status_code != 200:
                return {"error": r.text, "status_code": r.status_code}
            return {"source": "GET /v1/playlists/{id}/tracks", "response": r.json()}
    return {"error": "Provide playlist_id= or track_id="}
