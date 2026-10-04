import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NotFound from './NotFound'

describe('NotFound', () => {
  it('renders a 404 message with a link back to the dashboard', () => {
    render(<MemoryRouter><NotFound /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /back to dashboard/i }).getAttribute('href')).toBe('/')
  })
})
