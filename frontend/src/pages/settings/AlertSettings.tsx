import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Loader2, Send } from 'lucide-react'
import {
  type AlertSettings as Settings,
  describeKind,
  getAlertHistory,
  getAlertSettings,
  runAlertsNow,
  saveAlertSettings,
} from '../../lib/api/notifications'

const LEAD_OPTIONS = [90, 60, 30, 14, 7, 1]

export default function AlertSettings() {
  const settings = useQuery({ queryKey: ['alert-settings'], queryFn: getAlertSettings })
  if (settings.isLoading || !settings.data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        {settings.error
          ? <p role="alert" className="text-sm text-red-600">{(settings.error as Error).message}</p>
          : <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />}
      </div>
    )
  }
  return <AlertSettingsForm initial={settings.data} />
}

function AlertSettingsForm({ initial }: { initial: Settings }) {
  const qc = useQueryClient()
  const history = useQuery({ queryKey: ['alert-history'], queryFn: getAlertHistory })
  const [form, setForm] = useState<Settings>(initial)
  const [savedEnabled, setSavedEnabled] = useState(initial.enabled)
  const [recipientsText, setRecipientsText] = useState(initial.internal_recipients.join(', '))
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: (s: Settings) => saveAlertSettings(s),
    onSuccess: (s) => {
      qc.setQueryData(['alert-settings'], s)
      setForm(s)
      setSavedEnabled(s.enabled)
      setRecipientsText(s.internal_recipients.join(', '))
      setSaved(true)
    },
  })
  const run = useMutation({
    mutationFn: runAlertsNow,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-history'] }),
  })

  const update = (patch: Partial<Settings>) => { setSaved(false); setForm({ ...form, ...patch }) }
  const toggleLead = (d: number) =>
    update({ lead_days: form.lead_days.includes(d) ? form.lead_days.filter((x) => x !== d) : [...form.lead_days, d] })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    save.mutate({
      ...form,
      internal_recipients: recipientsText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Due-date alerts</h1>
        <p className="text-sm text-gray-500 mt-1">Email a digest of instruments coming due or overdue, so nothing slips before an audit. Checked every hour.</p>
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-5 space-y-5">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={form.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="h-5 w-5 rounded border-gray-300" />
          <span className="font-semibold text-gray-900">Send automatic alerts</span>
        </label>

        <fieldset>
          <legend className="text-sm font-semibold text-gray-700">Remind me before the due date</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {LEAD_OPTIONS.map((d) => (
              <label key={d} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${form.lead_days.includes(d) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600'}`}>
                <input type="checkbox" className="sr-only" checked={form.lead_days.includes(d)} onChange={() => toggleLead(d)} />
                {d === 1 ? '1 day' : `${d} days`}
              </label>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.notify_overdue} onChange={(e) => update({ notify_overdue: e.target.checked })} className="rounded border-gray-300" />
            Also alert once an instrument is overdue
          </label>
        </fieldset>

        <div>
          <label htmlFor="alert-recipients" className="text-sm font-semibold text-gray-700">Staff recipients</label>
          <p className="text-xs text-gray-500">Get every instrument. Separate addresses with commas.</p>
          <textarea
            id="alert-recipients"
            rows={2}
            value={recipientsText}
            onChange={(e) => { setSaved(false); setRecipientsText(e.target.value) }}
            placeholder="quality@yourcompany.com, lead.tech@yourcompany.com"
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.notify_customers} onChange={(e) => update({ notify_customers: e.target.checked })} className="mt-0.5 rounded border-gray-300" />
          <span>Email customers about their own instruments <span className="block text-xs text-gray-500">Uses each customer’s contact email.</span></span>
        </label>

        {save.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(save.error as Error).message}</p>}
        {saved && <p role="status" className="text-sm text-green-700">Saved.</p>}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {save.isPending && <Loader2 size={16} className="animate-spin" aria-hidden />} Save settings
          </button>
          <button type="button" onClick={() => run.mutate()} disabled={run.isPending || !savedEnabled} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {run.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />} Send due alerts now
          </button>
        </div>
        {run.data && (
          <p role="status" className="text-sm text-gray-700">
            {run.data.assets === 0 ? 'Nothing is due right now.' : `${run.data.sent} email(s) sent, ${run.data.skipped} already sent earlier${run.data.failed ? `, ${run.data.failed} failed` : ''}.`}
          </p>
        )}
        {run.error && <p role="alert" className="text-sm text-red-600">{(run.error as Error).message}</p>}
      </form>

      <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <h2 className="flex items-center gap-2 px-5 py-4 font-semibold text-gray-900"><BellRing size={18} className="text-gray-400" aria-hidden /> Recent alerts</h2>
        {history.data && history.data.length === 0 && <p className="px-5 pb-4 text-sm text-gray-500">No alerts sent yet.</p>}
        {history.data && history.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-2 font-semibold text-gray-700">Instrument</th>
                  <th className="px-4 py-2 font-semibold text-gray-700">Alert</th>
                  <th className="px-4 py-2 font-semibold text-gray-700 hidden sm:table-cell">To</th>
                  <th className="px-4 py-2 font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.data.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-2 font-medium text-gray-900">{h.tag_id}<span className="block text-xs font-normal text-gray-500">due {h.due_date}</span></td>
                    <td className="px-4 py-2 text-gray-700">{describeKind(h.kind)}</td>
                    <td className="px-4 py-2 text-gray-600 hidden sm:table-cell">{h.recipient}</td>
                    <td className="px-4 py-2">
                      <span className={h.status === 'sent' ? 'text-green-700' : h.status === 'failed' ? 'text-red-700' : 'text-gray-600'} title={h.error ?? undefined}>
                        {h.status === 'sent' ? 'Sent' : h.status === 'failed' ? 'Failed' : 'Sending'}
                      </span>
                      <span className="block text-xs text-gray-500">{new Date(h.sent_at ?? h.created_at).toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
