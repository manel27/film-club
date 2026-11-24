// @vitest-environment node
// (Node's Blob, to read the zip back. e2e/admin.spec.ts also opens a real
// export with Python's zipfile.)
import { describe, expect, it } from 'vitest'
import { crc32, zip } from '../lib/zip'
import { csvCell, exportFiles, exportZip, toCsv, type ExportData } from './export'

describe('csvCell', () => {
  it('leaves plain values alone and empties null', () => {
    expect(csvCell('Kwame')).toBe('Kwame')
    expect(csvCell(7.5)).toBe('7.5')
    expect(csvCell(-2)).toBe('-2')
    expect(csvCell(true)).toBe('true')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes commas, quotes and line breaks, doubling quotes', () => {
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"')
  })

  it('defuses text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x.test")')).toBe(`"'=HYPERLINK(""http://x.test"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-1+1')).toBe("'-1+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\t=1')).toBe("'\t=1")
    expect(csvCell('\r=1')).toBe(`"'\r=1"`)
    // Only text: a negative number stays a number.
    expect(csvCell(-1)).toBe('-1')
    // Not at the start: harmless.
    expect(csvCell('a=b')).toBe('a=b')
  })

  it('writes arrays and objects as JSON', () => {
    expect(csvCell(['Drama', 'Crime'])).toBe('"[""Drama"",""Crime""]"')
    expect(csvCell({ date: '2026-01-01' })).toBe('"{""date"":""2026-01-01""}"')
  })
})

describe('toCsv', () => {
  it('has a header, CRLF rows and a BOM; nothing for no rows', () => {
    expect(
      toCsv([
        { id: 1, name: 'Inês', note: null },
        { id: 2, name: '=1+1', note: 'a,b' },
      ]),
    ).toBe('﻿id,name,note\r\n1,Inês,\r\n2,\'=1+1,"a,b"\r\n')
    expect(toCsv([])).toBe('')
  })

  it('writes the header from the known columns, even with no rows', () => {
    expect(toCsv([], ['id', 'body'])).toBe('\uFEFFid,body\r\n')
    expect(toCsv([{ id: 1, body: 'hi' }], ['id', 'body'])).toBe('\uFEFFid,body\r\n1,hi\r\n')
  })
})

const data: ExportData = {
  format: 'film-club-export',
  exported_at: '2026-11-23T21:05:00.123+00:00',
  schema_version: '20261123140000',
  row_counts: { films: 1, scores: 2 },
  tables: {
    films: [{ id: 1, title: 'The Quiet Orchard', genres: ['Drama'] }],
    scores: [
      { film_id: 1, profile_id: 'a', score: 7.5 },
      { film_id: 1, profile_id: 'b', score: 9 },
    ],
  },
}

describe('exportFiles', () => {
  it("gives an empty table a header line from the export's columns", () => {
    const files = exportFiles({
      ...data,
      columns: { comments: ['id', 'film_id', 'body'] },
      tables: { comments: [] },
    })
    expect(files[1]).toEqual({ name: 'csv/comments.csv', text: '\uFEFFid,film_id,body\r\n' })
  })

  it('is the complete JSON plus one CSV per table', () => {
    const files = exportFiles(data)
    expect(files.map((f) => f.name)).toEqual([
      'film-club-export.json',
      'csv/films.csv',
      'csv/scores.csv',
    ])
    expect(JSON.parse(files[0].text)).toEqual(data)
    expect(files[2].text).toBe('﻿film_id,profile_id,score\r\n1,a,7.5\r\n1,b,9\r\n')
  })
})

/**
 * Reads a stored zip back the way an unzipper does: end record -> central
 * directory -> each local header, checking signatures, sizes and CRCs agree.
 */
function unzip(bytes: Uint8Array): Record<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dec = new TextDecoder()
  const end = bytes.length - 22
  expect(v.getUint32(end, true)).toBe(0x06054b50)
  const count = v.getUint16(end + 10, true)
  let at = v.getUint32(end + 16, true)
  expect(at + v.getUint32(end + 12, true)).toBe(end)
  const files: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50)
    expect(v.getUint16(at + 8, true)).toBe(0x0800) // UTF-8 names
    expect(v.getUint16(at + 10, true)).toBe(0) // stored
    const crc = v.getUint32(at + 16, true)
    const size = v.getUint32(at + 24, true)
    const nameLength = v.getUint16(at + 28, true)
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const local = v.getUint32(at + 42, true)
    expect(v.getUint32(local, true)).toBe(0x04034b50)
    expect(v.getUint32(local + 14, true)).toBe(crc)
    expect(v.getUint16(local + 26, true)).toBe(nameLength)
    const start = local + 30 + nameLength
    const data = bytes.subarray(start, start + size)
    expect(crc32(data)).toBe(crc)
    files[name] = dec.decode(data)
    at += 46 + nameLength
  }
  return files
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('writes a zip other tools read, with UTF-8 names and contents', async () => {
    const blob = zip(
      [
        { name: 'a.txt', text: 'hello' },
        { name: 'pasta/Inês.csv', text: 'olá, mundo\r\n' },
        { name: 'empty.csv', text: '' },
      ],
      new Date(2026, 10, 23, 21, 5, 30),
    )
    expect(blob.type).toBe('application/zip')
    expect(unzip(new Uint8Array(await blob.arrayBuffer()))).toEqual({
      'a.txt': 'hello',
      'pasta/Inês.csv': 'olá, mundo\r\n',
      'empty.csv': '',
    })
  })

  it('packs the export under a dated name', async () => {
    const { name, blob } = exportZip(data)
    expect(name).toBe('film-club-export-2026-11-23.zip')
    const files = unzip(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(files)).toEqual(['film-club-export.json', 'csv/films.csv', 'csv/scores.csv'])
    expect(JSON.parse(files['film-club-export.json']).row_counts).toEqual({ films: 1, scores: 2 })
  })
})
