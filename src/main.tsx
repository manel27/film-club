import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { supabaseAuthBackend } from './auth/backend'
import './index.css'
import { supabase } from './lib/supabase'
import { routes } from './routes'

// Hash routing: GitHub Pages only ever serves index.html, so deep links such as
// /film-club/#/films/12 keep working on refresh.
const router = createHashRouter(routes)
const authBackend = supabaseAuthBackend(supabase)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider backend={authBackend}>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
