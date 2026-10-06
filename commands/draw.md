---
description: Draw a diagram as a Graphviz dot picture (no argument redraws the diagrams of the last reply)
argument-hint: "[what to draw]"
---

Use the graphmod `diagrams` skill rules: write each diagram as a fenced ```dot block with one complete `digraph` or `graph`, never ASCII art.

- If this is not empty, draw it: $ARGUMENTS
- If it is empty, take every diagram from your previous reply (ASCII art, box drawings, arrow lists) and redraw each one as a ```dot block. Do not repeat the rest of that reply.
