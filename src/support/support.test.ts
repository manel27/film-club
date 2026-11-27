import { describe, expect, it } from 'vitest'
import { NO_ROWS } from '../films/filmDetail'
import { fakeProfile } from '../test/fakeAuthBackend'
import { canDelete, checkText, dateTime, isStaff, savedLength, supportError } from './support'

describe('checkText', () => {
  it('returns the text as stored: invisible characters gone, spaces collapsed, trimmed', () => {
    expect(checkText('  More\u200b   subtitles\n\tplease ', 100, 'empty')).toEqual({
      value: 'More subtitles please',
    })
    // Joiners inside emoji and words stay.
    expect(checkText('👨\u200d👩 می\u200cخواهم', 100, 'empty')).toEqual({
      value: '👨\u200d👩 می\u200cخواهم',
    })
  })

  it('refuses text with nothing visible', () => {
    for (const blank of ['', '   ', '\u200b\ufeff', '\u00a0\n', '\u200d']) {
      expect(checkText(blank, 100, 'Give it a title.'), JSON.stringify(blank)).toEqual({
        error: 'Give it a title.',
      })
    }
  })

  it('counts characters (code points) after normalising, as the database does', () => {
    expect(checkText('a'.repeat(100), 100, '')).toEqual({ value: 'a'.repeat(100) })
    expect(checkText(` ${'a'.repeat(100)}\u200b `, 100, '')).toEqual({ value: 'a'.repeat(100) })
    expect(checkText('😀'.repeat(100), 100, '')).toEqual({ value: '😀'.repeat(100) })
    expect(checkText('a'.repeat(101), 100, '')).toEqual({
      error: 'Keep it to 100 characters or fewer.',
    })
  })
})

describe('checkText, multiline (suggestion text and replies)', () => {
  it('keeps paragraphs and tidies the rest', () => {
    expect(checkText('One.\r\n\r\n\r\n Two. ', 100, 'empty', true)).toEqual({
      value: 'One.\n\nTwo.',
    })
    // Titles stay one line.
    expect(checkText('One.\nTwo.', 100, 'empty')).toEqual({ value: 'One. Two.' })
  })

  it('refuses text with nothing visible and counts as saved', () => {
    expect(checkText('\n \n', 100, 'Write a reply.', true)).toEqual({ error: 'Write a reply.' })
    expect(savedLength('a\n\n\n\nb', true)).toBe(4)
    expect(savedLength('a\n\n\n\nb')).toBe(3)
  })
})

describe('canDelete', () => {
  const me = fakeProfile({ id: 'me', role: 'member' })
  const mine = (replyAuthors: string[]) => ({
    author_id: 'me',
    suggestion_replies: replyAuthors.map((author_id) => ({ author_id })),
  })

  it('lets the author delete while only they have replied', () => {
    expect(canDelete(me, mine([]))).toBe(true)
    expect(canDelete(me, mine(['me', 'me']))).toBe(true)
  })

  it('stops the author once anyone else has replied', () => {
    expect(canDelete(me, mine(['me', 'staff']))).toBe(false)
  })

  it("never lets anyone but the admin delete someone else's", () => {
    const theirs = { author_id: 'other', suggestion_replies: [] }
    expect(canDelete(me, theirs)).toBe(false)
    expect(canDelete(fakeProfile({ role: 'moderator' }), theirs)).toBe(false)
    expect(canDelete(fakeProfile({ role: 'admin' }), mine(['staff']))).toBe(true)
    expect(canDelete(null, mine([]))).toBe(false)
  })
})

describe('isStaff', () => {
  it('is true for moderators and admins only', () => {
    expect(
      ['admin', 'moderator', 'member', 'viewer'].map((role) =>
        isStaff(fakeProfile({ role: role as 'admin' })),
      ),
    ).toEqual([true, true, false, false])
    expect(isStaff(null)).toBe(false)
  })
})

describe('supportError', () => {
  it('explains a delete refused because of a reply', () => {
    expect(
      supportError({
        code: '42501',
        message: 'This suggestion has a reply, so it can no longer be deleted',
      }),
    ).toBe('Someone has replied, so this suggestion can no longer be deleted.')
  })

  it('explains a reply to a deleted suggestion', () => {
    expect(supportError({ code: '23503', message: 'violates foreign key' })).toBe(
      'This suggestion was deleted.',
    )
  })

  it('explains a refused reply as a deleted suggestion (RLS answers before the foreign key)', () => {
    expect(supportError({ code: '42501', message: 'row-level security' }, 'reply')).toBe(
      'This suggestion was deleted.',
    )
  })

  it('falls back to the shared messages', () => {
    expect(supportError({ code: '42501', message: 'row-level security' })).toBe(
      "You can't change that.",
    )
    expect(supportError(NO_ROWS)).toBe('This was changed or removed elsewhere.')
    expect(supportError(new TypeError('fetch failed'))).toBe(
      "Couldn't reach the server. Try again.",
    )
  })
})

describe('dateTime', () => {
  it('shows the date and time in Lisbon', () => {
    // 23:30 UTC in summer is 00:30 the next day in Lisbon.
    expect(dateTime('2026-07-01T23:30:00Z')).toBe('2 Jul 2026, 00:30')
  })
})
