import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../films/filmDetail'
import type { Person } from '../films/films'
import { fetchRotation, type RotationData } from './api'

/**
 * Loads the rotation and runs one write at a time, reloading after each.
 * Pass the people already loaded (films page) to skip fetching them again.
 */
export function useRotation(people?: Person[]) {
  const [data, setData] = useState<RotationData | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  /** The last write error and which form it came from. */
  const [error, setError] = useState<{ section: string; message: string } | null>(null)

  // Only the first load can fail the page; a failed reload keeps what is shown.
  const load = useCallback(
    () =>
      fetchRotation(people).then(
        (d) => {
          setData(d)
          setFailed(false)
        },
        () => setFailed(true),
      ),
    [people],
  )
  useEffect(() => {
    void load()
  }, [load])

  /** Resolves true on success. */
  const run = async (section: string, write: () => Promise<void>) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await write()
      return true
    } catch (e) {
      setError({ section, message: errorMessage(e) })
      return false
    } finally {
      await load()
      busyRef.current = false
      setBusy(false)
    }
  }

  const retry = () => {
    setFailed(false)
    void load()
  }
  return { data, failed, retry, run, busy, error }
}

export type Rotation = ReturnType<typeof useRotation>
