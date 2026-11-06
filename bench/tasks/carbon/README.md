# The Carbon pack

Ten tasks over Carbon (`subjects/carbon.json`), the carbon-language/carbon-lang repository: the
language's design and its C++ toolchain, about 630,000 lines of C++, Carbon, Python and Starlark,
much of it the toolchain's test data. Every key and fact names in `sources` the sentence it comes
from, and every one of those cites Carbon's design documents **at `0b7059a360`**, the commit the
survey measured (`survey/measured-large.json`).

| task                                 | family  | tools | graded by             | decision written                                  |
| ------------------------------------ | ------- | ----- | --------------------- | ------------------------------------------------- |
| `carbon-why-diagnostic-sorting`      | why     | read  | facts, then the judge | #6699 on 2026-02-11, implemented in #6687         |
| `carbon-why-charliteral-difference`  | why     | read  | facts, then the judge | #7314 on 2026-06-09                               |
| `carbon-why-clang-irgen`             | why     | read  | facts, then the judge | #6641 on 2026-02-13                               |
| `carbon-why-orphan-scopes`           | why     | read  | facts, then the judge | #7140 on 2026-06-02                               |
| `carbon-locate-bracket-recovery`     | locate  | read  | files, then the judge | #7574 on 2026-08-19                               |
| `carbon-locate-diagnostic-rendering` | locate  | read  | files, then the judge | #7668 on 2026-09-11, implemented in #7683 (10-15) |
| `carbon-drift-trailing-directives`   | drift   | read  | facts, then the judge | #7441 on 2026-07-03                               |
| `carbon-brief-safety`                | brief   | read  | the judge             | #5914 on 2025-08-20                               |
| `carbon-handoff-bracket-region`      | handoff | edit  | facts, then the judge | a reason given only to stage A                    |
| `carbon-handoff-locked-cache-age`    | handoff | edit  | facts, then the judge | a reason given only to stage A                    |

The dates are those of the commit that added the document (`git log --follow --diff-filter=A`),
whose subject names the pull request; Carbon's proposals carry no date of their own, and their file
name is the pull request's number. Every one is after 2025-06-01, so none of these decisions can be
answered from memory. There is no change task: grading one needs Carbon's own tests run, which this
pack does not do.

## The base commit

`0b7059a360` is the tip of Carbon's `trunk` when the survey measured it. The container is committed
on `sloppy/notes`, one commit on top of it (`44dff037`) that adds `.sloppy/` and `.mcp.json` and
changes nothing else, so every quote, path and patch here holds there unchanged. Run the pack with
`--sha 44dff037`; `--sha 0b7059a360` runs the same tasks with no container.

## The tasks

- `carbon-why-diagnostic-sorting`, from `proposals/p006699-diagnostic-sorting.md` and
  `toolchain/docs/diagnostics.md` § SortingConsumer: sorted by the last processed token, because
  emitted order runs phase by phase and pure line and column puts a consequence before its cause;
  ties at one token would be non-deterministic, so on-scope diagnostics are sorted by start
  position.
- `carbon-why-charliteral-difference`, from
  `proposals/p007314-charliteral-difference-should-be-an-intliteral.md`: `IntLiteral` where the char
  redesign said `i32`, for consistency with other literals and to keep the prelude's layering;
  `char - char` stays `i32`.
- `carbon-why-clang-irgen`, from `proposals/p006641-clang-irgen-in-carbon.md`: Clang lowers
  progressively, so its code generator is attached during `check` for parity with Clang; a
  background thread, an ASTConsumer that records what lowering needs, and an upstream change were
  rejected.
- `carbon-why-orphan-scopes`, from `proposals/p007140-orphan-rule-for-scopes.md`: the library
  wording let an impl file and other libraries disagree and let an impl escape a generic scope; an
  anchor name's owning declaration must now be in the same file, in the containing or a nested
  scope.
- `carbon-locate-bracket-recovery`, from `toolchain/docs/lex/mismatched_brackets.md`:
  `FixMismatchedBrackets`, `RegionSearch` and `BeamNode`, and the `CloserRules`, `OpenerRules` and
  `AdvanceRules` tables in `toolchain/lex/mismatched_brackets.cpp`;
  `DiagnoseAndFixMismatchedBrackets` and `ErrorRecoveryBuffer` in `toolchain/lex/lex.cpp`; and
  `mismatched_brackets_eval`.
