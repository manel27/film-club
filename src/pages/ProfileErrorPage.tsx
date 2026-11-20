import { useAuth } from '../auth/authContext'
import { useLogOut } from '../auth/useLogOut'

/** Logged in, but loading the profile failed (offline, server error). */
export default function ProfileErrorPage() {
  const { reloadProfile } = useAuth()
  const { logOut, busy } = useLogOut()

  return (
    <main className="page">
      <h1>Couldn't load your profile</h1>
      <p role="alert">Check your connection and try again.</p>
      <p className="actions">
        <button type="button" className="button" onClick={reloadProfile}>
          Try again
        </button>
        <button type="button" className="button button-secondary" onClick={logOut} disabled={busy}>
          Log out
        </button>
      </p>
    </main>
  )
}
