# graphmod

A [Claude Code](https://claude.com/claude-code) mod that turns diagrams in Claude's replies into real pictures.

You ask:

```
❯ draw me a diagram of this repo
```

and the reply shows this, right in the terminal:

![graphmod drawing a diagram of this repo in the terminal](docs/demo.png)

## How it works

1. It adds a short section to the system prompt: "draw diagrams as a ```` ```dot ```` (Graphviz) block, not ASCII art".
2. When a reply has a closed ```` ```dot ```` block, it runs Graphviz and draws the result:
   - terminal with pictures (Ghostty, cmux, kitty, WezTerm): a PNG `Image`,
   - desktop app / VS Code / mobile: an `Svg`.
3. Text around the diagram is drawn by Claude Code as usual. If `dot` fails, you see the source block.
   `ctrl+o` always shows the original reply text.

PNGs are cached in `~/.cache/graphmod/` by content hash.

### Terminals without pictures

Pictures in a terminal need the kitty graphics protocol. The mod checks `TERM_PROGRAM` (`ghostty`, `WezTerm`)
and `TERM` (`xterm-kitty`, `xterm-ghostty`). Anywhere else (Terminal.app, tmux, ssh):

- the system prompt section is not added, so Claude draws diagrams as before;
- a `dot` block that still appears is shown as source, with an "Open the diagram" `file://` link to the PNG.

### Safety

The mod runs only `mkdir` and `dot`, with no network access. The `dot` source comes from Claude's reply, so a
block that would make `dot` read local files (`image=`, `shapefile=`, `imagepath=`, `fontpath=`, or an HTML-label
`<IMG>`) is shown as text and not rendered.

## Requirements

- Claude Code with mods (function hooks) support. Built and tested on `2.1.289`.
  Mods are an early feature; the API may change between Claude Code releases.
- Graphviz, with `dot` on `PATH`: `brew install graphviz`

## Install

This repo is a plugin marketplace with one plugin. Inside Claude Code:

```
/plugin marketplace add ybonda/graphmod
/plugin install graphmod@graphmod
```

Or from a shell:

```
claude plugin marketplace add ybonda/graphmod
claude plugin install graphmod@graphmod
```

Start a new session after installing.

### Update

```
claude plugin marketplace update graphmod
claude plugin update graphmod@graphmod
```

Then run `/reload-plugins` in an open session.

### Uninstall

```
claude plugin uninstall graphmod@graphmod
claude plugin marketplace remove graphmod
```

## Develop

Load a local clone for one session:

```
claude --plugin-dir ~/dev/graphmod
```

Check and test:

```
claude plugin validate ~/dev/graphmod
claude plugin test ~/dev/graphmod
```

The engine writes type declarations into `.claude-plugin/types/` on every load (git-ignored); after one load,
`npx -p typescript tsc -p ~/dev/graphmod` type-checks the mod (the root `tsconfig.json` extends that file).

## Layout

```
.claude-plugin/plugin.json       plugin manifest
.claude-plugin/marketplace.json  one-plugin marketplace ("source": "./")
hooks/hooks.json                 names the hooks module
hooks/register.tsx               the mod: prompt.compose + ui.render(AssistantMessage)
tests/graphmod.test.ts           claude plugin test suite
docs/demo.png                    the picture above
```

## License

[MIT](LICENSE)
