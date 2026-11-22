import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/authContext'
import Chip from '../components/Chip'
import { errorMessage } from '../films/filmDetail'
import type { Person } from '../films/films'
import {
  addPerson,
  createLink,
  fetchAdminPeople,
  revokeLink,
  type AdminPerson,
} from '../invites/api'
import { adminLinkErrorMessage, linkLabel, type OpenLink } from '../invites/links'
import { parseName, renameError, ROLE_NAMES } from '../people/profile'
import NotFoundPage from './NotFoundPage'

type Role = NonNullable<Person['role']>
const ROLES: Role[] = ['member', 'moderator', 'admin', 'viewer']

/**
 * Admin → People (#/admin, plan 9; decision I1): everyone with their login
 * status and open link, add a person, create / regenerate / revoke invite and
 * reset links. A new link is shown once, right after it is made.
 */
export default function AdminPage() {
  const { profile } = useAuth()
  const [data, setData] = useState<{ people: AdminPerson[]; links: OpenLink[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ name: string; kind: OpenLink['kind']; link: string } | null>(
    null,
  )
  const [copied, setCopied] = useState('')
  const linkRef = useRef<HTMLInputElement>(null)
  const isAdmin = profile?.role === 'admin'

  useEffect(() => {
    if (!isAdmin) return
    let current = true
    fetchAdminPeople().then(
      (d) => current && setData(d),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [isAdmin, attempt])

  useEffect(() => {
    if (fresh) linkRef.current?.select()
  }, [fresh])

  if (!isAdmin) return <NotFoundPage />

  const reload = () => setAttempt((n) => n + 1)

  async function act(run: () => Promise<void>, message: (e: unknown) => string) {
    setBusy(true)
    setError(null)
    try {
      await run()
    } catch (e) {
      setError(message(e))
    }
    setBusy(false)
    reload()
  }

  const create = (person: AdminPerson, kind: OpenLink['kind']) =>
    act(async () => {
      setFresh(null)
      setCopied('')
      const { link } = await createLink(kind, person.id)
      setFresh({ name: person.name, kind, link })
    }, adminLinkErrorMessage)

  const revoke = (link: OpenLink) => act(() => revokeLink(link.id), errorMessage)

  async function copy() {
    if (!fresh) return
    try {
      await navigator.clipboard.writeText(fresh.link)
      setCopied('Copied.')
    } catch {
      linkRef.current?.select()
      setCopied("Couldn't copy: the link is selected, copy it with Ctrl+C.")
    }
  }

  return (
    <main className="page rotation-page">
      <h1>Admin</h1>
      <h2>People</h2>
      {fresh && (
        <section className="rotation-form" aria-labelledby="fresh-heading">
          <h3 id="fresh-heading">
            New {fresh.kind === 'invite' ? 'invite' : 'reset link'} for {fresh.name}
          </h3>
          <p>
            Copy it now and send it privately: it is shown only this once and can't be shown again.
            {fresh.kind === 'invite'
              ? ' It works once, for 14 days.'
              : ' It works once, for 24 hours.'}
          </p>
          <label className="field">
            Link
            <input ref={linkRef} readOnly value={fresh.link} onFocus={(e) => e.target.select()} />
          </label>
          <div className="actions">
            <button type="button" className="button button-small" onClick={copy}>
              Copy link
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => setFresh(null)}
            >
              Done
            </button>
          </div>
          <p role="status">{copied}</p>
        </section>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
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
              reload()
            }}
          >
            Try again
          </button>
        </>
      ) : !data ? (
        <p role="status" className="muted">
          Loading people…
        </p>
      ) : (
        <>
          <div className="table-scroll" role="region" aria-label="People" tabIndex={0}>
            <table className="rotation-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Login</th>
                  <th scope="col">Link</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => {
                  const link = data.links.find((l) => l.profileId === p.id)
                  const kind = p.isClaimed ? 'reset' : 'invite'
                  const what = kind === 'invite' ? 'invite' : 'reset link'
                  return (
                    <tr key={p.id}>
                      <td>
                        <Chip person={p} />
                      </td>
                      <td>{p.role && ROLE_NAMES[p.role]}</td>
                      <td>{p.isClaimed ? 'Has a login' : 'Not claimed yet'}</td>
                      <td>{link ? linkLabel(link) : '—'}</td>
                      <td>
                        <div className="actions">
                          {!p.isClaimed && !p.colour ? (
                            <span className="muted">Needs a colour before an invite</span>
                          ) : (
                            <button
                              type="button"
                              className="button button-small"
                              disabled={busy}
                              aria-label={`${link ? 'Regenerate' : 'Create'} ${what} for ${p.name}`}
                              onClick={() => create(p, kind)}
                            >
                              {link ? `Regenerate ${what}` : `Create ${what}`}
                            </button>
                          )}
                          {link && (
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              disabled={busy}
                              aria-label={`Revoke ${what} for ${p.name}`}
                              onClick={() => revoke(link)}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <AddPerson people={data.people} onAdded={reload} />
        </>
      )}
    </main>
  )
}

/** Add a person (decision I1): name, colour (needed for an invite), role. */
function AddPerson({ people, onAdded }: { people: Person[]; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [colour, setColour] = useState('#4a86e8')
  const [role, setRole] = useState<Role>('member')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    const parsed = parseName(name, people, '')
    if ('error' in parsed) return setError(parsed.error)
    setError(null)
    setBusy(true)
    try {
      await addPerson(parsed.name, colour, role)
      setNotice(`${parsed.name} added. Create their invite above.`)
      setName('')
      onAdded()
    } catch (e) {
      setError(renameError(e))
    }
    setBusy(false)
  }

  return (
    <form className="rotation-form" aria-labelledby="add-heading" onSubmit={submit} noValidate>
      <h3 id="add-heading">Add person</h3>
      <label className="field">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-invalid={!!error}
          aria-describedby={error ? 'add-error' : undefined}
        />
      </label>
      <label className="field">
        Colour
        <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} required />
      </label>
      <label className="field">
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_NAMES[r]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p id="add-error" role="alert" className="form-error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      <button type="submit" className="button" disabled={busy}>
        {busy ? 'Adding…' : 'Add person'}
      </button>
    </form>
  )
}
