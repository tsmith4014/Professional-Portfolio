# Spotify Web API – What We Use (and What You Get Back)

## Get real 30s previews (with vocals): Sign in with Spotify

With **Client Credentials** (app-only), Spotify often returns `preview_url: null`. With a **user token** (Sign in with Spotify), previews are usually available and are real 30-second clips with vocals.

1. In [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → your app → **Settings** → **Redirect URIs**, add **each** URL where the app is served (Spotify allows multiple):
   - Local dev: **`http://127.0.0.1:5173/api/spotify/callback`**  
     (Spotify does **not** allow `localhost`—use `127.0.0.1`. Callback hits the frontend; Vite proxies `/api` to the backend.)
   - Production (main site): **`https://devopschad.com/api/spotify/callback`** and **`https://www.devopschad.com/api/spotify/callback`**
   - Production (arcade subdomain): **`https://arcade.devopschad.com/api/spotify/callback`**  
   The backend uses the request host for the callback URL, so every domain that serves the app must be listed here.
2. In `backend/.env`: `SPOTIFY_REDIRECT_URI` is set for local dev. For production, set `SPOTIFY_REDIRECT_URI` and `FRONTEND_ORIGIN` to your live URL (e.g. `https://devopschad.com`).
3. On the Name That Tune page, click **Sign in with Spotify**. After you approve, the game will use your token and fetch tracks with real preview URLs.

This doc summarizes the API objects and endpoints we use for the arcade games, so you can build more games on top of it.

## Can you use the Spotify API for full songs?

**No.** The **Spotify Web API does not provide full-track streaming**. It only exposes:

- **`preview_url`** – a single ~30-second MP3 preview per track when available (often `null`). There is no parameter or endpoint to get a longer clip or the full file.
- **Metadata** – track name, artists, album, duration, etc.
- **Playback control** – start/pause/seek on the **user’s own Spotify client** (e.g. open the Spotify app or [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)); the API does not stream audio to your app.

Full-length playback is only possible by:

1. **Spotify’s own players** – [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk) (requires Premium) or the [Embedded Player](https://developer.spotify.com/documentation/embeds) (plays in an iframe).
2. **Native SDKs** – Spotify’s Android/iOS SDKs inside their official apps.

So for a “guess the song” game in a normal web app, **30s previews via `preview_url` are the only option**; there is no way to play full songs through the Web API. This is a deliberate product/API limitation, not something that can be worked around with different endpoints or tokens. See e.g. [spotify/web-api#57](https://github.com/spotify/web-api/issues/57).

## Auth: Client Credentials

- **Endpoint:** `POST https://accounts.spotify.com/api/token`
- **Body:** `grant_type=client_credentials`
- **Auth:** Basic `base64(client_id:client_secret)`
- **Response:** `{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600 }`

Use the access token in the header: `Authorization: Bearer <token>`.

---

## Track Object (from Get Track / Search / Playlist Tracks)

When you call any endpoint that returns tracks, each track looks like this (relevant fields):

| Field           | Type     | Description |
|----------------|----------|-------------|
| `id`           | string   | Spotify track ID (e.g. for Get Track, Get Audio Features). |
| `name`         | string   | Track title. |
| `artists`      | array    | `[{ "id", "name", "uri", ... }]`. Use `artists[].name` for display. |
| `duration_ms`  | integer  | Length in milliseconds. |
| `explicit`     | boolean  | Whether the track has explicit lyrics. |
| `preview_url`  | string \| null | **30-second MP3 preview URL.** Often `null` when using Client Credentials; more likely with user (Authorization Code) tokens. |
| `popularity`   | integer  | 0–100. |
| `album`        | object   | `{ name, id, images[], release_date, ... }`. |
| `uri`          | string   | e.g. `spotify:track:11dFghVXANMlKmJXsNCbNl`. |

**Important:** `preview_url` is defined by Spotify as a **30-second** preview. When it’s non-null, the file is a short clip. With **Client Credentials** only, many tracks return `preview_url: null`; adding “Sign in with Spotify” (user token) improves preview availability.

---

## Endpoints We Use

### 1. Search for Item

- **GET** `https://api.spotify.com/v1/search`
- **Query:** `q=<query>&type=track&limit=50&market=US`
- **Response:** `{ "tracks": { "items": [ TrackObject, ... ], "total", "limit", "offset" } }`

Use for: finding tracks by name, artist, or keyword.

### 2. Get Playlist Items

- **GET** `https://api.spotify.com/v1/playlists/{playlist_id}/tracks`
- **Query:** `limit=50&offset=0&market=US&fields=items(track(name,artists,preview_url,duration_ms,id,album))`
- **Response:** `{ "items": [ { "track": TrackObject | null }, ... ], "total", "limit", "offset", "next" }`

Use for: bulk tracks from a playlist. Paginate with `offset` (e.g. 0, 50, 100) and `next` until you have enough.

### 3. Get Track (single)

- **GET** `https://api.spotify.com/v1/tracks/{id}?market=US`
- **Response:** Full `TrackObject`.

Use for: full metadata and `preview_url` for one track.

### 4. Get Several Tracks

- **GET** `https://api.spotify.com/v1/tracks?ids=id1,id2,...&market=US`
- **Response:** `{ "tracks": [ TrackObject | null, ... ] }`

Use for: batch fetch by IDs (e.g. for “guess the tune” from a fixed set of IDs).

### 5. Get Track’s Audio Features (for future games)

- **GET** `https://api.spotify.com/v1/audio-features/{id}`
- **Response:** `danceability`, `energy`, `valence`, `tempo`, `key`, `mode`, etc.

Use for: rhythm games, mood filters, “match the vibe.”

### 6. Get Recommendations

- **GET** `https://api.spotify.com/v1/recommendations?seed_artists=...&seed_tracks=...&limit=20&market=US`
- **Response:** `{ "tracks": [ TrackObject, ... ] }`

Use for: “more like this” or random-but-coherent sets.

---

## Demo Mode (No Spotify Preview URLs)

When `preview_url` is null for all fetched tracks (typical with Client Credentials), we return **DEMO_TRACKS**: same shape (`name`, `artists`, `previewUrl`) but with public instrumental samples (e.g. SoundHelix). Those are **full-length** instrumentals, not 30s and not with lyrics. The frontend **stops playback after 30 seconds** so it behaves like a preview.

---

## Try It: Raw Response from Your Creds

- **GET** `/api/spotify/explore?playlist_id=37i9dQZF1DXcBWIGoYBM5M` – returns raw playlist-tracks response (first page).
- **GET** `/api/spotify/explore?track_id=11dFghVXANMlKmJXsNCbNl` – returns full track object for one track.

Use these to inspect exact JSON and `preview_url` behavior with your app.
