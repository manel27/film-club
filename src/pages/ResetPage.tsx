import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/authContext'
import ThemePicker from '../components/ThemePicker'
import { claimReset, previewInvite } from '../invites/api'
import { NO_TOKEN_MESSAGE, useLinkToken } from '../invites/useLinkToken'
import { linkErrorMessage, passwordProblem, PASSWORD_MIN } from '../invites/links'

/**
 * A reset link (#/reset/:token, decisions I2, I3): checked on load, then a new
 * password, which ends the person's other sessions and signs in here.
 */
export default function ResetPage() {
  const token = useLinkToken('/reset')
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let current = true
    previewInvite(token, 'reset').then(
      (p) => current && setName(p.name),
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
    let email: string
    try {
      email = await claimReset(token, password)
    } catch (e) {
      setBusy(false)
      return setError(linkErrorMessage(e))
    }
    const message = await signIn(email, password)
    setBusy(false)
    if (message) return setError(`Your password is changed, but logging in failed: ${message}`)
    navigate('/', { replace: true })
  }

  return (
    <main className="page page-narrow">
      <h1>Film Club</h1>
      {!token || loadError ? (
        <>
          <p role="alert" className="form-error">
            {token ? loadError : NO_TOKEN_MESSAGE}
          </p>
          <p>
            <Link to="/login">Go to the login page</Link>
          </p>
        </>
      ) : !name ? (
        <p role="status" className="muted">
          Checking your link…
        </p>
      ) : (
        <form className="card form" onSubmit={onSubmit}>
          <h2>Set a new password for {name}</h2>
          <p className="muted">This logs you out on your other devices.</p>
          <label className="field">
            <span>New password (at least {PASSWORD_MIN} characters)</span>
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
            <span>Confirm new password</span>
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
            {busy ? 'Saving…' : 'Save and log in'}
          </button>
        </form>
      )}
      <ThemePicker />
    </main>
  )
}
