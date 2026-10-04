import { apiRequest } from './client'

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

export interface InvoiceLine {
  id?: string
  description: string
  quantity: number
  unit_price: number
  amount?: number
  asset_id: string | null
  record_id: string | null
  asset_tag?: string | null
}

export interface Invoice {
  id: string
  number: number
  customer_id: string | null
  customer_name: string | null
  customer_email?: string | null
  work_order_id: string | null
  status: InvoiceStatus
  issue_date: string
  due_date: string | null
  currency: string
  tax_rate: number
  notes: string | null
  sent_at: string | null
  paid_at: string | null
  created_at: string
  subtotal: number
  tax: number
  total: number
  lines?: InvoiceLine[]
}

export interface InvoiceInput {
  customer_id: string | null
  work_order_id?: string | null
  issue_date?: string
  due_date: string | null
  currency: string
  tax_rate: number
  notes: string | null
  lines: InvoiceLine[]
}

export function listInvoices(status?: InvoiceStatus): Promise<Invoice[]> {
  return apiRequest<Invoice[]>('GET', `/invoices${status ? `?status=${status}` : ''}`)
}

export function getInvoice(id: string): Promise<Invoice> {
  return apiRequest<Invoice>('GET', `/invoices/${id}`)
}

export function createInvoice(input: InvoiceInput): Promise<{ id: string }> {
  return apiRequest('POST', '/invoices', input)
}

export function updateInvoice(id: string, input: InvoiceInput): Promise<{ id: string }> {
  return apiRequest('PUT', `/invoices/${id}`, input)
}

export function deleteInvoice(id: string): Promise<void> {
  return apiRequest('DELETE', `/invoices/${id}`)
}

export function setInvoiceStatus(id: string, status: InvoiceStatus, email = false): Promise<unknown> {
  return apiRequest('PATCH', `/invoices/${id}/status`, { status, email })
}

export function invoiceFromWorkOrder(
  workOrderId: string,
  opts: { unit_price: number; tax_rate: number; currency: string; due_days: number },
): Promise<{ id: string }> {
  return apiRequest('POST', `/work-orders/${workOrderId}/invoice`, opts)
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/** Line total rounded to cents, matching the server. */
export function lineAmount(l: Pick<InvoiceLine, 'quantity' | 'unit_price'>): number {
  return Math.round((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * 100) / 100
}

export function invoiceTotals(lines: InvoiceLine[], taxRate: number) {
  const subtotal = Math.round(lines.reduce((s, l) => s + lineAmount(l), 0) * 100) / 100
  const tax = Math.round(subtotal * (Number(taxRate) || 0)) / 100
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 }
}
