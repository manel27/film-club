import { useNavigate } from 'react-router'
import { useAuth } from '../auth/authContext'

/** Logged in, but loading the profile failed (offline, server error). */
export default function ProfileErrorPage() {
  const { reloadProfile, signOut } = useAuth()
  const navigate = useNavigate()

  async function logOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <main className="page">
      <h1>Couldn't load your profile</h1>
      <p role="alert">Check your connection and try again.</p>
      <p className="actions">
        <button type="button" className="button" onClick={reloadProfile}>
          Try again
        </button>
        <button type="button" className="button button-secondary" onClick={logOut}>
          Log out
        </button>
      </p>
    </main>
  )
}
