'use client'
// Excel and PDF exports. Everything is generated in the browser and
// downloaded as a file (spec section 9).
import { formatDate, formatDateTime, money, priceInclVat, todayISO, vatAmount } from './logic'
import type {
  ArchivedRental, Branch, BranchAccess, Category, Profile, Rental, Settings, Space, SpaceType, Supplier,
} from './types'

const LIST_SEP = ' | '

async function excel() {
  return (await import('exceljs')).default
}

function download(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type Row = Record<string, string | number | boolean | null>

async function saveWorkbook(sheets: { name: string; rows: Row[]; columns?: string[] }[], filename: string) {
  const ExcelJS = await excel()
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    const cols = s.columns ?? (s.rows[0] ? Object.keys(s.rows[0]) : [])
    ws.columns = cols.map(c => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 2)) }))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    for (const r of s.rows) ws.addRow(r)
  }
  const buf = await wb.xlsx.writeBuffer()
  download(buf, filename, XLSX_TYPE)
}

// ----------------------------------------------------------- single rental

export interface RentalDoc {
  branch?: Branch
  space?: Space
  type?: SpaceType
  rental: Pick<Rental, 'supplier' | 'brands' | 'categories' | 'rental_type' | 'start_date' | 'end_date' | 'price' | 'executed' | 'removed' | 'notes'>
  categoryLabel: (code: string) => string
  vatRate: number
}

function rentalFields(d: RentalDoc): [string, string][] {
  const r = d.rental
  return [
    ['Branch', d.branch ? `${d.branch.code} — ${d.branch.name}` : ''],
    ['Space', d.space?.label ?? ''],
    ['Space code', d.space?.code ?? ''],
    ['Display type', d.type?.label ?? d.space?.type ?? ''],
    ['Supplier', r.supplier],
    ['Brand(s)', r.brands.join(', ')],
    ['Categories', r.categories.map(d.categoryLabel).join(', ')],
    ['Rental type', r.rental_type === 'contractual' ? 'Contractual' : 'Normal'],
    ['Start date', formatDate(r.start_date)],
    ['End date', formatDate(r.end_date)],
    ['Monthly price (excl. VAT)', money(r.price)],
    ['VAT rate', `${d.vatRate}%`],
    ['VAT amount', money(vatAmount(r.price, d.vatRate))],
    ['Monthly price (incl. VAT)', money(priceInclVat(r.price, d.vatRate))],
    ['Executed?', r.executed ? 'Yes' : 'No'],
    ['Removed?', r.removed ? 'Yes' : 'No'],
    ['Notes', r.notes || ''],
  ]
}

/** "Rental Confirmation" PDF — every field on one page. */
export async function rentalPdf(d: RentalDoc) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Rental Confirmation', 40, 56)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(110)
  doc.text('Le Charcutier — Branch Space Leasing', 40, 74)
  autoTable(doc, {
    startY: 96,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 6, overflow: 'linebreak' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 170, fillColor: [245, 247, 249] } },
    body: rentalFields(d),
  })
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(`Generated on ${formatDate(todayISO())}`, 40, doc.internal.pageSize.getHeight() - 30)
  doc.save(`rental-${d.space?.code ?? 'space'}-${d.rental.start_date}.pdf`)
}

/** "Export tag to Excel" — the same fields as a two-column sheet. */
// Only these fields go on the tag export (the PDF keeps every field).
const TAG_FIELDS = ['Supplier', 'Brand(s)', 'Categories', 'Display type', 'Start date', 'End date']

export async function rentalTagExcel(d: RentalDoc) {
  const all = new Map(rentalFields(d))
  const rows = TAG_FIELDS.map(field => ({ Field: field, Value: all.get(field) ?? '' }))
  await saveWorkbook([{ name: 'Rental', rows }], `rental-${d.space?.code ?? 'space'}-${d.rental.start_date}.xlsx`)
}

// ----------------------------------------------------------- expiry digest

export async function digestExcel(rows: { branch: string; code: string; type: string; supplier: string; brands: string; start: string; end: string; daysLeft: number; price: number; executed: boolean }[], horizon: number) {
  await saveWorkbook([{
    name: `Ending in ${horizon} days`,
    rows: rows.map(r => ({
      Branch: r.branch, 'Space code': r.code, Type: r.type, Supplier: r.supplier, Brands: r.brands,
      'Start date': r.start, 'End date': r.end, 'Days left': r.daysLeft, 'Monthly price (excl. VAT)': r.price,
      Executed: r.executed ? 'Yes' : 'No',
    })),
  }], `expiry-digest-${horizon}d-${todayISO()}.xlsx`)
}

