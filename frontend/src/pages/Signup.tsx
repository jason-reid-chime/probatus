import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '../lib/supabase'

// ── Schemas ──────────────────────────────────────────────────────────────────

const joinSchema = z.object({
  full_name:    z.string().min(1, 'Full name is required'),
  email:        z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password:     z.string().min(8, 'Password must be at least 8 characters'),
  company_code: z.string().min(1, 'Company code is required'),
})

const createSchema = z.object({
  full_name:    z.string().min(1, 'Full name is required'),
  email:        z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password:     z.string().min(8, 'Password must be at least 8 characters'),
  company_name: z.string().min(1, 'Company name is required'),
})

type JoinFormValues   = z.infer<typeof joinSchema>
type CreateFormValues = z.infer<typeof createSchema>

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return JSON.stringify(err)
}

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('already registered') || lower.includes('user already exists') || lower.includes('email already')) {
    return 'An account with this email already exists. Try signing in.'
  }
  if (lower.includes('tenant not found') || lower.includes('invalid company code') || lower.includes('not found')) {
    return 'Company code not found. Ask your administrator for the correct code.'
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return 'Something went wrong. Please try again.'
  }
  return raw || 'Something went wrong. Please try again.'
}

// ── Shared field component ────────────────────────────────────────────────────

interface FieldProps {
  label: string
  error?: string
  children: React.ReactNode
}

function Field({ label, error, children }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  )
}

const inputClass = (hasError: boolean) =>
  [
    'w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[48px]',
    hasError ? 'border-red-400 bg-red-50' : 'border-gray-300',
  ].join(' ')

// ── Main component ────────────────────────────────────────────────────────────

type SignupMode = 'join' | 'create'

