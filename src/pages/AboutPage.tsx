import tmdbLogo from '../assets/tmdb-logo.svg'

/**
 * About (#/about, plan 9): TMDB attribution as TMDB's terms require (their
 * logo, bundled here so the CSP stays img-src 'self', less prominent than
 * our own name, and their exact notice) and short credits.
 */
export default function AboutPage() {
  return (
    <main className="page about-page">
      <h1>About Film Club</h1>
      <p>
        A private site for our film club: what we watched, who chose it, who came, the scores and
        whose turn it is next.
      </p>
      <h2>Film data</h2>
      <a href="https://www.themoviedb.org/" className="tmdb-logo">
        <img src={tmdbLogo} alt="The Movie Database (TMDB)" width="139" height="18" />
      </a>
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      <p>Film titles, posters, synopses, genres and directors come from TMDB.</p>
      <h2>Credits</h2>
      <p>Built with React, Vite and Supabase, and hosted on GitHub Pages.</p>
    </main>
  )
}
