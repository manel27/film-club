import { useEffect, useRef, useState, type FormEvent } from 'react'
import { exportZip } from '../admin/export'
import { announceExport, exportDate, useLastExport } from '../admin/lastExport'
import { useAuth } from '../auth/authContext'
import Chip from '../components/Chip'
import ColourField, { HEX } from '../components/ColourField'
import { errorMessage } from '../films/filmDetail'
import type { Person } from '../films/films'
import {
  addPerson,
  createLink,
  fetchAdminPeople,
  fetchExport,
  removeLogin,
  revokeLink,
  saveLastExport,
  updatePerson,
  type AdminPerson,
} from '../invites/api'
import {
  adminLinkErrorMessage,
  linkLabel,
  removeLoginErrorMessage,
  type OpenLink,
} from '../invites/links'
import { parseName, personSaveError, renameError, ROLE_NAMES } from '../people/profile'
import NotFoundPage from './NotFoundPage'

type Role = NonNullable<Person['role']>
const ROLES: Role[] = ['member', 'moderator', 'admin', 'viewer']
/** The id of a person's create / regenerate button: focus comes back to it. */
const buttonId = (p: Person) => `link-button-${p.id}`
const editId = (p: Person) => `edit-button-${p.id}`

/** A destructive action waiting for the admin's yes. */
type Pending =
  /** Kills a link that may have been sent. */
  | { person: AdminPerson; link: OpenLink; action: 'regenerate' | 'revoke' }
  /** Deletes their login (decision A2). */
  | { person: AdminPerson; action: 'remove' }

/**
 * Admin (#/admin, plan 9; decisions I1, A1–A3): everyone with their login
 * status and open link; add, edit (name, colour, role) and remove a login;
 * create / regenerate / revoke invite and reset links (a new link is shown
 * once, right after it is made); export all data.
 */
