import { Link } from 'react-router-dom'
import { type ActivityEntry, TABLE_LABELS, activityLink, fieldLabel, formatValue } from '../../lib/api/activity'

const ACTION_STYLE: Record<ActivityEntry['action'], { verb: string; className: string }> = {
  INSERT: { verb: 'created', className: 'bg-green-50 text-green-700' },
  UPDATE: { verb: 'changed', className: 'bg-amber-50 text-amber-700' },
  DELETE: { verb: 'deleted', className: 'bg-red-50 text-red-700' },
}

// Fields that are noise in a change list (ids already shown as links).
const HIDDEN_FIELDS = new Set(['local_id', 'record_id', 'invoice_id', 'work_order_id', 'tenant_id', 'position'])

export default function ActivityItem({ entry, showSubject = true }: { entry: ActivityEntry; showSubject?: boolean }) {
  const style = ACTION_STYLE[entry.action]
  const link = activityLink(entry)
  const subject = `${TABLE_LABELS[entry.table_name] ?? entry.table_name}${entry.label ? ` ${entry.label}` : ''}`
  const changes = entry.changes.filter((c) => !HIDDEN_FIELDS.has(c.field))
  const shown = entry.action === 'UPDATE' ? changes : changes.slice(0, 6)

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${style.className}`}>{style.verb}</span>
        {showSubject && (
          link
            ? <Link to={link} className="font-semibold text-gray-900 hover:text-brand-600">{subject}</Link>
            : <span className="font-semibold text-gray-900">{subject}</span>
        )}
        <span className="text-gray-500">
          by {entry.user_name ?? (entry.user_id ? 'a removed user' : 'system')}
        </span>
        <time className="ml-auto text-xs text-gray-400" dateTime={entry.created_at}>
          {new Date(entry.created_at).toLocaleString()}
        </time>
      </div>
      {shown.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
          {shown.map((c) => (
            <div key={c.field} className="contents">
              <dt className="capitalize text-gray-500">{fieldLabel(c.field)}</dt>
              <dd className="min-w-0 break-words text-gray-800">
                {entry.action === 'UPDATE' ? (
                  <>
                    <span className="text-gray-400 line-through">{formatValue(c.old)}</span>
                    <span className="mx-1 text-gray-400" aria-hidden>→</span>
                    <span className="sr-only"> changed to </span>
                    <span>{formatValue(c.new)}</span>
                  </>
                ) : (
                  formatValue(entry.action === 'DELETE' ? c.old : c.new)
                )}
              </dd>
            </div>
          ))}
          {entry.action !== 'UPDATE' && changes.length > shown.length && (
            <div className="col-span-2 text-gray-400">+{changes.length - shown.length} more fields</div>
          )}
        </dl>
      )}
    </li>
  )
}
