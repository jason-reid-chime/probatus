import type { InvoiceStatus } from '../../lib/api/invoices'

const STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-50 text-blue-700',
  paid: 'bg-green-50 text-green-700',
  void: 'bg-red-50 text-red-700 line-through',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${STYLES[status]}`}>{status}</span>
}
