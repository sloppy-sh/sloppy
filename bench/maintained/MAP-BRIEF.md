# The ownership map of a project — brief for the map agent

Read-only analysis of one repository. Modify nothing in it; read nothing under `.sloppy/`. Write
two files, named in your assignment: `<name>-architecture.json` and `<name>-architecture.md`.

## Why

A Sloppy knowledge graph of this project was built by folder shape — a note per folder, documents
hung by path — and the developer ruled it worthless: "if a human was making it, they would put
something in it", and the relations have to be the ones that exist, not the ones file paths imply.
The MetaState map that satisfied the ruling is the model: read
`bench/subjects/maintained/metastate-architecture.json`
(its `layers`, `components`, `graph.sections`, `graph.notes` with `parent_about`, `tags`, `links`)
and `metastate-architecture.md` beside it before you start, and produce the same shape for your
project. Then a second pass of workers writes a page per component from your map.

## Granularity

A component is an architectural unit a maintainer would name — a subsystem, a service, a library, a
tool, a shared contract — not a folder for its own sake. **Name between 25 and 45 components**, the
ones that carry the project's design and the ones the documents are about; fold the rest under them.
For a very large project pick the units the project's own documents and build files name (a
`CMakeLists`/`Cargo`/`go.mod`/gemspec/workspace package, a top-level subproject, a documented
subsystem). Kinds: `subsystem | library | service | tool | contract | pattern | docs | tooling` —
use `contract` for a shared format/protocol/schema several components agree on, `pattern` for code
copied rather than shared.

## Read

The build and workspace files (what depends on what), every subsystem's own README or design page,
the documents under the doc roots named in your assignment (titles and openings are enough for the
map; the code is where the relations are), and enough source to say who imports, calls or includes
whom. For each component: `kind`, `title`, `one_line`, `owner` (the folder or team that owns it,
or `shared`), `layer`, `used_by`, `depends_on`, `evidence` (file paths, lines where cheap), `docs`
(the documents under the doc roots that are about it — every document under the doc roots must be
assigned to exactly one component or section in `graph.notes`), and `logos` (image files in the
repository that are this component's or the project's logo or icon, `.png/.jpg/.gif/.webp` only;
an empty list where none).

## The graph

`layers` (4–7), `graph.sections` (each with `id`, `title`, `parent`, `children`, and a **`place`**:
an existing file in the repository that no note would be started about — a build file, a config, a
`_category_`/index file, never a Markdown document under the doc roots and never a folder — the
rebuild needs a free place to start the section's own note), `graph.notes`: one entry for every
component and every document under the doc roots — `about`, `parent_about` (a component, section
or layer id), `tags` (layer, `owner-<x>` or `shared`, the component's own word; one word each,
lowercase, reused), `links` (`to_about`, `label` from: uses, used by, reads, writes, reads and
writes, implements, implemented by, specified by, documents, copies, part of, serves; `direction`
to|from|none). For a pseudo component (a pattern, a contract with no single file) give it a
`place` as for a section.

## Hand back

The two files, then a report: counts by kind, the shared components and their users, the ten
findings that most contradict the folder-shaped graph with evidence, and what you could not settle.
Evidence or `unknown`; where code and documents disagree, follow the code and say so.
