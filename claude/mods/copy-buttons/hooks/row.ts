import type { ClientModule } from 'claude-code'

// One thing on the row as the hooks module laid it out: its text, the columns
// it spans (`from` inclusive, `to` exclusive, gaps not included), and how it
// reads: a copy action at rest, one whose copy just landed, or a page button.
export type RowItem = { key: string; text: string; from: number; to: number; tone: 'idle' | 'done' | 'page' }
// `background`, where the row sits on a tinted card, fills its cells.
export type RowProps = { items: RowItem[]; gap: number; background?: string }

// What the row posts to the hooks module: the item a click landed on.
export type RowPress = { key: string }

type RowState = { hovered: string | null }

// The row of copy actions, drawn in a region of its own: the pointer there is
// this module's, so the engine neither selects nor copies the words under a
// click, nor a double click's word. Every click is a press, a quick second
// one too. An item at rest is dim; under the pointer it lights up in bold in
// the accent colour, the colour for a
// terminal that draws no bold, unless its copy just landed: that one reads
// plain green.
const Row: ClientModule<RowProps, RowState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const hovered = surface.state?.hovered ?? null
  const at = (x: number) => props.items.find(item => x >= item.from && x < item.to)

  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      const item = at(event.x)
      if (item !== undefined) surface.post({ key: item.key } satisfies RowPress)
      return
    }
    const next = event.type === 'leave' ? null : (at(event.x)?.key ?? null)
    if (next !== hovered) surface.setState({ hovered: next })
  })

  return Box({
    flexDirection: 'row',
    children: props.items.flatMap((item, i) => {
      const isHovered = item.key === hovered && item.tone !== 'done'
      const backgroundColor = props.background
      let text
      if (item.tone === 'done') {
        text = Text({ color: 'success', backgroundColor, children: item.text })
      } else if (isHovered) {
        text = Text({ bold: true, color: 'suggestion', backgroundColor, children: item.text })
      } else {
        text = Text({ dimColor: true, backgroundColor, children: item.text })
      }
      return i === 0 ? [text] : [Text({ backgroundColor, children: ' '.repeat(props.gap) }), text]
    }),
  })
}

export default Row
