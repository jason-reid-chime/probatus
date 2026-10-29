import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const net = vi.hoisted(() => ({ online: true }))
const sb = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }))

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../hooks/useCustomerFilter', () => ({ useCustomerFilter: vi.fn() }))
vi.mock('../../lib/sync/connectivity', () => ({
  isOnline: () => net.online,
  toggleForcedOffline: vi.fn(() => { net.online = !net.online }),
}))
vi.mock('../../lib/supabase', () => {
  sb.eq.mockResolvedValue({ error: null })
  sb.update.mockReturnValue({ eq: sb.eq })
  return { supabase: { from: vi.fn(() => ({ update: sb.update })) } }
})

import Sidebar from './Sidebar'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerFilter } from '../../hooks/useCustomerFilter'
import { toggleForcedOffline } from '../../lib/sync/connectivity'
import { supabase } from '../../lib/supabase'

const signOut = vi.fn()
const refreshProfile = vi.fn()
const setSelectedCustomerId = vi.fn()

function setup(profile: Record<string, unknown> | null, customers: { id: string; name: string }[] = [], selected: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({ profile, signOut, refreshProfile } as never)
  vi.mocked(useCustomerFilter).mockReturnValue({ customers, selectedCustomerId: selected, setSelectedCustomerId })
}

function renderSidebar(onClose?: () => void, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><Sidebar onClose={onClose} /></MemoryRouter>)
}

const links = () => screen.getAllByRole('link').map((a) => a.textContent?.trim())

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    net.online = true
    sb.eq.mockResolvedValue({ error: null })
    sb.update.mockReturnValue({ eq: sb.eq })
  })

  it('shows technicians only field work and tools', () => {
    setup({ id: 'u1', full_name: 'Tom Tech', role: 'technician', roles: ['technician'] })
    renderSidebar()
    expect(links()).toEqual(['PROBATUS', 'Dashboard', 'Work Orders', 'Calibrations', 'Batch Session', 'Assets', 'Calendar'])
    expect(screen.queryByText('Management')).toBeNull()
    expect(screen.queryByText('Business')).toBeNull()
    expect(screen.getByText('Technician')).toBeTruthy()
  })

  it.each(['supervisor', 'admin'])('shows %s the management and business sections including Billing', (role) => {
    setup({ id: 'u1', full_name: 'Sue', role, roles: [role] })
    renderSidebar()
    expect(screen.getByText('Management')).toBeTruthy()
    expect(screen.getByText('Business')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Billing' }).getAttribute('href')).toBe('/settings/billing')
    expect(screen.getByRole('link', { name: 'Due Alerts' }).getAttribute('href')).toBe('/settings/alerts')
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeTruthy()
  })

  it('hides role-restricted sections when signed out', () => {
    setup(null)
    renderSidebar()
    expect(links()).not.toContain('Billing')
    expect(links()).not.toContain('Approvals')
    expect(links()).toContain('Dashboard')
  })

  it('highlights the active link, matching the dashboard exactly', () => {
    setup({ id: 'u1', full_name: 'Sue', role: 'admin', roles: ['admin'] })
    renderSidebar(undefined, '/settings/billing')
    expect(screen.getByRole('link', { name: 'Billing' }).className).toContain('bg-brand-50')
    expect(screen.getByRole('link', { name: 'Dashboard' }).className).not.toContain('bg-brand-50')
  })

  it('closes on navigation and via the close button', async () => {
    setup({ id: 'u1', full_name: 'Sue', role: 'admin', roles: ['admin'] })
    const onClose = vi.fn()
    renderSidebar(onClose)
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    await userEvent.click(screen.getByRole('link', { name: 'Assets' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('has no close button without onClose', () => {
    setup({ id: 'u1', full_name: 'Sue', role: 'admin', roles: ['admin'] })
    renderSidebar()
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull()
  })

  it('filters by client', () => {
    setup({ id: 'u1', full_name: 'Sue', role: 'admin', roles: ['admin'] }, [{ id: 'c1', name: 'City Water' }, { id: 'c2', name: 'Mill Co' }], 'c1')
    renderSidebar()
    const select = screen.getByLabelText('Client') as HTMLSelectElement
    expect(select.value).toBe('c1')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All Clients', 'City Water', 'Mill Co'])
    fireEvent.change(select, { target: { value: 'c2' } })
    expect(setSelectedCustomerId).toHaveBeenLastCalledWith('c2')
    fireEvent.change(select, { target: { value: '' } })
    expect(setSelectedCustomerId).toHaveBeenLastCalledWith(null)
  })

  it('hides the client filter when there are no customers', () => {
    setup({ id: 'u1', full_name: 'Sue', role: 'admin', roles: ['admin'] })
    renderSidebar()
    expect(screen.queryByLabelText('Client')).toBeNull()
  })

  it('lets a multi-role user switch role and refreshes the profile', async () => {
    setup({ id: 'u1', full_name: 'Sue', role: 'technician', roles: ['technician', 'supervisor'] })
    renderSidebar()
    const roleSelect = screen.getByDisplayValue('Technician')
    fireEvent.change(roleSelect, { target: { value: 'technician' } })
    expect(supabase.from).not.toHaveBeenCalled()

    fireEvent.change(roleSelect, { target: { value: 'supervisor' } })
    await vi.waitFor(() => expect(refreshProfile).toHaveBeenCalled())
    expect(supabase.from).toHaveBeenCalledWith('profiles')
    expect(sb.update).toHaveBeenCalledWith({ role: 'supervisor' })
    expect(sb.eq).toHaveBeenCalledWith('id', 'u1')
  })

  it('toggles simulated offline mode and follows browser connectivity events', async () => {
    setup({ id: 'u1', full_name: 'Sue', role: 'admin', roles: ['admin'] })
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Online' }))
    expect(toggleForcedOffline).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Offline (simulated)' })).toBeTruthy()

    net.online = true
    fireEvent(window, new Event('online'))
    expect(await screen.findByRole('button', { name: 'Online' })).toBeTruthy()
  })

  it('signs out', async () => {
    setup({ id: 'u1', full_name: 'Sue', role: 'admin', roles: ['admin'] })
    renderSidebar()
    expect(screen.getByText('Sue')).toBeTruthy()
    expect(screen.getByText('Admin')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })
})
