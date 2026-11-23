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
const HEX = /^#[0-9a-f]{6}$/i
/** The id of a person's create / regenerate button: focus comes back to it. */
const buttonId = (p: Person) => `link-button-${p.id}`

/** A regenerate or revoke waiting for the admin's yes: it kills a link that may have been sent. */
interface Pending {
  person: AdminPerson
  link: OpenLink
  action: 'regenerate' | 'revoke'
}

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
  const [fresh, setFresh] = useState<{
    person: AdminPerson
    kind: OpenLink['kind']
    link: string
  } | null>(null)
  const [copied, setCopied] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  // Where focus goes once the list has reloaded (never left on <body>).
  const focusNext = useRef<string | null>(null)
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
    if (fresh) {
      linkRef.current?.focus()
      linkRef.current?.select()
    }
  }, [fresh])

  useEffect(() => {
    if (!data || !focusNext.current) return
    document.getElementById(focusNext.current)?.focus()
    focusNext.current = null
  }, [data])

  if (!isAdmin) return <NotFoundPage />

  const reload = () => setAttempt((n) => n + 1)

  async function act(
    person: AdminPerson,
    run: () => Promise<void>,
    message: (e: unknown) => string,
  ) {
    setBusy(true)
    setError(null)
    focusNext.current = buttonId(person)
    try {
      await run()
    } catch (e) {
      setError(message(e))
    }
    setBusy(false)
    reload()
  }

  const create = (person: AdminPerson, kind: OpenLink['kind']) =>
    act(
      person,
      async () => {
        setFresh(null)
        setCopied('')
        const { link } = await createLink(kind, person.id)
        // The new link's panel takes focus instead.
        focusNext.current = null
        setFresh({ person, kind, link })
      },
      adminLinkErrorMessage,
    )

  function ask(next: Pending) {
    setPending(next)
    dialog.current?.showModal()
    cancel.current?.focus()
  }

  function confirmPending() {
    if (!pending) return
    dialog.current?.close()
    const { person, link, action } = pending
    if (action === 'regenerate') create(person, link.kind)
    else act(person, () => revokeLink(link.id), errorMessage)
  }

  function done() {
    if (fresh) document.getElementById(buttonId(fresh.person))?.focus()
    setFresh(null)
  }

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
            New {fresh.kind === 'invite' ? 'invite' : 'reset link'} for {fresh.person.name}
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
            <button type="button" className="button button-secondary button-small" onClick={done}>
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
            <table className="rotation-table people-table">
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
                      <td data-label="Role">{p.role && ROLE_NAMES[p.role]}</td>
                      <td data-label="Login">{p.isClaimed ? 'Has a login' : 'Not claimed yet'}</td>
                      <td data-label="Link">{link ? linkLabel(link) : '—'}</td>
                      <td>
                        <div className="actions">
                          {!p.isClaimed && !p.colour ? (
                            <span className="muted">Needs a colour before an invite</span>
                          ) : (
                            <button
                              id={buttonId(p)}
                              type="button"
                              className="button button-small"
                              disabled={busy}
                              aria-label={`${link ? 'Regenerate' : 'Create'} ${what} for ${p.name}`}
                              onClick={() =>
                                link
                                  ? ask({ person: p, link, action: 'regenerate' })
                                  : create(p, kind)
                              }
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
                              onClick={() => ask({ person: p, link, action: 'revoke' })}
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
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="confirm-link-heading"
        onClose={() => setPending(null)}
      >
        {pending && (
          <>
            <h2 id="confirm-link-heading">
              {pending.action === 'revoke' ? 'Revoke' : 'Regenerate'} the{' '}
              {pending.link.kind === 'invite' ? 'invite' : 'reset link'} for {pending.person.name}?
            </h2>
            <p>
              The link already made stops working, even if it was sent.
              {pending.action === 'regenerate' && ' A new one is made to send instead.'}
            </p>
          </>
        )}
        <div className="actions">
          {/* First, so showModal() focuses it rather than the destructive button. */}
          <button
            ref={cancel}
            type="button"
            className="button button-secondary"
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button type="button" className="button button-danger" onClick={confirmPending}>
            {pending?.action === 'revoke' ? 'Yes, revoke' : 'Yes, regenerate'}
          </button>
        </div>
      </dialog>
    </main>
  )
}

/** Add a person (decision I1): name, colour (needed for an invite), role. */
function AddPerson({ people, onAdded }: { people: Person[]; onAdded: () => void }) {
  const [name, setName] = useState('')
  // No preselected colour: it's how people tell each other apart, so pick one on purpose.
  const [colour, setColour] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    const parsed = parseName(name, people, '')
    if ('error' in parsed) return setError(parsed.error)
    if (!HEX.test(colour)) return setError('Pick a colour.')
    setError(null)
    setBusy(true)
    try {
      await addPerson(parsed.name, colour, role)
      setNotice(`${parsed.name} added. Create their invite above.`)
      setName('')
      setColour('')
      onAdded()
      nameRef.current?.focus()
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
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-invalid={!!error}
          aria-describedby={error ? 'add-error' : undefined}
        />
      </label>
      <div className="field">
        <label htmlFor="add-colour">Colour</label>
        <span className="colour-choice">
          {/* A colour input always shows some colour: black until one is picked. */}
          <input
            id="add-colour"
            type="color"
            value={colour || '#000000'}
            onChange={(e) => setColour(e.target.value)}
            aria-describedby="add-colour-state"
          />
          <span id="add-colour-state" className={colour ? undefined : 'muted'}>
            {colour || 'Not chosen yet'}
          </span>
        </span>
      </div>
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
