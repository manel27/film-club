import type { RouteObject } from 'react-router'
import RequireAuth from './auth/RequireAuth'
import AppShell from './components/AppShell'
import FilmFormPage from './pages/FilmFormPage'
import FilmPage from './pages/FilmPage'
import FilmsPage from './pages/FilmsPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PeoplePage from './pages/PeoplePage'
import ProfilePage from './pages/ProfilePage'
import RotationPage from './pages/RotationPage'

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
      { path: '/films/new', element: <FilmFormPage /> },
      { path: '/films/:id', element: <FilmPage /> },
      { path: '/films/:id/edit', element: <FilmFormPage /> },
      { path: '/rotation', element: <RotationPage /> },
      { path: '/people', element: <PeoplePage /> },
      { path: '/people/:id', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
