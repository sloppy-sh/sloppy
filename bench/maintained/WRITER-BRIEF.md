# Writing the substance of a project's component notes

You are writing what a maintainer would write into a knowledge graph about one component each of the
MetaState prototype (Web 3 Data Spaces: a personal eVault with platforms as interchangeable frontends).
The graph today has a note per component that is EMPTY beyond a folder link. The developer's words:
"if a human was making it, they would put something in it … cerberus is a complete overseeing watchdog
over multiple platforms across the ecosystem, pictique and blabsy the sole social systems, and none of
them have anything in their nodes at all." You fix that for the components assigned to you.

## Where things are

- Repository (read only, never modify): the repository named in your assignment.
  Do NOT read or touch anything under `.sloppy/` there.
- The ownership map, with evidence per component (`used_by`, `depends_on`, `evidence`, `docs`):
  `bench/subjects/maintained/<name>-architecture.json` (the map named in your assignment)
  and its readable companion `<name>-architecture.md` beside it. Start from them, then read the code.
- The documents: `docs/docs/**`, `skills/w3ds/reference/*`, each component's README.

## What to write, per component (one JSON entry each)

Read the component's code far enough to say these truthfully, with file paths. Sections, in this order,
each opening with the `## ` heading given, each in markdown, each citing code as `[label](code:path)` or
`[label](code:path#L10-L40)` — paths from the repository root, lines only where you read them:

1. `## What it is` — 2–4 sentences: what it is for in the ecosystem, which layer, who owns it, and the
   one thing a newcomer must know. For a platform: what a person does with it. For a watchdog like
   cerberus: what it watches and why.
2. `## What it does` — the concrete flows, each a bullet with the code that does it: sign-in (W3ID, the
   Registry, platform tokens), what it writes to the eVault and through what (the Web3 Adapter, the
   mapping files), the webhooks it receives, the jobs it runs, what it serves.
3. `## How it is built` — stack (framework, database, queue), the folders (`api/`, `client/`…), entry
   points, configuration (env names and what each is for), how it runs (compose service, port).
4. `## What it talks to` — `uses X for Y` and `used by X for Y`, one bullet each, with the evidence
   path (take the map's `used_by`/`depends_on` and verify or correct it from the code).
5. `## The records it maps` — for platforms and services: the ontology schemas read and written, with
   the mapping file (`mapping/*.json` or wherever it is). For a record note: its fields, who writes
   it, who reads it, and the schemaId.
6. `## Quirks, gaps and open questions` — what the code does that the documents do not say, drift
   between a copy and the pattern it was copied from, a TODO, a hard-coded URL, a missing piece. With
   evidence. If you looked and found none, write "None found after reading <what you read>."
   Length: a real page per component, 250–600 words of prose plus the lists; not a stub, not an essay.

Tags for each component: keep the ones in the map's `graph.notes[].tags` and ADD function tags —
what the component is for, in one lowercase word each (the kind of words a maintainer filters by:
`storage`, `scheduling`, `auth`, `codegen`, `parsing`, `networking`, `testing`, `tooling`, `shared`,
`copied`…), reusing a word already used on another component before coining one; list the new
words in your report.

## Rules

- Evidence or nothing. Every claim about behaviour names the file. Where the code and a document
  disagree, say so and follow the code. Where you cannot tell, write that you cannot.
- Names are the project's: eVault, W3ID, eName, Registry, Web3 Adapter, Awareness (AaaS), PPA.
- No marketing, no filler. Plain, specific, a maintainer's voice.
- Never write into the repository or the graph. Your only output is the JSON file named in your
  assignment, with this shape:

```json
[
  {
    "about": "<the component path exactly as the map names it>",
    "tags": ["…"],
    "line_fixes": [],
    "sections": [
      "## What it is\n\n…",
      "## What it does\n\n- …",
      "## How it is built\n\n…",
      "## What it talks to\n\n- uses …",
      "## The records it maps\n\n…",
      "## Quirks, gaps and open questions\n\n…"
    ]
  }
]
```

- Where the map's `used_by` / `depends_on` is wrong by the code, do not just say so in the report:
  add a `line_fixes` list to your JSON entry — `{ "off": ["<this component>", "<other>"] }` to take a
  line away, `{ "on": ["<this component>", "<other>"], "label": "uses|used by|reads|writes|reads and writes|implements|specified by", "direction": "to|from" }`
  to draw or relabel one — so the graph is corrected mechanically.
- Report at the end: the components written, word counts, new tag words you needed, the line fixes,
  and anything you could not settle.
