# Concept templates, part 06 of 43: Per-iteration templates

## Per-Iteration Templates

The template is chosen **per iteration**. Every `<section data-iteration="N">`
MUST carry `data-iteration-template="decision|design|free"` — that attribute is
authoritative:

```html
<html data-template="decision">              <!-- mirrors the ACTIVE iteration -->
  <section data-iteration="1" data-iteration-template="decision" data-active>
  <section data-iteration="2" data-iteration-template="design" hidden>
  <section data-iteration="3" data-iteration-template="decision" hidden>
```

`data-template` on `<html>` stays the single source of truth *for CSS selectors
and JS branches* (`[data-template="design"] …`, `collectDecisions`), but it is a
**projection** of the currently shown iteration, not a page-level constant.
`applyIterationTemplate(section)` writes it on every iteration switch (see
Shared Systems § Tab Switch JS).

Rules:

- Iterations may mix templates freely and in any order — a `decision` round may
  be followed by a `design` round and another `decision` round.
- `prototype` is accepted as a **legacy alias** for `design` and normalised on
  read. Never write it in new pages.
- A missing `data-iteration-template` falls back to the current
  `<html data-template>`, so pages generated before the rename keep working
  unchanged.
- The `<html data-template>` value written at generation time MUST already
  equal the active iteration's (normalised) template — otherwise the first
  paint shows the wrong layout.
- **A page that started as `decision` or `free` keeps its document header**
  (`<h1>` + subtitle inside `.concept-content > header`) and
  its per-iteration `<header class="iteration-intro">` for the rest of its
  life — a later `design` iteration must never delete them, or switching
  back to an earlier round loses its own title. Design mode is
  `position: absolute; inset: 0` and would paint straight over both, so it
  HIDES them in CSS instead: see § Layout CSS → "Document chrome vs. the
  fullscreen canvas" and the frozen-opacity exemption next to it. Both rules
  are mandatory on any page that mixes design with decision/free.

---

