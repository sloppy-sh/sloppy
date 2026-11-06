# Results

Run records, appended and never rewritten; `../README.md` § "The record" is the shape, and grades
written after a run sit in `grades/`. Every batch committed here gets a row below, newest first, so a
reader can tell what produced a number. The rows for the batches on the subjects before the final
test went with their records (`../README.md` § "Revisions", 2026-11-06), and the batches since have
none yet.

| results file                                                         | who ran it                                                | date       | machine (model, OS, CPU, memory)              | backend and version | model                      | subject at                                                                                                                                                                  | command and seed                                                                                                                                                                                                                                        | differed from the protocol                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------- | ---------- | --------------------------------------------- | ------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

A row, filled in:

```
| claude-code-sonnet-2026-11-02.jsonl | <name> | 2026-11-02 | <machine> | claude-code 2.1.311 | sonnet | <path> at <full sha> | node bench.mjs run --backend claude-code --model sonnet --reps 5 --seed 41 --budget-usd 20 | nothing |
```

The judge's grades for that file go in the same row's last column: which judge, which model, and
the grades file it wrote.

What each run was sent is in its record's `sent`, and its stream in
`transcripts/<run_id>.jsonl.gz`, written as the run happens (`../README.md` § "What a run was sent,
and what it did"). A run that never started has neither.

`summary.json` and `figures/*.svg` are drawn from every results file here and its grades, never
edited by hand: run `node bench.mjs export` after adding a batch or its grades, and commit what it
writes with them (`../README.md` § "The export").
