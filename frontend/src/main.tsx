import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { startConnectivityMonitor } from './lib/sync/connectivity'

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // "production" | "development"
    // Capture 100% of transactions in dev, 10% in production
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // Don't send events in local development unless DSN is explicitly set
    enabled: import.meta.env.PROD || !!dsn,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
  })
}

startConnectivityMonitor()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
