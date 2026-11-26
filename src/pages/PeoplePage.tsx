import { useEffect, useState } from 'react'
import { RoleChip } from '../components/Chip'
import { useTipsOff } from '../components/useTipsOff'
import { fetchPeopleList } from '../films/api'
import type { Person } from '../films/films'

/** Everyone in the club (#/people), each linking to their profile. System profiles are left out. */
export default function PeoplePage() {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const tips = useTipsOff()

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
        <ul {...tips} className={`chips people-list ${tips.className}`}>
          {people.map((p) => (
            <li key={p.id}>
              <RoleChip person={p} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
