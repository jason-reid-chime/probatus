import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

interface FormValues {
  name: string
  address: string
  contact: string
}

const emptyForm: FormValues = { name: '', address: '', contact: '' }

export default function CustomerForm() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()

  const isEdit = Boolean(id)

  const [values, setValues] = useState<FormValues>(emptyForm)
  const [loading, setLoading] = useState(isEdit)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  // Load existing customer when editing
  useEffect(() => {
    if (!id) return
    supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!error && data) {
          setValues({
            name: data.name ?? '',
            address: data.address ?? '',
            contact: data.contact ?? '',
          })
        }
        setLoading(false)
      })
  }, [id])

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setValues((prev) => ({ ...prev, [name]: value }))
    if (name === 'name' && nameError) setNameError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    if (!values.name.trim()) {
      setNameError('Name is required')
      return
    }

    if (!profile?.tenant_id) return

    setSubmitting(true)

    const record = {
      id: id ?? crypto.randomUUID(),
      tenant_id: profile.tenant_id,
      name: values.name.trim(),
      address: values.address.trim() || null,
      contact: values.contact.trim() || null,
    }

    const { error } = await supabase.from('customers').upsert(record)

    if (error) {
      setSubmitError(error.message)
      setSubmitting(false)
      return
    }

    navigate('/customers')
  }

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-base'

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-gray-400 hover:text-gray-700 rounded-lg transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">
          {isEdit ? 'Edit Customer' : 'New Customer'}
        </h1>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Customer Details
            </h2>

            {/* Name */}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={values.name}
                onChange={handleChange}
                className={inputClass}
                placeholder="Acme Industries"
                autoFocus
              />
              {nameError && (
                <p className="text-sm text-red-600">{nameError}</p>
              )}
            </div>

            {/* Address */}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Address
              </label>
              <textarea
                name="address"
                value={values.address}
                onChange={handleChange}
                rows={3}
                className={`${inputClass} resize-none`}
                placeholder="123 Main St, Springfield, ON"
              />
            </div>

            {/* Contact */}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Contact
              </label>
              <input
                type="text"
                name="contact"
                value={values.contact}
                onChange={handleChange}
                className={inputClass}
                placeholder="Jane Smith — jane@acme.com — 555-0100"
              />
              <p className="text-xs text-gray-400">
                Phone, email, or contact person — any format
              </p>
            </div>
          </div>

          {/* Submit error */}
          {submitError && (
            <p className="text-sm text-red-600">
              {submitError}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 border border-gray-300 text-gray-700 font-semibold py-3 rounded-xl transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