export default function AdminPage() {
  const { profile } = useAuth()
  const [data, setData] = useState<{ people: AdminPerson[]; links: OpenLink[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [fresh, setFresh] = useState<{
    person: AdminPerson
    kind: OpenLink['kind']
    link: string
  } | null>(null)
  const [copied, setCopied] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [editing, setEditing] = useState<AdminPerson | null>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const editDialog = useRef<HTMLDialogElement>(null)
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
    setNotice('')
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
    if (pending.action === 'remove') {
      const { person } = pending
      act(
        person,
        async () => {
          await removeLogin(person.id)
          setNotice(`${person.name}'s login was removed. Their history stays.`)
        },
        removeLoginErrorMessage,
      )
    } else if (pending.action === 'regenerate') create(pending.person, pending.link.kind)
    else act(pending.person, () => revokeLink(pending.link.id), errorMessage)
  }

  function edit(person: AdminPerson) {
    setEditing(person)
    editDialog.current?.showModal()
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
      <p role="status">{notice}</p>
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
                      <td data-label="Login">{p.isClaimed ? 'Has a login' : 'No login'}</td>
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
                          <button
                            id={editId(p)}
                            type="button"
                            className="button button-secondary button-small"
                            disabled={busy}
                            aria-label={`Edit ${p.name}`}
                            onClick={() => edit(p)}
                          >
                            Edit
                          </button>
                          {p.isClaimed && p.id !== profile.id && (
                            <button
                              type="button"
                              className="button button-danger button-small"
                              disabled={busy}
                              aria-label={`Remove login for ${p.name}`}
                              onClick={() => ask({ person: p, action: 'remove' })}
                            >
                              Remove login
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
      <h2>Data</h2>
      <ExportData />
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="confirm-link-heading"
        onClose={() => setPending(null)}
      >
        {pending?.action === 'remove' ? (
          <>
            <h2 id="confirm-link-heading">Remove {pending.person.name}'s login?</h2>
            <p>
              They are logged out everywhere and can't log in any more. Their films, scores,
              attendance and comments stay, and you can invite them again later.
              {pending.person.role === 'admin' || pending.person.role === 'moderator'
                ? ` They become a member: if they come back, give them their ${ROLE_NAMES[pending.person.role].toLowerCase()} role again.`
                : ''}
            </p>
          </>
        ) : (
          pending && (
            <>
              <h2 id="confirm-link-heading">
                {pending.action === 'revoke' ? 'Revoke' : 'Regenerate'} the{' '}
                {pending.link.kind === 'invite' ? 'invite' : 'reset link'} for {pending.person.name}
                ?
              </h2>
              <p>
                The link already made stops working, even if it was sent.
                {pending.action === 'regenerate' && ' A new one is made to send instead.'}
              </p>
            </>
          )
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
            {pending?.action === 'revoke'
              ? 'Yes, revoke'
              : pending?.action === 'remove'
                ? 'Yes, remove login'
                : 'Yes, regenerate'}
          </button>
        </div>
      </dialog>
      <dialog
        ref={editDialog}
        className="confirm-dialog"
        aria-labelledby="edit-heading"
        onClose={() => {
          if (editing) document.getElementById(editId(editing))?.focus()
          setEditing(null)
        }}
      >
        {editing && data && (
          <EditPerson
            key={editing.id}
            person={editing}
            people={data.people}
            isMe={editing.id === profile.id}
            onClose={() => editDialog.current?.close()}
            onSaved={() => {
              setNotice(`Saved ${editing.name}.`)
              focusNext.current = editId(editing)
              editDialog.current?.close()
              reload()
            }}
          />
        )}
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
    if (!colour) return setError('Pick a colour.')
    if (!HEX.test(colour)) return setError('Use a hex colour like #4a86e8.')
    setError(null)
    setBusy(true)
    try {
      await addPerson(parsed.name, colour.toLowerCase(), role)
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
      <ColourField id="add-colour" value={colour} onChange={setColour} people={people} />
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

/**
 * Edit someone's name, colour and role (plan 5: admin only). The database
 * guard has the last word: an admin can't change their own role and the club
 * always keeps an admin.
 */
function EditPerson({
  person,
  people,
  isMe,
  onClose,
  onSaved,
}: {
  person: AdminPerson
  people: Person[]
  isMe: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(person.name)
  const [colour, setColour] = useState(person.colour ?? '')
  const [role, setRole] = useState<Role>(person.role ?? 'member')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseName(name, people, person.id)
    if ('error' in parsed) return setError(parsed.error)
    // No colour is fine only for someone who never had one.
    if (colour ? !HEX.test(colour) : person.colour) {
      return setError('Use a hex colour like #4a86e8.')
    }
    setError(null)
    setBusy(true)
    try {
      await updatePerson(person.id, {
        display_name: parsed.name,
        colour: colour ? colour.toLowerCase() : null,
        role,
      })
      onSaved()
    } catch (e) {
      setError(personSaveError(e))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="rotation-form">
      <h2 id="edit-heading">Edit {person.name}</h2>
      <label className="field">
        Name
        <input
          // The dialog opens on the field the admin most likely came to change.
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          aria-invalid={!!error}
          aria-describedby={error ? 'edit-error' : undefined}
        />
      </label>
      <ColourField
        id="edit-colour"
        value={colour}
        onChange={setColour}
        people={people}
        exceptId={person.id}
      />
      <label className="field">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={isMe}
          aria-describedby={isMe ? 'edit-role-why' : undefined}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_NAMES[r]}
            </option>
          ))}
        </select>
      </label>
      {isMe && (
        <p id="edit-role-why" className="muted">
          You can't change your own role, so the club never loses its admin by accident.
        </p>
      )}
      {error && (
        <p id="edit-error" role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="button button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

/** Export all data (decision A1): one zip with the complete JSON and a CSV per table. */
function ExportData() {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const last = useLastExport(true)

  async function download() {
    setBusy(true)
    setError(null)
    setStatus('')
    setUnsaved(false)
    try {
      const { name, blob } = exportZip(await fetchExport())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      // Not at once: Safari may still be starting the download.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setStatus(`Downloaded ${name}.`)
      // The download is what counts; the date only feeds the 30-day reminder.
      const at = new Date().toISOString()
      announceExport(at)
      await saveLastExport(at).catch(() => setUnsaved(true))
    } catch (e) {
      setError(
        (e as { code?: string } | null)?.code === '42501'
          ? 'Only the admin can export the data.'
          : "Couldn't export the data. Check your connection and try again.",
      )
    }
    setBusy(false)
  }

  return (
    <section className="rotation-form" aria-labelledby="export-heading">
      <h3 id="export-heading">Export all data</h3>
      <p>
        One zip file: a complete JSON file with everything needed to rebuild the club's data, and a
        CSV of each table for spreadsheets. No emails or passwords are included. Keep a copy
        somewhere safe every month.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p role="status">
        {status}
        {unsaved && " Couldn't save the export date, so the reminder may come back."}
      </p>
      <button type="button" className="button" disabled={busy} onClick={download}>
        {busy ? 'Exporting…' : 'Export all data'}
      </button>{' '}
      {last && (
        <span className="muted">Last export: {last.at ? exportDate(last.at) : 'never'}</span>
      )}
    </section>
  )
}
