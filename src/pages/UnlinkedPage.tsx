import { useNavigate } from 'react-router'
import { useAuth } from '../auth/authContext'

/** Logged in, but the login isn't linked to a club profile (yet). */
export default function UnlinkedPage() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()

  async function logOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <main className="page">
      <h1>Your account isn't linked yet</h1>
      <p>
        You're logged in{session?.user.email ? ` as ${session.user.email}` : ''}, but this login
        isn't connected to a Film Club profile. Ask Manel to link it.
      </p>
      <p>
        <button type="button" className="button" onClick={logOut}>
          Log out
        </button>
      </p>
    </main>
  )
}
