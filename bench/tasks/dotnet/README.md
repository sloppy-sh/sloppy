# The .NET runtime pack

Ten tasks over dotnet/runtime (`subjects/dotnet.json`), about 11 million lines of C#, C++ and C.
Every key and fact names in `sources` the sentence it comes from, and every one of those cites the
runtime's documents or code **at `51ab64509a`**, the commit the survey measured
(`survey/measured.json`).

| task                                     | family  | tools         | graded by             | decision written                                                                               |
| ---------------------------------------- | ------- | ------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `dotnet-why-r2r-macho`                   | why     | read          | facts, then the judge | #120584 on 2025-10-30, Mach-O emitter #121186 on 2025-11-13, symbol name #126515 on 2026-04-06 |
| `dotnet-why-com-properties`              | why     | read          | facts, then the judge | #128869 on 2026-06-17                                                                          |
| `dotnet-why-illink-cache`                | why     | read          | facts, then the judge | #135065 on 2026-10-14, extended #135066/#135067 on 2026-10-20 and #135886 on 2026-10-29        |
| `dotnet-why-async-inlining`              | why     | read          | facts, then the judge | #131538 on 2026-08-14                                                                          |
| `dotnet-locate-async-inlining`           | locate  | read          | files, then the judge | #131538 on 2026-08-14                                                                          |
| `dotnet-locate-external-memory-handles`  | locate  | read          | files, then the judge | #133986 on 2026-09-29                                                                          |
| `dotnet-drift-component-resolver-order`  | drift   | read          | facts, then the judge | #132247 on 2026-08-25, implemented #133570 on 2026-10-07 and #135460 on 2026-10-13             |
| `dotnet-brief-cdac`                      | brief   | read          | the judge             | 2026-04-18 to 2026-09-23 (#127020, #131281, #131858, #134072)                                  |
| `dotnet-handoff-expect-continue-timeout` | handoff | edit, history | facts, then the judge | the reason is new; see below                                                                   |
| `dotnet-handoff-watcher-buffer`          | handoff | edit, history | facts, then the judge | the reason is new; see below                                                                   |

The dates are the commit that added the document, or the passage the task turns on, read from
`git log` on its path. Every one is after 2025-06-01. There is no change task: grading one needs the
runtime's own tests, which need a full native and managed build of the tree, and this pack does not
run them.

## The base commit

`51ab64509a` is the tip of `main` when the survey measured it. The container is committed on
`sloppy/notes` as one commit, `5f21d6e3`, that adds `.sloppy/` and `.mcp.json` and changes nothing
else, so every quote, path and patch here holds there unchanged. Run the pack with `--sha 5f21d6e3`;
`--sha 51ab64509a` runs the same tasks with no container.

The notes are carried by `carry-docs.mjs` (SURVEY.md § "How their documents become notes"): 262
documents and 13 folder notes, 579,021 words, 254 code links, on top of the notes `sloppy init`
wrote; no document was skipped. The selection is the survey's: the `.md` files under
`docs/design/{coreclr,mono,libraries,features,specs,security,datacontracts,tools}`, less the mono
man page (`mono/mono-manpage-1.md`) and the ECMA-335 augments (`specs/Ecma-335-Augments.md`), which
the survey named as reference rather than rationale. That is 262 files against the survey's 264
before those two were taken out; the survey's 601,481 words count them in.

## The tasks

- `dotnet-why-r2r-macho`, from `docs/design/coreclr/botr/readytorun-platform-native-envelope.md`:
  managed code in `__TEXT,__managedcode` because the linker treats `__text` specially (and it matches
  NativeAOT); RVAs as subtractor relocations from `__mh_dylib_header`, since Mach-O has no image base
  the way COFF and PE do, and that symbol sits at the `dladdr` base and points to the Mach header that
  bounds reads; the host loads the image (dlopen or statically linked) and caches it; the header
  symbol is renamed so several directly linked images do not collide. The document also says a failed
  host callback falls back to IL and the JIT, while `NativeImage::Open` fails fast off Windows, so the
  task does not ask about failure.
- `dotnet-why-com-properties`, from `docs/design/libraries/ComInterfaceGenerator/Properties.md`:
  getter slot then setter slot, to match the built-in CCW layout and stay wire-compatible; no
  `propputref`, which has no representation in an `IUnknown`-only vtable; no `init`, a C# call-site
  distinction; a narrow surface rejected with `SYSLIB1091` so it can grow without breaking users; a
  property with bodies is a default-implemented member with no slot.
- `dotnet-why-illink-cache`, from `docs/design/tools/illink/task-cache.md`: the child linker's
  runtime and CoreLib are deliberately not identified, so clear or isolate the storage after a runtime
  change; hits do not replay warnings, so builds gated on them disable caching; arbitrary `ExtraArgs`
  bypass because they can bring undeclared inputs, outputs or side effects. Its forbidden fact
  catches an answer that puts the runtime in the key or has hits replay warnings.
- `dotnet-why-async-inlining`, from `docs/design/coreclr/jit/runtime-async-inlining.md`: inlining
  removes the `ExecutionContext` flow and the captured continuation context; per-frame resumed flags;
  the post-inline call to `AsyncHelpers.RestoreInlinedFrameContexts`, since the JIT cannot switch
  context without posting a callback; worth it because the context almost never changes; awaits that
  may suspend in try regions are still refused. General inlining is on by default
  (`JitAsyncInlining`, 1), and the document's "Special cases" line saying only inlinees that never
  suspend are supported describes the earlier state; the forbidden fact catches an answer that repeats
  it.
- `dotnet-locate-async-inlining`, from the same document: `fgInlineAppendAsyncFrameStatements` and
  `fgSetupAsyncFrameTransitionCall` in `src/coreclr/jit/fginline.cpp`,
  `AsyncHelpers.RestoreInlinedFrameContexts` in `AsyncHelpers.CoreCLR.cs`,
  `GT_CONTINUATION_MEMBER_OFFSET` replaced in `AsyncTransformation::Run`, and
  `CreateInlinedFrameSuspensionTail` and `SaveAsyncContexts` in `src/coreclr/jit/async.cpp`.
- `dotnet-locate-external-memory-handles`, from `docs/design/datacontracts/ExternalMemoryHandles.md`
  and the commit that added it: `ExternalMemoryHandle` in `src/coreclr/vm/externalmemoryhandle.*`, the
  scan in `src/coreclr/vm/gcenv.ee.cpp`, the descriptor in `datadescriptor.inc`, `IExternalMemoryHandles`
  and `ExternalMemoryHandles_1` under `src/native/managed/cdac/`, and `WalkExternalMemoryHandles` in
  `src/coreclr/debug/daccess/dacdbiimpl.cpp`. The document names the contract and its descriptors but
  not these files. All paths and names in both locate keys were checked to exist at `51ab64509a`.
- `dotnet-drift-component-resolver-order` plants
  `fixtures/drift/dotnet-component-resolver-order.patch`: `ComponentLoadContext.AddComponent` now puts
  the newest component's resolver first, with a new comment saying the most recently loaded component
  is consulted first. The rule it breaks is in `docs/design/features/native-hosting-load-context.md`
  ("Resolvers are queried in the component load order — the first one wins."), so a component loaded
  later into a shared context overrides which copy of a dependency resolves for the ones before it. No
  test was changed with it. The patch was checked with `git apply --check` against a scratch copy of
  the file at `51ab64509a` only; the runtime's tests were not run on it. Its verdict fact counts only in
  an answer that also speaks of the resolver, the order, precedence or what comes first, so a bare "no"
  earns nothing.
- `dotnet-brief-cdac`, from `docs/design/datacontracts/datacontracts_design.md` and the documents
  beside it: what data contracts are and what they replace, the contract descriptor, string version
  identifiers and the amendment and release-freeze rules, and the advisory reader version. Judged only.

## How the pack was written

From the documents and the code, before and without reading the Sloppy notes. The tasks are asked
the way a developer on the runtime would ask them, and none names a document. Each `facts` task was
scored with `lib/grade.mjs` against three or four correct answers in other words, which must score 1,
and at least two wrong answers, among them answers that use the right vocabulary for a wrong claim,
which must score at most a third. Each prompt was scored too, and states none of its facts (0.00 for
every task). The wrong answers include an uninformed guess in the project's vocabulary (an
async-inlining answer about state machines and allocations, an ILLink answer about timestamps and
incremental builds) and, for each handoff task, a plausible reason with none of stage A's facts in
it. Negations of each forbidden claim ("the runtime version is not part of the cache key", "it no
longer only inlines callees that never suspend", "Mach-O does not natively support RVAs") were
checked to score 1 with the rest of a right answer. The drift task's wrong answers include ones that
name the document and deny any deviation, divergence or contradiction, and the illink task's right
answers include ones that give the runtime reason without naming CoreLib or roll-forward:

```
dotnet-why-r2r-macho  correct: 1.00 1.00 1.00
dotnet-why-r2r-macho  wrong:   0.00 0.00
dotnet-why-com-properties  correct: 1.00 1.00 1.00
dotnet-why-com-properties  wrong:   0.00 0.00
dotnet-why-illink-cache  correct: 1.00 1.00 1.00 1.00 1.00 1.00 1.00
dotnet-why-illink-cache  wrong:   0.25 0.00 0.00 0.00 0.00
dotnet-why-async-inlining  correct: 1.00 1.00 1.00
dotnet-why-async-inlining  wrong:   0.00 0.00 0.00
dotnet-drift-component-resolver-order  correct: 1.00 1.00 1.00 1.00 1.00 1.00 1.00
dotnet-drift-component-resolver-order  wrong:   0.00 0.00 0.00 0.00 0.00 0.00 0.25 0.00
dotnet-handoff-expect-continue-timeout  correct: 1.00 1.00 1.00 1.00 1.00
dotnet-handoff-expect-continue-timeout  wrong:   0.00 0.00 0.33
dotnet-handoff-watcher-buffer  correct: 1.00 1.00 1.00
dotnet-handoff-watcher-buffer  wrong:   0.00 0.00 0.00
```

## The conditions on this subject

`docs` is `docs/design`, the folder the notes were carried from, and `README.md`; the runtime has no
agent instructions file, so `context_links` is empty. `docs/design` holds only the eight folders the
survey counted, so `nodocs` and `notes-only` remove exactly the carried documents plus the two left
out and the images beside them. The rest of `docs/` (workflow, coding guidelines, project and issue
guides) is not design writing and stays in every condition. `pointed` is `README.md`, the Book of the
Runtime index, the RyuJIT overview and the data contracts design. `dump` is `README.md` and then the
carried documents most often cited by the repository's other Markdown files, as many as fit about
150,000 tokens (25 files, about 600 KB).

## Handoff tasks

Two `handoff` tasks, `dotnet-handoff-*`, written against `5f21d6e3` (README.md § "Handoff tasks" in
`bench/`): the 100-continue timeout default in
`src/libraries/Common/src/System/Net/Http/HttpHandlerDefaults.cs` and the default buffer size in
`src/libraries/System.IO.FileSystem.Watcher/src/System/IO/FileSystemWatcher.cs`. Each gives stage A a
small change and a reason found nowhere in the project, and asks stage B something that turns on it.
Their facts cite `prompt_a`, the only place the reason is written; `test/handoff-tasks.test.mjs`
checks each against right and wrong answers, that stage B is never told it, and that it is new to the
project at that commit.
