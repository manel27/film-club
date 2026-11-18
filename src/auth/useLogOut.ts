import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from './authContext'

/**
 * Logs out and always ends up on the login page. If the server couldn't be
 * told, the login page shows that (AuthState.notice).
 */
export function useLogOut() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const logOut = useCallback(async () => {
    setBusy(true)
    try {
      await signOut()
    } finally {
      setBusy(false)
      navigate('/login', { replace: true })
    }
  }, [signOut, navigate])

  return { logOut, busy }
}
