import type { EngineInterface, Register, RenderElement } from 'claude-code'

// A closed ```dot fence. A fence still streaming has no closing line yet, so
// it does not match and the engine draws it as text until it is complete.
const DOT_FENCE = /```dot[ \t]*\n([\s\S]*?)\n[ \t]*```/g

// Graph padding in inches; added back to the size `-Tplain` reports.
const PAD = 0.2

// Defaults for every graph: a cream card, white rounded boxes, warm gray
// lines. Attributes written in the dot source win; hooks/style.g then colors
// each cluster and turns box labels into cards.
const STYLE = [
  '-Gbgcolor=#faf7f0',
  `-Gpad=${PAD}`,
  '-Gnodesep=0.35',
  '-Granksep=0.55',
  '-Gfontname=Menlo Bold',
  '-Gfontsize=11',
  '-Gfontcolor=#7a6650',
  '-Gcolor=#ddd5c6',
  '-Gstyle=rounded',
  '-Glabeljust=l',
  '-Nshape=box',
  '-Nstyle=rounded,filled',
  '-Nfillcolor=#fdfbf7',
  '-Ncolor=#5b6472',
  '-Nfontcolor=#2a2620',
  '-Nfontname=Helvetica',
  '-Nfontsize=13',
  '-Npenwidth=1.6',
  '-Nmargin=0.16,0.1',
  '-Ecolor=#b3aa98',
  '-Efontcolor=#8a8273',
  '-Efontname=Menlo',
  '-Efontsize=10',
  '-Earrowsize=0.7',
  '-Epenwidth=1.4',
]

// Terminal cell size in points (1 inch = 72 points), for a ~13pt monospace
// font: about 8pt wide and twice as tall.
const CELL_WIDTH_PT = 8
const CELL_ASPECT = 0.5

// TERM_PROGRAM of terminals that speak the kitty graphics protocol, which
// `Image` needs; kitty itself is told by TERM. Elsewhere (Terminal.app, tmux,
// ssh) `Image` draws only its alt text.
const IMAGE_TERMINALS = ['ghostty', 'WezTerm']

// DOT that makes `dot` read local files (image, shapefile, search paths, an
// HTML-label <IMG>). The source comes from a reply a prompt injection could
// steer, so such a block is shown as text, never rendered.
const READS_FILES = /\b(image|shapefile|imagepath|fontpath)\s*=|<\s*img\b/i

const PROMPT = `# Diagrams (graphmod)
The interface draws Graphviz DOT as a picture. When a diagram helps (a flow, an architecture, steps in order, a state machine, a dependency tree), write it as a fenced code block tagged \`dot\` that holds one complete \`digraph\` or \`graph\`. Do not draw diagrams with ASCII art or box-drawing characters.
- Label a node \`"Title\\nshort detail"\`: the first line is drawn bold, the second small and monospace (a path, a command, a few words). Keep both short.
- Keep the default top-to-bottom layout. Put each layer in \`subgraph cluster_<name> { label="..." }\`, 3 to 5 nodes per layer; each cluster gets its own color.
- Do not set colors, fonts or sizes: the plugin styles the picture.
- Tabular data stays a markdown table, not a diagram.
- This is only for replies read here. Text the person will paste elsewhere (Slack, PR, Jira, commit messages) and files you write keep their usual format, with no \`dot\` blocks.`

type Part = { kind: 'text'; text: string } | { kind: 'dot'; source: string }

// `page` is the interactive HTML next to the PNG, when it could be written.
type Png = { file: string; page: string | null; width: number; height: number }

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

// Colors clusters and turns labels into cards (hooks/style.g). Without
// `gvpr`, or when it fails, the plain source is drawn with STYLE alone.
async function styled($: EngineInterface, source: string): Promise<string> {
  try {
    const ran = await $.process.run(['gvpr', '-c', '-f', `${$.plugin.root}/hooks/style.g`], {
      stdin: source,
      timeoutMs: 10_000,
    })
    return ran.exitCode === 0 && !ran.isStdoutTruncated && ran.stdout.trim() !== '' ? ran.stdout : source
  } catch {
    return source
  }
}

// A page that opens in the browser: the SVG with hover, pin, pan and zoom.
// Links in the SVG (`URL=`, `href=`) are dropped: the page is opened locally.
async function writePage($: EngineInterface, svgFile: string, pageFile: string): Promise<boolean> {
  try {
    const svg = await $.fs.read(svgFile)
    const start = svg.indexOf('<svg')
    if (start < 0) return false
    const safe = svg.slice(start).replace(/\s(?:xlink:)?href="[^"]*"/g, '')
    const page = await $.fs.read(`${$.plugin.root}/hooks/page.html`)
    await $.fs.write(pageFile, page.replace('<!--SVG-->', () => safe))
    return true
  } catch {
    return false
  }
}