/** Generic table export used by the Spaces and Archive screens. */
export async function tableExcel(name: string, rows: Row[], filename: string) {
  await saveWorkbook([{ name, rows }], filename)
}

// ----------------------------------------------------------- full backup

export interface BackupData {
  branches: Branch[]; types: SpaceType[]; spaces: Space[]; rentals: Rental[]; archive: ArchivedRental[]
  suppliers: Supplier[]; categories: Category[]; brands: string[]; profiles: Profile[]; access: BranchAccess[]
  settings: Settings
}

const RENTAL_COLS = ['id', 'space_id', 'branch_id', 'supplier', 'brands', 'categories', 'start_date', 'end_date', 'price',
  'vat_amount', 'price_incl_vat', 'executed', 'removed', 'rental_type', 'notes', 'bulk_id', 'last_edited_by', 'last_edited_at', 'created_at']

function rentalRow(r: Rental, vat: number): Row {
  return {
    id: r.id, space_id: r.space_id, branch_id: r.branch_id, supplier: r.supplier,
    brands: r.brands.join(LIST_SEP), categories: r.categories.join(LIST_SEP),
    start_date: r.start_date, end_date: r.end_date, price: Number(r.price),
    vat_amount: vatAmount(r.price, vat), price_incl_vat: priceInclVat(r.price, vat),
    executed: r.executed, removed: r.removed, rental_type: r.rental_type, notes: r.notes, bulk_id: r.bulk_id,
    last_edited_by: r.last_edited_by, last_edited_at: r.last_edited_at, created_at: r.created_at,
  }
}

export async function backupExcel(d: BackupData) {
  const vat = d.settings.vat_rate
  const lockedBy = new Map(d.access.map(a => [a.user_id, a.branch_id]))
  await saveWorkbook([
    { name: 'Branches', rows: d.branches.map(b => ({ id: b.id, code: b.code, name: b.name, ord: b.ord })), columns: ['id', 'code', 'name', 'ord'] },
    { name: 'Types', rows: d.types.map(t => ({ key: t.key, label: t.label, ord: t.ord, expiring_days: t.expiring_days })), columns: ['key', 'label', 'ord', 'expiring_days'] },
    { name: 'Spaces', rows: d.spaces.map(s => ({ id: s.id, branch_id: s.branch_id, type: s.type, label: s.label, code: s.code, size: s.size, remarks: s.remarks, photo_path: s.photo_path })), columns: ['id', 'branch_id', 'type', 'label', 'code', 'size', 'remarks', 'photo_path'] },
    { name: 'Rentals', rows: d.rentals.map(r => rentalRow(r, vat)), columns: RENTAL_COLS },
    { name: 'Archived transactions', rows: d.archive.map(r => ({ ...rentalRow(r, vat), archived_at: r.archived_at })), columns: [...RENTAL_COLS, 'archived_at'] },
    { name: 'Suppliers', rows: d.suppliers.map(s => ({ code: s.code, name: s.name })), columns: ['code', 'name'] },
    { name: 'Categories', rows: d.categories.map(c => ({ code: c.code, description: c.description })), columns: ['code', 'description'] },
    { name: 'Brands', rows: d.brands.map(name => ({ name })), columns: ['name'] },
    { name: 'Privileges', rows: d.profiles.map(p => ({ user_id: p.id, email: p.email, display_name: p.display_name, role: p.role, branch_id: lockedBy.get(p.id) ?? '' })), columns: ['user_id', 'email', 'display_name', 'role', 'branch_id'] },
    { name: 'Settings', rows: [{ vat_rate: vat }], columns: ['vat_rate'] },
  ], `space-leasing-backup-${todayISO()}.xlsx`)
}

// ----------------------------------------------------------- reading Excel

function cellValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map(x => x.text).join('')
    if ('result' in o) return cellValue(o.result)
    if (o.text !== undefined) return o.text
    return String(v)
  }
  return v as string | number | boolean
}

/** Reads every sheet of a workbook into {sheetName: rows[]} keyed by the header row. */
export async function readWorkbook(file: File): Promise<Record<string, Record<string, string | number | boolean | null>[]>> {
  const ExcelJS = await excel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const out: Record<string, Record<string, string | number | boolean | null>[]> = {}
  wb.eachSheet(ws => {
    const headers: string[] = []
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i] = String(cellValue(c.value) ?? '').trim() })
    const rows: Record<string, string | number | boolean | null>[] = []
    ws.eachRow((row, n) => {
      if (n === 1) return
      const obj: Record<string, string | number | boolean | null> = {}
      let any = false
      row.eachCell({ includeEmpty: true }, (c, i) => {
        if (!headers[i]) return
        const v = cellValue(c.value)
        if (v !== null && v !== '') any = true
        obj[headers[i]] = v
      })
      if (any) rows.push(obj)
    })
    out[ws.name] = rows
  })
  return out
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const bool = (v: unknown) => v === true || /^(true|yes|1)$/i.test(str(v))
const list = (v: unknown) => str(v).split(LIST_SEP.trim()).map(x => x.trim()).filter(Boolean)
const date = (v: unknown) => str(v).slice(0, 10)

