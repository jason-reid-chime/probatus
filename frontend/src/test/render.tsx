import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/** Render inside a fresh QueryClient and a router at `path` (matched by `route`). */
export function renderPage(ui: ReactElement, { path = '/', route = '*' }: { path?: string; route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={ui} />
            <Route path="*" element={<div data-testid="navigated" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}
