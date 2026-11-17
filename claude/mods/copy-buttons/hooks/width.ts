// Terminal columns a text takes, as Claude Code counts them, by grapheme
// (what draws as one character): an emoji sequence two (a ZWJ family, a
// flag's pair, a keycap, one with a skin tone or a variation selector); any
// other the sum of its code points', each nothing for a mark drawn on its
// letter (Hebrew points, a virama, accents), a format or control character
// or a Hangul vowel or final consonant joining a syllable, two for an emoji
// or an East Asian wide or fullwidth character, else one: a mark drawn beside
// its letter (a Devanagari `ि` or `ी`, a Tamil `ொ`) one too, as Claude Code
// counts it from 2.1.326. So a Devanagari conjunct (`न्दी`) takes a column
// for each consonant and each vowel sign drawn beside it. And a text wrapped
// at a width as the terminal's drawing wraps it.

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined

// What draws as one character each, in order.
export const graphemes = (text: string): Iterable<string> =>
  segmenter === undefined ? Array.from(text) : Array.from(segmenter.segment(text), part => part.segment)

// An emoji with what joins or dresses it; a digit, `#` or `*` is one only as
// a keycap.
const EMOJI = /\p{Emoji}/u
const DRESSED = /\u{fe0f}|\u{200d}|\u{20e3}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\p{Emoji_Presentation}/u
const KEYCAP_BASE = /^[0-9#*]/
// Two columns as one character: one drawn as an emoji by default.
const PICTURE = /^\p{Emoji_Presentation}$/u
// Nothing on screen. A mark drawn beside its letter (Mc) takes a column.
const ZERO = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]$/u

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x16fe0 && code <= 0x16fe4) ||
    (code >= 0x16ff0 && code <= 0x16ff1) ||
    (code >= 0x17000 && code <= 0x187f7) ||
    (code >= 0x18800 && code <= 0x18cd5) ||
    (code >= 0x18d00 && code <= 0x18d08) ||
    (code >= 0x1b000 && code <= 0x1b2ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

// A Hangul vowel or final consonant, which joins the consonant before it.
const isJoiningJamo = (code: number) => (code >= 0x1160 && code <= 0x11ff) || (code >= 0xd7b0 && code <= 0xd7ff)

function widthOfCharacter(character: string): number {
  const code = character.codePointAt(0) ?? 0
  if (ZERO.test(character) || isJoiningJamo(code)) return 0
  return PICTURE.test(character) || isWide(code) ? 2 : 1
}

function widthOfGrapheme(grapheme: string): number {
  if (grapheme.length === 1) return widthOfCharacter(grapheme)
  const characters = Array.from(grapheme)
  const isSequence = characters.length > 1 && EMOJI.test(grapheme) && DRESSED.test(grapheme)
  if (isSequence && (!KEYCAP_BASE.test(grapheme) || grapheme.includes('\u{20e3}'))) return 2
  return characters.reduce((sum, character) => sum + widthOfCharacter(character), 0)
}

// Printable ASCII alone, a column each.
const PLAIN = /^[\x20-\x7e]*$/

export function widthOf(text: string): number {
  if (PLAIN.test(text)) return text.length
  let cells = 0
  for (const grapheme of graphemes(text)) cells += widthOfGrapheme(grapheme)
  return cells
}

// A word wider than the row, broken where the row ends: each character on
// the row while it fits, a full row closed.
function breakWord(rows: string[], word: string, columns: number) {
  const characters = Array.from(graphemes(word))
  let visible = widthOf(rows.at(-1) ?? '')
  characters.forEach((character, i) => {
    const width = widthOf(character)
    if (visible + width <= columns) rows[rows.length - 1] += character
    else {
      rows.push(character)
      visible = 0
    }
    visible += width
    if (visible === columns && i < characters.length - 1) {
      rows.push('')
      visible = 0
    }
  })
  if (visible === 0 && (rows.at(-1) ?? '') !== '' && rows.length > 1) {
    const last = rows.pop() ?? ''
    rows[rows.length - 1] += last
  }
}

// A text wrapped at `columns` as the terminal's drawing wraps it (wrap-ansi
// with word wrap and nothing trimmed), each of its lines on rows of its own:
// at spaces, a space kept at the end of the row it falls on or starting the
// next; with `isHard`, a word wider than the row broken where the row ends
// (on a row of its own when that breaks it no more often), else left whole.
export function wrapAnsi(text: string, columns: number, isHard: boolean): string[] {
  return text.split('\n').flatMap(line => {
    const rows = ['']
    line.split(' ').forEach((word, i) => {
      let used = widthOf(rows.at(-1) ?? '')
      const width = widthOf(word)
      if (i !== 0) {
        if (used >= columns) {
          rows.push('')
          used = 0
        }
        rows[rows.length - 1] += ' '
        used++
      }
      if (isHard && width > columns) {
        const left = columns - used
        if (Math.floor((width - 1) / columns) < 1 + Math.floor((width - left - 1) / columns)) rows.push('')
        breakWord(rows, word, columns)
        return
      }
      if (used + width > columns && used > 0 && width > 0) rows.push('')
      rows[rows.length - 1] += word
    })
    return rows
  })
}
