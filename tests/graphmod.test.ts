import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const REPLY = 'Here is the flow:\n\n```dot\ndigraph { a -> b }\n```\n\nDone.'

const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

// Stands in for Graphviz (`-Tplain` answers a 4x2 inch graph, `-Tsvg` a tiny
// SVG; `gvpr` marks its input as styled, or fails), for the files the mod reads and
// writes (kept in `written`), and for the engine's own reply drawing (a
// Markdown of the text).
function fakeDot(on: On, { exitCode = 0, terminal = 'ghostty', gvprExitCode = 0 } = {}) {
  mock.env(on, { HOME: '/Users/test', TERM_PROGRAM: terminal })
  const runs: { argv: readonly string[]; stdin: string }[] = []
  const written = new Map<string, string>()
  on('process.run', (_$, e) => {
    const stdin = e.init?.stdin ?? ''
    runs.push({ argv: e.argv, stdin })
    const isSvg = e.argv.includes('-Tsvg')
    const isPlain = e.argv.includes('-Tplain')
    if (e.argv[0] === 'dot' && isSvg && exitCode === 0) written.set(e.argv[e.argv.indexOf('-Tsvg') + 2] ?? '', SVG)
    const stdout =
      e.argv[0] === 'gvpr' ? (gvprExitCode === 0 ? '/*styled*/' + stdin : 'not a graph') : e.argv[0] === 'dot' ? (isPlain ? 'graph 1 4 2\nstop\n' : isSvg ? SVG : '') : ''
    return {
      value: {
        exitCode: e.argv[0] === 'dot' ? exitCode : e.argv[0] === 'gvpr' ? gvprExitCode : 0,
        stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('fs.read', (_$, e) => ({ value: e.path.endsWith('page.html') ? '<main><!--SVG--></main>' : (written.get(e.path) ?? '') }))
  on('fs.write', (_$, e) => {
    written.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return Markdown({ text: e.props.text })
  })
  return { runs, written }
}

const PROPS = { text: REPLY, isFirstOfReply: true }

test('a dot fence is drawn as an Image on the terminal', async ($, on) => {
  fakeDot(on)
  const ui = await $.ui.mount({
    plugin: 'graphmod',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: PROPS,
    viewport: { columns: 120, rows: 40 },
  })
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: 'Here is the flow:' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: 'Done.' })).toBeDefined()
})

test('a dot fence is drawn as an Svg on the desktop', async ($, on) => {
  fakeDot(on)
  const ui = await $.ui.mount({ plugin: 'graphmod', surface: 'desktop', component: 'AssistantMessage', props: PROPS })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

test('a reply without a dot fence is left to the engine', async ($, on) => {
  fakeDot(on)
  const ui = await $.ui.mount({
    plugin: 'graphmod',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Just text.', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
})

test('an unclosed fence (still streaming) is not rendered', async ($, on) => {
  fakeDot(on)
  const ui = await $.ui.mount({
    plugin: 'graphmod',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```dot\ndigraph { a -> b', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
})

test('a dot error falls back to the source', async ($, on) => {
  fakeDot(on, { exitCode: 1 })
  const ui = await $.ui.mount({
    plugin: 'graphmod',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: '```dot\nnot a graph\n```', isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: 'not a graph' })).toBeDefined()
})

test('the system prompt gets the diagrams section', async ($, on) => {
  fakeDot(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(composed.sections.at(-1)?.id).toBe('graphmod:diagrams')
})

test('a terminal without pictures gets the source and a link to the diagram', async ($, on) => {
  fakeDot(on, { terminal: 'Apple_Terminal' })
  const ui = await $.ui.mount({ plugin: 'graphmod', surface: 'terminal', component: 'AssistantMessage', props: PROPS })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: 'file:///Users/test/.cache/graphmod/' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: '.html)' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: 'digraph { a -> b }' })).toBeDefined()
})

test('a terminal without pictures does not ask for dot', async ($, on) => {
  fakeDot(on, { terminal: 'Apple_Terminal' })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(composed.sections.map(section => section.id)).toEqual(['intro'])
})

test('dot that reads local files is shown as text, not rendered', async ($, on) => {
  fakeDot(on)
  for (const source of ['digraph { a [image="/etc/hosts"] }', 'digraph { a [label=<<IMG SRC="/x.png"/>>] }']) {
    const ui = await $.ui.mount({
      plugin: 'graphmod',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: '```dot\n' + source + '\n```', isFirstOfReply: true },
    })
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown', text: source })).toBeDefined()
  }
})

test('the picture is styled by gvpr and links to an interactive page', async ($, on) => {
  const { runs, written } = fakeDot(on)
  const ui = await $.ui.mount({ plugin: 'graphmod', surface: 'terminal', component: 'AssistantMessage', props: PROPS })
  const gvpr = runs.find(run => run.argv[0] === 'gvpr')
  expect(gvpr?.argv.at(-1)).toEndWith('/hooks/style.g')
  expect(runs.find(run => run.argv[0] === 'dot')?.stdin).toBe('/*styled*/digraph { a -> b }')
  const page = [...written.keys()].find(path => path.endsWith('.html'))
  expect(page).toStartWith('/Users/test/.cache/graphmod/')
  expect(written.get(page ?? '')).toContain('<svg')
  expect(await ui.find({ type: 'Link' })).toBeDefined()
})

test('a gvpr failure still draws the picture from the plain source', async ($, on) => {
  const { runs } = fakeDot(on, { gvprExitCode: 1 })
  const ui = await $.ui.mount({ plugin: 'graphmod', surface: 'terminal', component: 'AssistantMessage', props: PROPS })
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(runs.find(run => run.argv[0] === 'dot')?.stdin).toBe('digraph { a -> b }')
})
