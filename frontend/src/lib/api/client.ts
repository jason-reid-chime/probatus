// Central API URL — falls back to localhost for local dev if env var is missing.
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8080'