- `carbon-locate-diagnostic-rendering`, from `toolchain/docs/diagnostics_rendering.md`:
  `Diagnostics::Renderer` in `toolchain/diagnostics/renderer.cpp` drawing into `Terminal::Buffer`,
  `StreamConsumer`, `Terminal::Capabilities::Detect` in `common/terminal/capabilities.cpp`, and the
  `diagnostic-snippets` flag in `toolchain/driver/driver.cpp`. The document also names a
  `--no-diagnostic-line-numbers` flag that the driver does not define at `0b7059a360`, so the task
  does not ask for it. All paths and names in both locate keys were checked to exist at
  `0b7059a360`.
- `carbon-drift-trailing-directives` plants `fixtures/drift/carbon-trailing-directives.patch`:
  `Lexer::LexComment` loses its `if (!is_trailing)` guard, so a `//@...` tooling directive after code
  on the same line is acted on, and the comment above it says so. The rule it breaks is in
  `p007441-trailing-comments.md` (§ Details, "Lexical rule"): directives are recognized only as
  full-line comments, and a trailing `//@` is a reserved, invalid comment. No test pinned the old
  rule, so none is changed. The patch was checked with `git apply --check` at `0b7059a360` only;
  Carbon's tests were not run on it. Its verdict fact counts only in an answer that also names the
  directive, so a bare "no" earns nothing, and a negated verdict word ("does not contradict") earns
  nothing either; "matches its intent", "consistent with" and "handled correctly" are forbidden.
- `carbon-brief-safety`, from `docs/design/safety/README.md` and
  `proposals/p005914-updating-carbon-s-safety-strategy.md`: narrow `unsafe`, Strict and Permissive
  Carbon, the memory safety model against Rust's, data races, build modes and the overhead targets.
  Judged only.

## How the pack was written

From the documents and the code, before and without reading the Sloppy notes. The tasks are asked
the way a developer on Carbon would ask them, and none names a document. Each `facts` task was
scored with `lib/grade.mjs` against at least three correct answers in other words, among them one
that negates a wrong claim, which must score 1, and two wrong answers, among them answers that use
the right vocabulary for a wrong claim, which must score at most a third; each prompt given as its
own answer scores 0:

```
carbon-why-diagnostic-sorting  correct: 1.00 1.00 1.00 1.00
carbon-why-diagnostic-sorting  wrong:   0.00 0.00
carbon-why-charliteral-difference  correct: 1.00 1.00 1.00 1.00
carbon-why-charliteral-difference  wrong:   0.20 0.20
carbon-why-clang-irgen  correct: 1.00 1.00 1.00
carbon-why-clang-irgen  wrong:   0.00 0.00 0.00
carbon-why-orphan-scopes  correct: 1.00 1.00 1.00 1.00
carbon-why-orphan-scopes  wrong:   0.00 0.00
carbon-drift-trailing-directives  correct: 1.00 1.00 1.00
carbon-drift-trailing-directives  wrong:   0.00 0.00 0.20 0.20 0.20 0.20
carbon-handoff-bracket-region  correct: 1.00 1.00
carbon-handoff-bracket-region  wrong:   0.00 0.00
carbon-handoff-locked-cache-age  correct: 1.00 1.00 1.00
carbon-handoff-locked-cache-age  wrong:   0.00 0.00 0.00 0.33 0.00
```

## The conditions on this subject

`docs` is what the survey counted as decision documents: the 189 top-level proposals under
`proposals/` (the folder goes whole, with its scripts and figures), `docs/design` (58 files),
`toolchain/docs` (18), and from `docs/project` the goals, the principles, the evolution and FAQ pages
and `difficulties_improving_cpp.md` (16) — 281 Markdown files, about 620,000 words — plus
`AGENTS.md` and `README.md`. The user guides (`docs/guides`), the specification (`docs/spec`) and
`docs/project`'s process and governance pages are not among them and are not carried, so every
condition keeps them. `pointed` is `AGENTS.md` and three central documents: the goals, the design
overview and the toolchain overview. `dump` is `AGENTS.md` and then the design documents most often
linked from the repository's other Markdown files, as many as fit about 150,000 tokens (7 files,
about 600 KB, `docs/design/generics/details.md` alone 268 KB).

## Handoff tasks

Two `handoff` tasks, `carbon-handoff-*`, written against `44dff037` (README.md § "Handoff tasks" in
`bench/`). Each gives stage A a small change and a reason found nowhere in the project, and asks
stage B something that turns on it. Their facts cite `prompt_a`, the only place the reason is
written; `test/handoff-tasks.test.mjs` checks each against right and wrong answers, that stage B is
never told it, and that it is new to the project at that commit.