/** Turns a backup workbook into the payload restore_backup() expects. */
export async function parseBackup(file: File) {
  const wb = await readWorkbook(file)
  const sheet = (n: string) => wb[n] ?? []
  const rental = (r: Record<string, unknown>) => ({
    id: str(r.id), space_id: str(r.space_id), branch_id: str(r.branch_id), supplier: str(r.supplier),
    brands: list(r.brands), categories: list(r.categories), start_date: date(r.start_date), end_date: date(r.end_date),
    price: Number(r.price ?? 0), executed: bool(r.executed), rental_type: str(r.rental_type) || 'normal',
    notes: str(r.notes), bulk_id: str(r.bulk_id) || null, last_edited_by: str(r.last_edited_by) || null,
    last_edited_at: str(r.last_edited_at) || null, created_at: str(r.created_at) || null,
  })
  const payload = {
    branches: sheet('Branches').map(r => ({ id: str(r.id), code: str(r.code), name: str(r.name), ord: Number(r.ord ?? 0) })).filter(r => r.id),
    types: sheet('Types').map(r => ({ key: str(r.key), label: str(r.label), ord: Number(r.ord ?? 0), expiring_days: Number(r.expiring_days ?? 7) })).filter(r => r.key),
    spaces: sheet('Spaces').map(r => ({ id: str(r.id), branch_id: str(r.branch_id), type: str(r.type), label: str(r.label), code: str(r.code), size: str(r.size), remarks: str(r.remarks), photo_path: str(r.photo_path) || null })).filter(r => r.id),
    rentals: sheet('Rentals').map(rental).filter(r => r.id),
    archive: sheet('Archived transactions').map(r => ({ ...rental(r), archived_at: str(r.archived_at) || null })).filter(r => r.id),
    suppliers: sheet('Suppliers').map(r => ({ code: str(r.code), name: str(r.name) })).filter(r => r.code),
    categories: sheet('Categories').map(r => ({ code: str(r.code), description: str(r.description) })).filter(r => r.code),
    brands: sheet('Brands').map(r => str(r.name)).filter(Boolean),
    privileges: sheet('Privileges').map(r => ({ user_id: str(r.user_id), display_name: str(r.display_name), role: str(r.role), branch_id: str(r.branch_id) })).filter(r => r.user_id),
    settings: sheet('Settings')[0] ? { vat_rate: Number(sheet('Settings')[0].vat_rate) } : undefined,
  }
  if (!payload.branches.length && !payload.spaces.length && !payload.rentals.length) {
    throw new Error('This does not look like a backup file from this app (no Branches, Spaces or Rentals sheet).')
  }
  return payload
}

/**
 * Reads a reference-data master file. Uses the first sheet and looks for
 * columns by name (code / name / description), falling back to column order.
 */
export async function parseRefData(file: File, kind: 'suppliers' | 'categories' | 'brands') {
  const wb = await readWorkbook(file)
  // Prefer the sheet named after the list (e.g. "Categories", "Brand"); fall back to the first sheet.
  const stem = kind.replace(/ies$/, 'y').replace(/s$/, '')
  const named = Object.keys(wb).find(n => n.toLowerCase().includes(stem))
  const first = (named ? wb[named] : Object.values(wb)[0]) ?? []
  const pick = (row: Record<string, unknown>, names: string[], idx: number) => {
    const keys = Object.keys(row)
    const k = keys.find(k => names.includes(k.toLowerCase().trim()))
    return str(k ? row[k] : row[keys[idx]])
  }
  if (kind === 'brands') return first.map(r => pick(r, ['name', 'brand', 'brands'], 0)).filter(Boolean)
  if (kind === 'suppliers') return first.map(r => ({ code: pick(r, ['code', 'supplier code'], 0), name: pick(r, ['name', 'supplier', 'supplier name'], 1) })).filter(r => r.code)
  return first.map(r => ({ code: pick(r, ['code', 'category code'], 0), description: pick(r, ['description', 'name', 'category'], 1) })).filter(r => r.code)
}

export { formatDateTime }
