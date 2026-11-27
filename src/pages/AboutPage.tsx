import { useContext, useEffect, useRef } from 'react'
import tmdbLogo from '../assets/tmdb-logo.svg'
import { AuthContext } from '../auth/authContext'
import { ROLE_NAMES } from '../people/profile'

// In ROLE_NAMES' order (admin, moderator, member, viewer), which the marks below follow.
const ROLE_KEYS: readonly string[] = Object.keys(ROLE_NAMES)
const ROLES = Object.values(ROLE_NAMES)

// What each role can do, exactly as the database's row-level security allows.
// Marks are [admin, moderator, member, viewer].
const EVERYONE = [true, true, true, true]
const MEMBERS = [true, true, true, false]
const STAFF = [true, true, false, false]
const ADMIN = [true, false, false, false]
const PERMISSIONS: [string, boolean[]][] = [
  ['See films, scores, comments, people and the rotation', EVERYONE],
  ['Mark your own attendance', MEMBERS],
  ['Pick a theme (viewers: saved in this browser only)', EVERYONE],
  ['Enter, edit and delete your own score', MEMBERS],
  ['Post comments, and edit or delete your own', MEMBERS],
  ['Record your own pass (for the coming week or later)', MEMBERS],
  ['Change your display name', MEMBERS],
  ['Write suggestions on the Support page, and reply to your own while they are open', EVERYONE],
  ['Delete your own suggestion, until someone else replies', EVERYONE],
  ['Add and edit films', STAFF],
  ["Mark other people's attendance", STAFF],
  ["Enter, edit and delete other people's scores", STAFF],
  ["Record other people's passes and who chooses next", STAFF],
  ['Adjust the rotation: starting points, corrections, clearing an owed turn', STAFF],
  ["See and reply to everyone's suggestions", STAFF],
  ['Close and reopen suggestions (a closed one takes no replies)', STAFF],
  ['Delete films', ADMIN],
  ["Edit and delete anyone's comments", ADMIN],
  ['Delete any suggestion', ADMIN],
  ['Add people, and make invite and password-reset links', ADMIN],
  ['Revoke invite and reset links', ADMIN],
  ['Set the rotation start date', ADMIN],
  ["Change people's roles and colours", ADMIN],
  ['Remove a login', ADMIN],
  ['Export all data', ADMIN],
]

/**
 * About (#/about, plan 9): what each role can do, TMDB attribution as TMDB's
 * terms require (their logo, less prominent than our own name, and their exact
 * notice) and short credits. The logo is bundled, not hot-linked: Vite inlines
 * it as a data: URI, which the CSP's img-src allows.
 */
export default function AboutPage() {
  // Logged out (or rendered outside the provider): no highlight. Same for an unknown role
  // or a system profile (they never log in, but never claim to be one).
  const profile = useContext(AuthContext)?.profile
  const mine = profile && !profile.is_system ? ROLE_KEYS.indexOf(profile.role) : -1
  const you = (i: number) => (i === mine ? 'your-role' : undefined)
  // On a phone the columns scroll sideways: bring "(you)" into view, the page itself unmoved.
  const scrollBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scrollBox.current
    const th = box?.querySelector('thead .your-role')
    if (!box || !th) return
    const over = th.getBoundingClientRect().right - box.getBoundingClientRect().right
    if (over > 0) box.scrollLeft += Math.ceil(over) // scrollLeft rounds down
  }, [mine])
  return (
    <main className="page about-page">
      <h1>About Film Club</h1>
      <p>
        A private site for our film club: what we watched, who chose it, who came, the scores and
        whose turn it is next.
      </p>
      <h2>Roles</h2>
      <p>
        Everyone has one of four roles. Members take part: they come, score and comment. Moderators
        also look after the films and the rotation for everyone. The admin also looks after people,
        logins and the club's data. Viewers can look, pick a theme and write suggestions, nothing
        else.
      </p>
      {mine >= 0 && (
        <p className="your-role-note">
          You are {/^[AEIOU]/.test(ROLES[mine]) ? 'an' : 'a'} {ROLES[mine].toLowerCase()}.
        </p>
      )}
      <div ref={scrollBox} className="table-scroll" role="region" aria-label="Roles" tabIndex={0}>
        <table className="rotation-table roles-table">
          <caption className="sr-only">What each role can do</caption>
          <thead>
            <tr>
              <th scope="col">What you can do</th>
              {ROLES.map((role, i) => (
                <th scope="col" key={role} className={you(i)}>
                  {role}
                  {i === mine && ' (you)'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map(([what, marks]) => (
              <tr key={what}>
                <th scope="row">{what}</th>
                {marks.map((yes, i) => (
                  <td key={ROLES[i]} className={you(i)}>
                    <span aria-hidden="true">{yes ? '✓' : '—'}</span>
                    <span className="sr-only">{yes ? 'yes' : 'no'}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul>
        <li>
          Viewers can look at everything but can't change anything except their theme, which is
          saved only in their browser. They can write suggestions and reply to their own.
        </li>
        <li>A suggestion is seen only by its author, the moderators and the admin.</li>
        <li>Nobody can change their own role.</li>
        <li>Jurassic Shark 2's scores are locked, and the film can't be deleted, for everyone.</li>
      </ul>
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
