import { zip } from '../lib/zip'

/** What export_data() returns (migration 20261123140000): metadata plus every table's rows. */
export interface ExportData {
  format: 'film-club-export'
  exported_at: string
  schema_version: string | null
  row_counts: Record<string, number>
  tables: Record<string, Record<string, unknown>[]>
}

/** A spreadsheet would run text starting with one of these as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One CSV field (RFC 4180): null is empty, arrays and objects are JSON, text
 * that a spreadsheet would read as a formula gets a leading ', and a field
 * with a quote, comma or line break is quoted (quotes doubled).
 */
export function csvCell(value: unknown): string {
  if (value == null) return ''
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * A table as CSV: a header row from the first row's columns, CRLF line ends,
 * and a byte-order mark so Excel reads it as UTF-8. Empty for no rows.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const columns = Object.keys(rows[0])
  const lines = [columns, ...rows.map((r) => columns.map((c) => r[c]))]
  return '﻿' + lines.map((cells) => cells.map(csvCell).join(',') + '\r\n').join('')
}

/** The files in the download: the complete JSON (enough to rebuild) and one CSV per table. */
export const exportFiles = (data: ExportData) => [
  { name: 'film-club-export.json', text: JSON.stringify(data, null, 2) },
  ...Object.entries(data.tables).map(([table, rows]) => ({
    name: `csv/${table}.csv`,
    text: toCsv(rows),
  })),
]

/** The download: one zip, named after the export's date. */
export function exportZip(data: ExportData): { name: string; blob: Blob } {
  return {
    name: `film-club-export-${data.exported_at.slice(0, 10)}.zip`,
    blob: zip(exportFiles(data), new Date(data.exported_at)),
  }
}
