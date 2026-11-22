import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import ThemePicker from '../components/ThemePicker'
import { claimReset } from '../invites/api'
import { linkErrorMessage, passwordProblem, PASSWORD_MIN } from '../invites/links'

/** A reset link (#/reset/:token, decision I2): a new password, then signed in. */
export default function ResetPage() {
  const { token = '' } = useParams()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      <form className="card form" onSubmit={onSubmit}>
        <h2>Set a new password</h2>
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
      <ThemePicker />
    </main>
  )
}
