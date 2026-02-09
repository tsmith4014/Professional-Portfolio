import { Link } from 'react-router-dom'

const roles = [
  'Systems Analyst @ DV Trading',
  'Contractor: AI, Cloud & Software Dev',
  'DevOps / Cloud / AI curriculum & instruction',
]

const projects = [
  {
    title: 'Travel Expense Report App',
    line: 'Flask, Docker, Oracle, CI/CD',
    href: 'https://expenseapp.devopschad.com/',
  },
  {
    title: 'Chattanooga Hackathon 2024',
    line: 'Registration site on AWS S3 + Lambda',
    href: 'https://chattanooga-hackathon-2024.devopschad.com/',
  },
  {
    title: 'Sound Arcade',
    line: 'Name That Tune — Spotify 30s previews, React',
    href: '/arcade',
    comingSoon: false,
  },
]

export function Landing() {
  return (
    <>
      <header className="landing-hero">
        <h1 className="landing-title">Chad Thompson-Smith</h1>
        <p className="landing-tagline">Systems · Cloud · AI</p>
        <ul className="landing-roles">
          {roles.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <p className="landing-cta">Explore projects below.</p>
      </header>

      <main className="landing-main">
        <section className="projects-section">
          <h2 className="sr-only">Projects</h2>
          <div className="project-grid">
            {projects.map((p, i) => (
              <div key={i} className="project-card">
                <h3 className="project-title">{p.title}</h3>
                <p className="project-line">{p.line}</p>
                {p.comingSoon ? (
                  <span className="project-link project-link--muted">Coming soon</span>
                ) : p.href.startsWith('/') ? (
                  <Link to={p.href} className="project-link">Play →</Link>
                ) : (
                  <a href={p.href} target="_blank" rel="noopener noreferrer" className="project-link">
                    View live →
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <a href="mailto:support@devopschad.com">support@devopschad.com</a>
        <a href="https://www.linkedin.com/in/chad-thompson-smith/" target="_blank" rel="noopener noreferrer">
          LinkedIn
        </a>
      </footer>

      <style>{`
        .landing-hero {
          text-align: center;
          padding: 4rem 1.5rem 3rem;
        }
        .landing-title {
          font-size: clamp(1.75rem, 4vw, 2.25rem);
          font-weight: 700;
          margin: 0 0 0.25rem;
          letter-spacing: -0.02em;
        }
        .landing-tagline {
          font-family: var(--font-mono);
          font-size: 0.9rem;
          color: var(--accent);
          margin: 0 0 1.5rem;
        }
        .landing-roles {
          list-style: none;
          padding: 0;
          margin: 0 0 1.5rem;
          font-size: 0.9rem;
          color: var(--text-muted);
        }
        .landing-roles li + li { margin-top: 0.35rem; }
        .landing-cta {
          font-size: 0.85rem;
          color: var(--text-muted);
          margin: 0;
        }
        .landing-main { padding: 0 1.5rem 4rem; max-width: 56rem; margin: 0 auto; }
        .projects-section { }
        .project-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        }
        .project-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 1.25rem;
          transition: border-color 0.2s, background 0.2s;
        }
        .project-card:hover { border-color: var(--accent); background: var(--surface-hover); }
        .project-title { font-size: 1rem; margin: 0 0 0.35rem; font-weight: 600; }
        .project-line { font-size: 0.8rem; color: var(--text-muted); margin: 0 0 0.75rem; }
        .project-link { font-size: 0.85rem; }
        .project-link--muted { color: var(--text-muted); cursor: default; }
        .landing-footer {
          padding: 1.5rem;
          text-align: center;
          border-top: 1px solid var(--border);
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          position: relative;
        }
        .landing-footer a { font-size: 0.9rem; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
      `}</style>
    </>
  )
}
