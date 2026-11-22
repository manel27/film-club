import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import ThemePicker from '../components/ThemePicker'
import { claimInvite, previewInvite, type InvitePreview } from '../invites/api'
import { linkErrorMessage, passwordProblem, PASSWORD_MIN, watchedLine } from '../invites/links'
import { textOn } from '../lib/colour'

/**
 * An invite link (#/invite/:token, plan 7): who it's for, then email and
 * password to create the login, which signs in and opens the app.
 */
export default function InvitePage() {
  const { token = '' } = useParams()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    previewInvite(token).then(
      (p) => current && setPreview(p),
      (e) => current && setLoadError(linkErrorMessage(e)),
    )
    return () => {
      current = false
    }
  }, [token])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = passwordProblem(password, confirm)
    if (problem) return setError(problem)
    setError(null)
    setBusy(true)
    try {
      await claimInvite(token, email.trim(), password)
    } catch (e) {
      setBusy(false)
      return setError(linkErrorMessage(e))
    }
    const message = await signIn(email.trim(), password)
    setBusy(false)
    if (message) return setError(`Your account is ready, but logging in failed: ${message}`)
    navigate('/', { replace: true })
  }

  return (
    <main className="page page-narrow">
      <h1>Film Club</h1>
      {loadError ? (
        <>
          <p role="alert" className="form-error">
            {loadError}
          </p>
          <p>
            <Link to="/login">Go to the login page</Link>
          </p>
        </>
      ) : !preview ? (
        <p role="status" className="muted">
          Checking your invite…
        </p>
      ) : (
        <form className="card form" onSubmit={onSubmit}>
          <h2>
            Welcome,{' '}
            <span
              className="chip"
              style={{ backgroundColor: preview.colour, color: textOn(preview.colour) }}
            >
              {preview.name}
            </span>
          </h2>
          <p className="muted">{watchedLine(preview.watched)}</p>
          <p>Choose the email and password you'll log in with.</p>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password (at least {PASSWORD_MIN} characters)</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Creating your account…' : 'Create account'}
          </button>
        </form>
      )}
      <ThemePicker />
    </main>
  )
}
