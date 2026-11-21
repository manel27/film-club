import type { RouteObject } from 'react-router'
import RequireAuth from './auth/RequireAuth'
import AppShell from './components/AppShell'
import FilmsPage from './pages/FilmsPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'

// Everything except the login page needs a session (RequireAuth).
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <FilmsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
