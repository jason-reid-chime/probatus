import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const signupSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  company:   z.string().min(1, 'Company name is required'),
  email:     z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
})

type LoginFormValues  = z.infer<typeof loginSchema>
type SignupFormValues = z.infer<typeof signupSchema>

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [serverError, setServerError] = useState<string | null>(null)
  const [signupSuccess, setSignupSuccess] = useState(false)

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const signupForm = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { full_name: '', company: '', email: '', password: '' },
  })

  const onLogin = async (values: LoginFormValues) => {
    setServerError(null)
    try {
      await signIn(values.email, values.password)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        if (profileData?.role === 'customer') {
          navigate('/portal', { replace: true })
          return
        }
      }
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
    }
  }

  const onSignup = async (values: SignupFormValues) => {
    setServerError(null)
    try {
      // 1. Create auth user
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
      })
      if (signUpError) throw signUpError
      const user = data.user
      if (!user) throw new Error('Sign up failed — no user returned.')

      // 2. Create tenant + profile via SECURITY DEFINER function
      const slug = values.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      const { error: rpcError } = await supabase.rpc('create_account', {
        p_user_id:   user.id,
        p_full_name: values.full_name,
        p_company:   values.company,
        p_slug:      slug,
      })
      if (rpcError) throw rpcError

      setSignupSuccess(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : JSON.stringify(err))
      setServerError(msg || 'Sign up failed. Please try again.')
    }
  }

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next)
    setServerError(null)
    setSignupSuccess(false)
  }

  return (
    <div className="min-h-screen bg-brand-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black tracking-widest text-brand-700 select-none">PROBATUS</h1>
          <p className="mt-2 text-sm font-medium text-gray-500 uppercase tracking-wider">Calibration Management</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 px-8 py-10">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">
            {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
          </h2>

          {signupSuccess ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-4">
                <p className="text-sm font-semibold text-green-700">Account created!</p>
                <p className="text-sm text-green-600 mt-1">Check your email to confirm your address, then sign in.</p>
              </div>
              <button
                onClick={() => switchMode('login')}
                className="w-full rounded-xl bg-brand-500 text-white font-semibold text-base min-h-[48px] px-4 py-3 hover:bg-brand-600 transition-colors"
              >
                Go to sign in
              </button>
            </div>
          ) : mode === 'login' ? (
            <form onSubmit={loginForm.handleSubmit(onLogin)} noValidate className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                <input
                  type="email"
                  autoComplete="email"
                  {...loginForm.register('email')}
                  className={['w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[48px]',
                    loginForm.formState.errors.email ? 'border-red-400 bg-red-50' : 'border-gray-300'].join(' ')}
                  placeholder="you@example.com"
                />
                {loginForm.formState.errors.email && <p className="mt-1.5 text-sm text-red-600">{loginForm.formState.errors.email.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  {...loginForm.register('password')}
                  className={['w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[48px]',
                    loginForm.formState.errors.password ? 'border-red-400 bg-red-50' : 'border-gray-300'].join(' ')}
                  placeholder="••••••••"
                />
                {loginForm.formState.errors.password && <p className="mt-1.5 text-sm text-red-600">{loginForm.formState.errors.password.message}</p>}
              </div>
              {serverError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{serverError}</p></div>}
              <button
                type="submit"
                disabled={loginForm.formState.isSubmitting}
                className="w-full rounded-xl bg-brand-500 text-white font-semibold text-base min-h-[48px] px-4 py-3 mt-2 hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loginForm.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
              <p className="text-center text-sm text-gray-500 mt-2">
                Don't have an account?{' '}
                <button type="button" onClick={() => switchMode('signup')} className="text-brand-600 font-semibold hover:underline">Sign up</button>
              </p>
            </form>
          ) : (
            <form onSubmit={signupForm.handleSubmit(onSignup)} noValidate className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
                <input
                  type="text"
                  autoComplete="name"
                  {...signupForm.register('full_name')}
                  className={['w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[48px]',
                    signupForm.formState.errors.full_name ? 'border-red-400 bg-red-50' : 'border-gray-300'].join(' ')}
                  placeholder="Jason Reid"
                />
                {signupForm.formState.errors.full_name && <p className="mt-1.5 text-sm text-red-600">{signupForm.formState.errors.full_name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company name</label>
                <input
                  type="text"
                  autoComplete="organization"
                  {...signupForm.register('company')}
                  className={['w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[48px]',
                    signupForm.formState.errors.company ? 'border-red-400 bg-red-50' : 'border-gray-300'].join(' ')}
                  placeholder="Probatus Inc"
                />
                {signupForm.formState.errors.company && <p className="mt-1.5 text-sm text-red-600">{signupForm.formState.errors.company.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                <input
                  type="email"
                  autoComplete="email"
                  {...signupForm.register('email')}
                  className={['w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[48px]',
                    signupForm.formState.errors.email ? 'border-red-400 bg-red-50' : 'border-gray-300'].join(' ')}
                  placeholder="you@example.com"
                />
                {signupForm.formState.errors.email && <p className="mt-1.5 text-sm text-red-600">{signupForm.formState.errors.email.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...signupForm.register('password')}
                  className={['w-full rounded-xl border px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent min-h-[48px]',
                    signupForm.formState.errors.password ? 'border-red-400 bg-red-50' : 'border-gray-300'].join(' ')}
                  placeholder="••••••••"
                />
                {signupForm.formState.errors.password && <p className="mt-1.5 text-sm text-red-600">{signupForm.formState.errors.password.message}</p>}
              </div>
              {serverError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-700">{serverError}</p></div>}
              <button
                type="submit"
                disabled={signupForm.formState.isSubmitting}
                className="w-full rounded-xl bg-brand-500 text-white font-semibold text-base min-h-[48px] px-4 py-3 mt-2 hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {signupForm.formState.isSubmitting ? 'Creating account…' : 'Create account'}
              </button>
              <p className="text-center text-sm text-gray-500 mt-2">
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="text-brand-600 font-semibold hover:underline">Sign in</button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