async function renderPng($: EngineInterface, source: string): Promise<Png | null> {
  const dir = `${await $.env.get('HOME')}/.cache/graphmod`
  const base = `${dir}/${hash(source)}`
  try {
    await $.process.run(['mkdir', '-p', dir])
    const ran = await $.process.run(
      ['dot', '-Gdpi=144', ...STYLE, '-Tpng', '-o', `${base}.png`, '-Tsvg', '-o', `${base}.svg`, '-Tplain'],
      { stdin: await styled($, source), timeoutMs: 10_000 },
    )
    // `-Tplain` starts with: graph <scale> <width> <height>, in inches.
    const size = /^graph \S+ (\S+) (\S+)/.exec(ran.stdout)
    if (ran.exitCode !== 0 || size === null) return null
    const page = (await writePage($, `${base}.svg`, `${base}.html`)) ? `${base}.html` : null
    return { file: `${base}.png`, page, width: Number(size[1]) + 2 * PAD, height: Number(size[2]) + 2 * PAD }
  } catch {
    return null
  }
}

async function renderSvg($: EngineInterface, source: string): Promise<string | null> {
  try {
    const ran = await $.process.run(['dot', ...STYLE, '-Tsvg'], { stdin: await styled($, source), timeoutMs: 10_000 })
    const start = ran.stdout.indexOf('<svg')
    if (ran.exitCode !== 0 || start < 0) return null
    const svg = ran.stdout.slice(start)
    return svg.length <= 131072 ? svg : null
  } catch {
    return null
  }
}

async function canShowImages($: EngineInterface): Promise<boolean> {
  const program = await $.env.get('TERM_PROGRAM')
  const term = await $.env.get('TERM')
  return IMAGE_TERMINALS.includes(program ?? '') || term === 'xterm-kitty' || term === 'xterm-ghostty'
}

function cached<T>(
  cache: Map<string, Promise<T | null>>,
  source: string,
  render: () => Promise<T | null>,
): Promise<T | null> {
  const key = hash(source)
  let found = cache.get(key)
  if (found === undefined) {
    found = render()
    cache.set(key, found)
    // A failed or interrupted render is tried again on the next draw.
    void found.then(value => {
      if (value === null) cache.delete(key)
    })
  }
  return found
}

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.surfaces.length === 0) return composed
    // Only ask for dot where it becomes a picture; elsewhere Claude draws as before.
    const showsPictures = e.surfaces.some(surface => surface !== 'terminal') || (await canShowImages($))
    if (!showsPictures) return composed

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
    // A tall diagram may fill the whole screen height, but no more.
    const maxRows = (e.viewport?.rows ?? 40) - 2
    let isFirst = e.props.isFirstOfReply
    const drawn: RenderElement[] = []

    for (const part of parts) {
      let picture: RenderElement | null = null
      let fallback = part.kind === 'text' ? part.text : '```dot\n' + part.source + '\n```'

      const isDrawable = part.kind === 'dot' && !READS_FILES.test(part.source)

      if (isDrawable && e.surface === 'terminal') {
        const png = await cached(pngs, part.source, () => renderPng($, part.source))
        if (png !== null && !(await canShowImages($))) {
          // No pictures in this terminal: the source, and a link that opens the diagram.
          fallback += `\n\n[Open the diagram](file://${encodeURI(png.page ?? png.file)})`
        } else if (png !== null) {
          const { Box, Image, Link, Text } = $.ui.resolve(e)
          let columns = clamp(Math.min((png.width * 72) / CELL_WIDTH_PT, maxColumns), 1, 255)
          let rows = clamp(((columns * png.height) / png.width) * CELL_ASPECT, 1, 255)
          if (rows > maxRows) {
            rows = clamp(maxRows, 1, 255)
            columns = clamp((rows * png.width) / png.height / CELL_ASPECT, 1, 255)
          }
          picture = (
            <Box paddingLeft={2} marginY={1} flexDirection="column">
              <Image source={{ file: png.file, format: 'png' }} columns={columns} rows={rows} alt={alt} />
              {png.page !== null && (
                <Text dimColor>
                  <Link href={`file://${encodeURI(png.page)}`}>Open interactive diagram ↗</Link>
                </Text>
              )}
            </Box>
          )
        }
      } else if (isDrawable && e.surface !== 'terminal') {
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
        // Text, or a diagram not drawn as a picture: the engine draws it as usual.
        picture = await next({ ...e, props: { ...e.props, text: fallback, isFirstOfReply: isFirst } })
      }
      drawn.push(picture)
      isFirst = false
    }

    const { Box } = $.ui.resolve(e)
    return <Box flexDirection="column">{drawn}</Box>
  })
}
