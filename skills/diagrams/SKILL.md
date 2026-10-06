---
name: diagrams
description: ALWAYS use this skill before drawing ANY diagram, chart of boxes and arrows, flow, architecture, steps in order, state machine or dependency tree - including when other instructions say "visualize" or "draw a diagram". Diagrams must be a ```dot Graphviz block (one complete digraph or graph), never ASCII art or box-drawing characters; the graphmod plugin turns the block into a picture. Not for text meant for Slack, PRs, Jira, commits or files.
---

# Diagrams (graphmod)

The graphmod plugin draws Graphviz DOT as a picture in the reply. When a diagram helps, write it as a fenced code block tagged `dot` that holds one complete `digraph` or `graph`. Do not draw diagrams with ASCII art or box-drawing characters.

- Label a node `"Title\nshort detail"`: the first line is drawn bold, the second small and monospace (a path, a command, a few words). Keep both short.
- Keep the default top-to-bottom layout. Put each layer in `subgraph cluster_<name> { label="..." }`, 3 to 5 nodes per layer; each cluster gets its own color.
- Do not set colors, fonts or sizes: the plugin styles the picture.
- Do not use `image=`, `shapefile=`, `imagepath=`, `fontpath=` or `<IMG>` in labels: such a block is shown as text, not drawn.
- Tabular data stays a markdown table, not a diagram.
- This is only for replies read here. Text the person will paste elsewhere (Slack, PR, Jira, commit messages) and files you write keep their usual format, with no `dot` blocks.

Example:

```dot
digraph {
  subgraph cluster_client { label="Client"
    ui [label="Web UI\nsrc/app.vue"]
  }
  subgraph cluster_server { label="Server"
    api [label="API\n/api/v1"]
    db  [label="Database\npostgres"]
  }
  ui -> api -> db
}
```
