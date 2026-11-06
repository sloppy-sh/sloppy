# The LLVM pack

Ten tasks over llvm/llvm-project (`subjects/llvm.json`), about 55 million lines of C++, C, MLIR,
Fortran and the rest. Every key and fact names in `sources` the sentence it comes from, and every
one of those cites LLVM's documents or code **at `c60156bd5b`**, the commit the survey measured
(`survey/measured-large.json`).

| task                                | family  | tools         | graded by             | decision written                                             |
| ----------------------------------- | ------- | ------------- | --------------------- | ------------------------------------------------------------ |
| `llvm-why-ai-tool-policy`           | why     | read          | facts, then the judge | #154441 on 2026-01-16, Bazel exception #183408 on 2026-03-05 |
| `llvm-why-mlir-tokens`              | why     | read          | facts, then the judge | #195640 on 2026-06-02                                        |
| `llvm-why-fir-assert`               | why     | read          | facts, then the judge | #228502 on 2026-10-12, the op in #231245 on 2026-10-16       |
| `llvm-why-lfi-sandbox`              | why     | read          | facts, then the judge | #167061 on 2025-12-16, PAC deferral #207915 on 2026-07-15    |
| `llvm-locate-key-instruction-atoms` | locate  | read          | files, then the judge | #137991 on 2025-07-15                                        |
| `llvm-locate-cir-abi-lowering`      | locate  | read          | files, then the judge | 2026-03-06 (d32ffdea7a), revised in #188617 on 2026-04-08    |
| `llvm-drift-signature-never-writes` | drift   | read          | facts, then the judge | #206804 on 2026-07-22                                        |
| `llvm-brief-clangir`                | brief   | read          | the judge             | 2025-12-06 to 2026-04-14 (#166457, #177625, #190354)         |
| `llvm-handoff-debuginfod-timeout`   | handoff | edit, history | facts, then the judge | the reason is new; see below                                 |
| `llvm-handoff-gdb-remote-timeout`   | handoff | edit, history | facts, then the judge | the reason is new; see below                                 |

The dates are the commit that added the document, or the passage the task turns on, read from
`git log` on its path (and on the `.rst` it was renamed from, since most of these documents moved
to Markdown in 2026 and a rename's date says nothing about when the decision was written). Every
one is after 2025-06-01. There is no change task: grading one needs LLVM's own tests run, which
this pack does not do.

## The base commit

`c60156bd5b` is the tip of `main` when the survey measured it. The container is committed on
`sloppy/notes` as one commit, `79fd19a6`, that adds `.sloppy/` and `.mcp.json` and changes nothing
else, so every quote, path and patch here holds there unchanged. Run the pack with `--sha 79fd19a6`;
`--sha c60156bd5b` runs the same tasks with no container.

The notes are carried by `carry-docs.mjs` (SURVEY.md § "How their documents become notes"): 563
documents and 46 folder notes, 1,283,487 words, 577 code links, on top of the notes `sloppy init`
wrote; `PDB/GlobalStream.md` and `PDB/PublicStream.md` were skipped as empty. The survey recorded
its selection as a rule, not a list, so it was applied again: the `.md` and `.rst` files under
`llvm/docs`, `clang/docs`, `flang/docs`, `mlir/docs`, `libc/docs`, `libcxx/docs` and `lldb/docs`,
less the survey's exclusions (`CommandGuide/`, release notes, getting-started and how-to pages, FAQ,
the testing guide, coding standards, tutorials, `LangRef.md`, `*Usage.md`, `*Manual.md`,
`ClangFormatStyleOptions`, `TableGen/ProgRef`, the analyzer checker list) and, to come near its
count, the lldb user pages in `lldb/docs/use/`, the `Reference` and `UserGuides` index pages, the
Discourse, meetup and conduct-reporting guides, and the `.rst` files that are left (status tables
and man pages, which `carry-docs.mjs` does not read). Flang's meeting notes, which record decisions,
stay in. That is 565 files and
1,283,626 words against the survey's 564 and 1,267,800.

## The tasks

- `llvm-why-ai-tool-policy`, from `llvm/docs/AIToolPolicy.md`: a human in the loop who reviews
  generated output before asking for review, because unreviewed output is an extractive
  contribution and a contribution should be worth more than its review; agents acting without
  human approval and review bots without human review are banned, good first issues are off
  limits as learning opportunities, and tool use is labelled (Assisted-by:).
- `llvm-why-mlir-tokens`, from `mlir/docs/Tokens.md`: never forwarded so a use always walks back to
  its op, SSA so the def-use machinery is reused, excluded from `AnyType` so nothing takes one by
  accident, and kept out of `IsolatedFromAbove` regions so they can be processed concurrently, with
  a symbol reference in an attribute instead.
- `llvm-why-fir-assert`, from `flang/docs/InlineRuntimeChecks.md`: inlining drops the runtime's
  checks (different behaviour at -O0 and -O2, out-of-bounds access); `fir.if` plus a call has no
  data dependence, unknown memory effects and no noreturn; `cf.assert` writes the default resource
  and aborts with `puts`; guarded results make SSA dominance enforce the order. The op exists at
  `c60156bd5b` but nothing emits it yet, and the forbidden fact catches an answer that says it does.
- `llvm-why-lfi-sandbox`, from `llvm/docs/LFI.md`: rewrites in the assembler to cover hand-written
  and inline assembly, the x30 guard deferred so PAC authentication runs first, and the 4GiB aligned
  sandbox from base-plus-`uxtw` guards over full 64-bit pointers (stores-only mode, host pointers).
- `llvm-locate-key-instruction-atoms`, from `llvm/docs/KeyInstructionsDebugInfo.md`:
  `mapAtomInstance` in `llvm/lib/Transforms/Utils/CloneFunction.cpp`, `RemapSourceAtom` in
  `llvm/lib/Transforms/Utils/ValueMapper.cpp`, `NextAtomGroup` in `llvm/lib/IR/LLVMContextImpl.h`,
  and Clang's `ApplyAtomGroup` and `addInstTo*SourceAtom` under `clang/lib/CodeGen`.
- `llvm-locate-cir-abi-lowering`, from `clang/docs/CIR/ABILowering.md`: `ABITypeMapper` and
  `ABIRewriteContext` under `mlir/include/mlir/ABI`, `CIRABIRewriteContext` under
  `clang/lib/CIR/Dialect/Transforms/TargetLowering/`, the `CallConvLowering` pass in
  `CallConvLoweringPass.cpp`, and the library in `llvm/lib/ABI`. All paths and names in both locate
  keys were checked to exist at `c60156bd5b`.
- `llvm-drift-signature-never-writes` plants `fixtures/drift/llvm-signature-never-writes.patch`:
  `SemanticSignatureElement::getNeverWritesMask` now returns `~UsageMask & getDeclaredMask()`, so
  the mask is cut down to the element's own declared columns. The rule it breaks is in
  `DirectX/SemanticSignatures.md` § "Derived Container Fields" (`NeverWrites = ~UsageMask & 0xF`,
  and "The output mask includes components outside the declared mask"), so an output element that
  does not cover its whole register row now reports the components it never declared as written,
  while an element declaring four columns at column 0 is unaffected, which is what keeps the
  change quiet. The expectation that pinned the rule, `MetadataToElementDerivedMasks` in
  `llvm/unittests/Frontend/HLSLSemanticSignatureMetadataTest.cpp`, was changed with it, so the
  test is not the intent. The container tests under `llvm/test/CodeGen/DirectX/ContainerData/`
  still carry the documented `ExclusiveMask` values and were left alone, so the drift can also be
  caught by working those out by hand, and an answer that names them in place of the document is
  credited for where the behaviour is written. The patch was checked with `git apply --check`
  against scratch copies of the two files at `c60156bd5b` only; LLVM was not built and its tests
  were not run on it. Its verdict fact and its document fact each count only in an answer that
  also names the planted difference the right way round — the complement cut down to the element's
  declared columns, or the components outside them now reported as written — so a bare "no", the
  right document behind a wrong claim, and the drift read backwards each earn nothing.
- `llvm-brief-clangir`, from `clang/docs/CIR/index.md` and the three design documents beside it:
  what CIR is and how it is enabled, why CIRGen mirrors classic codegen and how divergence is
  caught, the cleanup and EH representation and its lowering stages, and calling-convention
  lowering. Judged only.

## How the pack was written

From the documents and the code, before and without reading the Sloppy notes. The tasks are asked
the way a developer on LLVM would ask them, and none names a document. Each `facts` task was scored
with `lib/grade.mjs` against three correct answers in other words, which must score 1, and at least
two wrong answers, among them answers that use the right vocabulary for a wrong claim, which must
score at most a third. Each prompt was scored too, and states none of its facts (0.00 for every
task). The wrong answers include an uninformed guess in the project's vocabulary: an AI-policy
answer of the kind any model writes without reading `AIToolPolicy.md`, and, for each handoff task,
a plausible reason with none of stage A's facts in it. The drift task's eleven are a verdict that
the accessor is fine, a bare "no" behind the right document, five defects in the project's
vocabulary that the accessor does not have, and four that read the drift backwards and offer the
narrowed mask as the rule; two of those state the consequence a right answer states and hang it on
the wrong code, and the forbidden facts are what take their score back. Its thirteen right answers
and eleven wrong ones are kept in `test/fixtures/drift-answers.json`, where `test/grading.test.mjs`
holds the grader to them. The correct ones include negations of the forbidden claims ("nothing in
lowering emits fir.assert yet", "it no longer works as intended"):

```
llvm-why-ai-tool-policy  correct: 1.00 1.00 1.00
llvm-why-ai-tool-policy  wrong:   0.00 0.00 0.00
llvm-why-mlir-tokens  correct: 1.00 1.00 1.00
llvm-why-mlir-tokens  wrong:   0.00 0.00
llvm-why-fir-assert  correct: 1.00 1.00 1.00
llvm-why-fir-assert  wrong:   0.00 0.00
llvm-why-lfi-sandbox  correct: 1.00 1.00 1.00
llvm-why-lfi-sandbox  wrong:   0.00 0.00
llvm-drift-signature-never-writes  correct: 1.00 1.00 1.00 1.00 1.00 1.00 1.00 1.00 1.00 1.00 1.00 1.00 1.00
llvm-drift-signature-never-writes  wrong:   0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00 0.25 0.25
llvm-handoff-debuginfod-timeout  correct: 1.00 1.00 1.00
llvm-handoff-debuginfod-timeout  wrong:   0.00 0.00 0.33
llvm-handoff-gdb-remote-timeout  correct: 1.00 1.00 1.00
llvm-handoff-gdb-remote-timeout  wrong:   0.00 0.00 0.00
```

## The conditions on this subject

`docs` is the seven documentation folders the notes were carried from and `README.md`; LLVM has no
agent instructions file, so `context_links` is empty. `pointed` is `README.md`, the developer
policy, the code generator design and MLIR's rationale. `dump` is `README.md` and then the carried
documents most often cited by the repository's other Markdown and reStructuredText files, as many as
fit about 150,000 tokens (20 files, about 596 KB). The documents the survey left out (the user
guides and references named above) sit in the same folders, so `nodocs` and `notes-only` remove
them too; every condition keeps the rest of the tree.

## Handoff tasks

Two `handoff` tasks, `llvm-handoff-*`, written against `79fd19a6` (README.md § "Handoff tasks" in
`bench/`): the debuginfod fallback timeout in `llvm/lib/Debuginfod/Debuginfod.cpp` and the
gdb-remote packet timeout in `lldb/source/Plugins/Process/gdb-remote/ProcessGDBRemoteProperties.td`.
Each gives stage A a small change and a reason found nowhere in the project, and asks stage B
something that turns on it. Their facts cite `prompt_a`, the only place the reason is written;
`test/handoff-tasks.test.mjs` checks each against right and wrong answers, that stage B is never
told it, and that it is new to the project at that commit.
