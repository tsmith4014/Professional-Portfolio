import { Link } from 'react-router-dom'

const games: { slug: string; name: string; desc: string; icon: string; comingSoon?: boolean }[] = [
  {
    slug: 'name-that-tune',
    name: 'Name That Tune',
    desc: '30-second previews. Guess the track.',
    icon: '♪',
  },
  {
    slug: 'spotify-full',
    name: 'Full playlist mode',
    desc: 'Play full tracks via Spotify embed. Disco room with moving lights.',
    icon: '♫',
  },
]

export function Arcade() {
  return (
    <div className="arcade-page">
      <header className="arcade-header">
        <Link to="/" className="arcade-back">← Back</Link>
        <h1 className="arcade-title">Arcade</h1>
        <p className="arcade-sub">Music & games. Pick one.</p>
      </header>
      <main className="arcade-main">
        <div className="arcade-grid">
          {games.map((g) => (
            g.comingSoon ? (
              <div key={g.slug} className="arcade-card arcade-card--disabled">
                <span className="arcade-card-icon">{g.icon}</span>
                <h2 className="arcade-card-name">{g.name}</h2>
                <p className="arcade-card-desc">{g.desc}</p>
                <span className="arcade-card-badge">Soon</span>
              </div>
            ) : (
              <Link key={g.slug} to={`/arcade/${g.slug}`} className="arcade-card">
                <span className="arcade-card-icon">{g.icon}</span>
                <h2 className="arcade-card-name">{g.name}</h2>
                <p className="arcade-card-desc">{g.desc}</p>
                <span className="arcade-card-play">Play →</span>
              </Link>
            )
          ))}
        </div>
      </main>
      <style>{`
        .arcade-page { min-height: 100vh; padding: 2rem 1.5rem; }
        .arcade-header { text-align: center; margin-bottom: 2.5rem; }
        .arcade-back { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; display: inline-block; }
        .arcade-back:hover { color: var(--accent); }
        .arcade-title { font-size: 2rem; font-weight: 700; margin: 0 0 0.25rem; color: var(--arcade); }
        .arcade-sub { color: var(--text-muted); margin: 0; font-size: 0.95rem; }
        .arcade-main { max-width: 32rem; margin: 0 auto; }
        .arcade-grid { display: flex; flex-direction: column; gap: 1rem; }
        .arcade-card {
          display: block;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 1.5rem;
          transition: border-color 0.2s, background 0.2s, transform 0.15s;
          color: inherit;
        }
        .arcade-card:hover { border-color: var(--arcade); background: var(--surface-hover); transform: translateY(-2px); }
        .arcade-card--disabled { opacity: 0.7; cursor: default; }
        .arcade-card-icon { font-size: 2rem; display: block; margin-bottom: 0.5rem; }
        .arcade-card-name { font-size: 1.15rem; margin: 0 0 0.35rem; }
        .arcade-card-desc { font-size: 0.85rem; color: var(--text-muted); margin: 0 0 0.5rem; }
        .arcade-card-play { font-size: 0.9rem; color: var(--arcade); }
        .arcade-card-badge { font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono); }
      `}</style>
    </div>
  )
}
