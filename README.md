# Career Page

Minimal landing that links to live projects (AWS, Oracle). Hidden **arcade** with music games (easter egg from footer).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. Click the **?** in the footer to open the arcade.

## Build & Docker

```bash
npm run build
docker build -t tsmith4014/career-page:latest .
docker run -p 8000:8000 tsmith4014/career-page:latest
```

Existing CI/CD (push to `main` → build image → deploy to Oracle) is unchanged.

## Arcade / music games

- **Name That Tune** — 30-second previews, guess the track. Add `previewUrl` to tracks in `src/pages/arcade/NameThatTune.tsx` (e.g. from [Spotify Web API](https://developer.spotify.com/documentation/web-api) `preview_url`), or add a small backend that returns tracks with preview URLs.
- **Full playlist mode** — “Sign in with Spotify” for full tracks is placeholder; can be added later with Spotify OAuth + Web Playback SDK.

## Content

- **Landing:** `src/pages/Landing.tsx` (roles, project links).
- **Projects:** Edit the `projects` array in `Landing.tsx`.
- **Arcade games:** `src/pages/arcade/`.
