// A minimal zip writer: stored (uncompressed) entries, UTF-8 names. Enough
// for the data export (a few hundred kB of text), without a zip dependency.
// shortcut: no compression or zip64 (4 GB); fine for the club's data, use a zip library past that.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** CRC-32 (the zip / PNG one). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A zip of the given text files, each stored as UTF-8, dated `date` (local time, as zip does). */
export function zip(files: { name: string; text: string }[], date = new Date()): Blob {
  const enc = new TextEncoder()
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  // The fields shared by the local and central headers, from "version needed" on.
  const common = (v: DataView, at: number, crc: number, size: number, nameLength: number) => {
    v.setUint16(at, 20, true) // version needed: 2.0
    v.setUint16(at + 2, 0x0800, true) // flags: UTF-8 name
    v.setUint16(at + 4, 0, true) // method: stored
    v.setUint16(at + 6, time, true)
    v.setUint16(at + 8, day, true)
    v.setUint32(at + 10, crc, true)
    v.setUint32(at + 14, size, true) // compressed size
    v.setUint32(at + 18, size, true) // uncompressed size
    v.setUint16(at + 22, nameLength, true)
  }

  for (const file of files) {
    const name = enc.encode(file.name)
    const data = enc.encode(file.text)
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    common(lv, 4, crc, data.length, name.length)
    local.set(name, 30)

    const entry = new Uint8Array(46 + name.length)
    const cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    common(cv, 6, crc, data.length, name.length)
    cv.setUint32(42, offset, true)
    entry.set(name, 46)

    parts.push(local, data)
    central.push(entry)
    offset += local.length + data.length
  }

  const size = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, size, true)
  ev.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/zip' })
}