export default function Signup() {
  const navigate = useNavigate()
  const [mode, setMode]             = useState<SignupMode>('join')
  const [serverError, setServerError] = useState<string | null>(null)
  const [success, setSuccess]       = useState<'join' | 'create' | null>(null)

  const joinForm = useForm<JoinFormValues>({
    resolver: zodResolver(joinSchema),
    defaultValues: { full_name: '', email: '', password: '', company_code: '' },
  })

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { full_name: '', email: '', password: '', company_name: '' },
  })

  const switchMode = (next: SignupMode) => {
    setMode(next)
    setServerError(null)
  }

  // ── Join existing company ─────────────────────────────────────────────────

  const onJoin = async (values: JoinFormValues) => {
    setServerError(null)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email:    values.email,
        password: values.password,
        options:  { data: { full_name: values.full_name } },
      })
      if (signUpError) throw signUpError
      if (!data.user) throw new Error('Sign up failed — no user returned.')

      const { error: rpcError } = await supabase.rpc('create_account', {
        p_full_name:   values.full_name,
        p_tenant_code: values.company_code,
      })
      if (rpcError) throw rpcError

      setSuccess('join')
    } catch (err: unknown) {
      setServerError(friendlyError(extractMessage(err)))
    }
  }

  // ── Create new company ────────────────────────────────────────────────────

  const onCreate = async (values: CreateFormValues) => {
    setServerError(null)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email:    values.email,
        password: values.password,
        options:  { data: { full_name: values.full_name } },
      })
      if (signUpError) throw signUpError
      if (!data.user) throw new Error('Sign up failed — no user returned.')

      const { error: rpcError } = await supabase.rpc('create_account', {
        p_full_name:   values.full_name,
        p_company_name: values.company_name,
      })
      if (rpcError) throw rpcError

      setSuccess('create')
    } catch (err: unknown) {
      setServerError(friendlyError(extractMessage(err)))
    }
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="min-h-screen bg-brand-50 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-black tracking-widest text-brand-700 select-none">PROBATUS</h1>
            <p className="mt-2 text-sm font-medium text-gray-500 uppercase tracking-wider">Calibration Management</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 px-8 py-10 space-y-4">
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-4">
              <p className="text-sm font-semibold text-green-700">Account created!</p>
              <p className="text-sm text-green-600 mt-1">
                {success === 'create'
                  ? "Check your email to confirm your account. You've been set up as admin."
                  : 'Check your email to confirm your account.'}
              </p>
            </div>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="w-full rounded-xl bg-brand-500 text-white font-semibold text-base min-h-[48px] px-4 py-3 hover:bg-brand-600 transition-colors"
            >
              Go to sign in
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────

  const isJoin   = mode === 'join'
  const isSubmitting = isJoin
    ? joinForm.formState.isSubmitting
    : createForm.formState.isSubmitting

  return (
    <div className="min-h-screen bg-brand-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black tracking-widest text-brand-700 select-none">PROBATUS</h1>
          <p className="mt-2 text-sm font-medium text-gray-500 uppercase tracking-wider">Calibration Management</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 px-8 py-10">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Create your account</h2>

          {/* Mode toggle */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-6">
            <button
              type="button"
              onClick={() => switchMode('join')}
              className={[
                'flex-1 py-2.5 text-sm font-semibold transition-colors',
                isJoin
                  ? 'bg-brand-500 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50',
              ].join(' ')}
            >
              Join a company
            </button>
            <button
              type="button"
              onClick={() => switchMode('create')}
              className={[
                'flex-1 py-2.5 text-sm font-semibold transition-colors',
                !isJoin
                  ? 'bg-brand-500 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50',
              ].join(' ')}
            >
              Start a new company
            </button>
          </div>

          {/* ── Join existing company ── */}
          {isJoin ? (
            <form onSubmit={joinForm.handleSubmit(onJoin)} noValidate className="space-y-5">
              <Field label="Full name" error={joinForm.formState.errors.full_name?.message}>
                <input
                  type="text"
                  autoComplete="name"
                  {...joinForm.register('full_name')}
                  className={inputClass(!!joinForm.formState.errors.full_name)}
                  placeholder="Jason Reid"
                />
              </Field>

              <Field label="Email address" error={joinForm.formState.errors.email?.message}>
                <input
                  type="email"
                  autoComplete="email"
                  {...joinForm.register('email')}
                  className={inputClass(!!joinForm.formState.errors.email)}
                  placeholder="you@example.com"
                />
              </Field>

              <Field label="Password" error={joinForm.formState.errors.password?.message}>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...joinForm.register('password')}
                  className={inputClass(!!joinForm.formState.errors.password)}
                  placeholder="••••••••"
                />
              </Field>

              <Field label="Company code" error={joinForm.formState.errors.company_code?.message}>
                <input
                  type="text"
                  autoComplete="off"
                  {...joinForm.register('company_code')}
                  className={inputClass(!!joinForm.formState.errors.company_code)}
                  placeholder="e.g. ACME-4821"
                />
                <p className="mt-1 text-xs text-gray-400">Ask your administrator for this code.</p>
              </Field>

              {serverError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm text-red-700">{serverError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-brand-500 text-white font-semibold text-base min-h-[48px] px-4 py-3 mt-2 hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Creating account…' : 'Join company'}
              </button>
            </form>
          ) : (
          /* ── Create new company ── */
            <form onSubmit={createForm.handleSubmit(onCreate)} noValidate className="space-y-5">
              <Field label="Full name" error={createForm.formState.errors.full_name?.message}>
                <input
                  type="text"
                  autoComplete="name"
                  {...createForm.register('full_name')}
                  className={inputClass(!!createForm.formState.errors.full_name)}
                  placeholder="Jason Reid"
                />
              </Field>

              <Field label="Email address" error={createForm.formState.errors.email?.message}>
                <input
                  type="email"
                  autoComplete="email"
                  {...createForm.register('email')}
                  className={inputClass(!!createForm.formState.errors.email)}
                  placeholder="you@example.com"
                />
              </Field>

              <Field label="Password" error={createForm.formState.errors.password?.message}>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...createForm.register('password')}
                  className={inputClass(!!createForm.formState.errors.password)}
                  placeholder="••••••••"
                />
              </Field>

              <Field label="Company name" error={createForm.formState.errors.company_name?.message}>
                <input
                  type="text"
                  autoComplete="organization"
                  {...createForm.register('company_name')}
                  className={inputClass(!!createForm.formState.errors.company_name)}
                  placeholder="Sheridan Automation"
                />
              </Field>

              {serverError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm text-red-700">{serverError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-brand-500 text-white font-semibold text-base min-h-[48px] px-4 py-3 mt-2 hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Creating account…' : 'Create company & account'}
              </button>
            </form>
          )}

          {/* Sign in link */}
          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 font-semibold hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
