import { StrictMode } from 'react'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { bootstrap } from './app/bootstrap'
import { AuthProvider } from './auth/AuthProvider'
import { DataProvider } from './data/DataProvider'
import './index.css'
import { routes } from './routes'

void bootstrap(document.getElementById('root')!, (root) => {
  const router = createBrowserRouter(routes)
  root.render(
    <StrictMode>
      <AuthProvider>
        <DataProvider>
          <RouterProvider router={router} />
        </DataProvider>
      </AuthProvider>
    </StrictMode>,
  )
})
