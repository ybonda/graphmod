# graphmode

A Claude Code mod (plugin of function hooks) that turns diagrams in Claude's replies into real pictures.

1. It adds a short section to the system prompt: "draw diagrams as a ```` ```dot ```` (Graphviz) block, not ASCII art".
2. When a reply has a closed ```` ```dot ```` block, it runs Graphviz and draws the result:
   - terminal: a PNG `Image` (Ghostty and kitty show pixels; other terminals show the alt text),
   - desktop app / VS Code / mobile: an `Svg`.
3. Text around the diagram is drawn by Claude Code as usual. If `dot` fails, you see the source block.
   `ctrl+o` always shows the original reply text.

PNGs are cached in `~/.cache/graphmode/` by content hash.

## Requirements

- Claude Code with mods (function hooks) support. Built and tested on `2.1.289`.
- Graphviz: `brew install graphviz` (`dot` must be on `PATH`).

## Install

From GitHub (this repo is also a marketplace):

```
/plugin marketplace add ybonda/graphmode
/plugin install graphmode@graphmode
```

From a local clone, for one session:

```
claude --plugin-dir ~/dev/graphmode
```

## Develop

```
claude plugin validate ~/dev/graphmode
claude plugin test ~/dev/graphmode
```

The engine writes type declarations into `.claude-plugin/types/` on every load (git-ignored); after one load, `npx -p typescript tsc -p ~/dev/graphmode` type-checks the mod (the root `tsconfig.json` extends that file).

## Layout

```
.claude-plugin/plugin.json       plugin manifest
.claude-plugin/marketplace.json  one-plugin marketplace ("source": "./")
hooks/hooks.json                 names the hooks module
hooks/register.tsx               the mod: prompt.compose + ui.render(AssistantMessage)
tests/graphmode.test.ts          claude plugin test suite
```
