import type { EngineInterface, Register, RenderElement } from 'claude-code'

// A closed ```dot fence. A fence still streaming has no closing line yet, so
// it does not match and the engine draws it as text until it is complete.
const DOT_FENCE = /```dot[ \t]*\n([\s\S]*?)\n[ \t]*```/g

// Graph padding in inches; added back to the size `-Tplain` reports.
const PAD = 0.2

// Defaults for every graph. Attributes written in the dot source win.
// Mid-gray edges and pale filled nodes read on dark and light backgrounds.
const STYLE = [
  '-Gbgcolor=transparent',
  `-Gpad=${PAD}`,
  '-Gnodesep=0.4',
  '-Granksep=0.5',
  '-Gfontname=Helvetica',
  '-Gfontcolor=#8b95a7',
  '-Gcolor=#8b95a7',
  '-Gstyle=rounded',
  '-Nshape=box',
  '-Nstyle=rounded,filled',
  '-Nfillcolor=#e3ebfb',
  '-Ncolor=#5b7bd5',
  '-Nfontcolor=#1d2433',
  '-Nfontname=Helvetica',
  '-Nfontsize=12',
  '-Npenwidth=1.4',
  '-Nmargin=0.18,0.08',
  '-Ecolor=#8b95a7',
  '-Efontcolor=#8b95a7',
  '-Efontname=Helvetica',
  '-Efontsize=10',
  '-Earrowsize=0.7',
  '-Epenwidth=1.3',
]

// Terminal cell size in points (1 inch = 72 points), for a ~13pt monospace
// font: about 8pt wide and twice as tall.
const CELL_WIDTH_PT = 8
const CELL_ASPECT = 0.5
const MAX_ROWS = 40

const PROMPT = `# Diagrams (graphmod)
The interface draws Graphviz DOT as a picture. When a diagram helps (a flow, an architecture, steps in order, a state machine, a dependency tree), write it as a fenced code block tagged \`dot\` that holds one complete \`digraph\` or \`graph\`. Do not draw diagrams with ASCII art or box-drawing characters.
- Keep node labels short. Group with \`subgraph cluster_<name> { label="..." }\`; use \`shape=cylinder\` for data stores.
- Do not set colors, fonts or sizes: the plugin styles the picture.
- Tabular data stays a markdown table, not a diagram.
- This is only for replies read here. Text the person will paste elsewhere (Slack, PR, Jira, commit messages) and files you write keep their usual format, with no \`dot\` blocks.`

type Part = { kind: 'text'; text: string } | { kind: 'dot'; source: string }

type Png = { file: string; width: number; height: number }

const pngs = new Map<string, Promise<Png | null>>()
const svgs = new Map<string, Promise<string | null>>()
let hasDot: Promise<boolean> | undefined
let isDotWarned = false

function split(text: string): Part[] {
  const parts: Part[] = []
  let at = 0
  for (const m of text.matchAll(DOT_FENCE)) {
    const before = text.slice(at, m.index).trim()
    if (before !== '') parts.push({ kind: 'text', text: before })
    parts.push({ kind: 'dot', source: m[1] ?? '' })
    at = m.index + m[0].length
  }
  const rest = text.slice(at).trim()
  if (rest !== '') parts.push({ kind: 'text', text: rest })
  return parts
}

// FNV-1a, twice with different seeds: a cache file name, not security.
function hash(s: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(n)))
}

async function renderPng($: EngineInterface, source: string): Promise<Png | null> {
  const dir = `${await $.env.get('HOME')}/.cache/graphmod`
  const file = `${dir}/${hash(source)}.png`
  try {
    await $.process.run(['mkdir', '-p', dir])
    const ran = await $.process.run(['dot', '-Gdpi=144', ...STYLE, '-Tpng', '-o', file, '-Tplain'], {
      stdin: source,
      timeoutMs: 10_000,
    })
    // `-Tplain` starts with: graph <scale> <width> <height>, in inches.
    const size = /^graph \S+ (\S+) (\S+)/.exec(ran.stdout)
    if (ran.exitCode !== 0 || size === null) return null
    return { file, width: Number(size[1]) + 2 * PAD, height: Number(size[2]) + 2 * PAD }
  } catch {
    return null
  }
}

async function renderSvg($: EngineInterface, source: string): Promise<string | null> {
  try {
    const ran = await $.process.run(['dot', ...STYLE, '-Tsvg'], { stdin: source, timeoutMs: 10_000 })
    const start = ran.stdout.indexOf('<svg')
    if (ran.exitCode !== 0 || start < 0) return null
    const svg = ran.stdout.slice(start)
    return svg.length <= 131072 ? svg : null
  } catch {
    return null
  }
}

function cached<T>(cache: Map<string, Promise<T>>, source: string, render: () => Promise<T>): Promise<T> {
  const key = hash(source)
  let found = cache.get(key)
  if (found === undefined) {
    found = render()
    cache.set(key, found)
  }
  return found
}

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.surfaces.length === 0) return composed

    hasDot ??= $.process.run(['dot', '-V']).then(
      ran => ran.exitCode === 0,
      () => false,
    )
    if (!(await hasDot)) {
      if (!isDotWarned) $.ui.toast('graphmod: Graphviz `dot` not found. Run: brew install graphviz')
      isDotWarned = true
      return composed
    }
    return { sections: [...composed.sections, { id: 'graphmod:diagrams', text: PROMPT, scope: 'session' }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const parts = split(e.props.text)
    if (!parts.some(part => part.kind === 'dot')) return next(e)

    const alt = 'diagram (ctrl+o shows the dot source)'
    const maxColumns = (e.viewport?.columns ?? 100) - 4
    let isFirst = e.props.isFirstOfReply
    const drawn: RenderElement[] = []

    for (const part of parts) {
      let picture: RenderElement | null = null

      if (part.kind === 'dot' && e.surface === 'terminal') {
        const png = await cached(pngs, part.source, () => renderPng($, part.source))
        if (png !== null) {
          const { Box, Image } = $.ui.resolve(e)
          let columns = clamp(Math.min((png.width * 72) / CELL_WIDTH_PT, maxColumns), 1, 255)
          let rows = clamp(((columns * png.height) / png.width) * CELL_ASPECT, 1, 255)
          if (rows > MAX_ROWS) {
            rows = MAX_ROWS
            columns = clamp((rows * png.width) / png.height / CELL_ASPECT, 1, 255)
          }
          picture = (
            <Box paddingLeft={2} marginY={1}>
              <Image source={{ file: png.file, format: 'png' }} columns={columns} rows={rows} alt={alt} />
            </Box>
          )
        }
      } else if (part.kind === 'dot' && e.surface !== 'terminal') {
        const svg = await cached(svgs, part.source, () => renderSvg($, part.source))
        if (svg !== null) {
          const { Box, Svg } = $.ui.resolve(e)
          picture = (
            <Box paddingLeft={2} marginY={1}>
              <Svg source={svg} alt={alt} />
            </Box>
          )
        }
      }

      if (picture === null) {
        // Text, or a diagram that did not render: the engine draws it as usual.
        const text = part.kind === 'text' ? part.text : '```dot\n' + part.source + '\n```'
        picture = await next({ ...e, props: { ...e.props, text, isFirstOfReply: isFirst } })
      }
      drawn.push(picture)
      isFirst = false
    }

    const { Box } = $.ui.resolve(e)
    return <Box flexDirection="column">{drawn}</Box>
  })
}
