import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const REPLY = 'Here is the flow:\n\n```dot\ndigraph { a -> b }\n```\n\nDone.'

const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

// Stands in for Graphviz (`-Tplain` answers a 4x2 inch graph, `-Tsvg` a tiny
// SVG) and for the engine's own reply drawing (a Markdown of the text).
function fakeDot(on: On, { exitCode = 0, terminal = 'ghostty' } = {}) {
  mock.env(on, { HOME: '/Users/test', TERM_PROGRAM: terminal })
  on('process.run', (_$, e) => {
    const isSvg = e.argv.includes('-Tsvg')
    return {
      value: {
        exitCode: e.argv[0] === 'dot' ? exitCode : 0,
        stdout: e.argv[0] === 'dot' ? (isSvg ? SVG : 'graph 1 4 2\nstop\n') : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return Markdown({ text: e.props.text })
  })
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

test('a terminal without pictures gets the source and a link to the PNG', async ($, on) => {
  fakeDot(on, { terminal: 'Apple_Terminal' })
  const ui = await $.ui.mount({ plugin: 'graphmod', surface: 'terminal', component: 'AssistantMessage', props: PROPS })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: 'file:///Users/test/.cache/graphmod/' })).toBeDefined()
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
