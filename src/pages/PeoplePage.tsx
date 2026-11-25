import { useEffect, useState } from 'react'
import Chip from '../components/Chip'
import { fetchPeopleList } from '../films/api'
import type { Person } from '../films/films'
import { ROLE_NAMES } from '../people/profile'

/** Everyone in the club (#/people), each linking to their profile. System profiles are left out. */
export default function PeoplePage() {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    fetchPeopleList().then(
      (all) =>
        current &&
        setPeople(all.filter((p) => !p.isSystem).sort((a, b) => a.name.localeCompare(b.name))),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [attempt])

  return (
    <main className="page profile-page">
      <h1>People</h1>
      {failed ? (
        <>
          <p role="alert" className="form-error">
            Couldn't load the people. Check your connection.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setFailed(false)
              setAttempt((n) => n + 1)
            }}
          >
            Try again
          </button>
        </>
      ) : !people ? (
        <p role="status" className="muted">
          Loading people…
        </p>
      ) : (
        <ul className="chips people-list">
          {people.map((p) => (
            <li key={p.id}>
              <Chip person={p} describedBy={`role-${p.id}`} />
              {/* Shown on hover/focus; aria-describedby reads it even while hidden. Touch: the profile shows the role. */}
              <span id={`role-${p.id}`} role="tooltip" className="role-tip">
                {ROLE_NAMES[p.role ?? 'member']}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
