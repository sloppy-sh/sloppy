# The MetaState pack

Ten tasks over the MetaState prototype (`subjects/metastate.json`), about 265,000 lines of
TypeScript under `infrastructure/`, `platforms/`, `services/` and `packages/`, with a Docusaurus
site under `docs/docs/` and an agent skill under `skills/w3ds/`. Every key and fact names in
`sources` the sentence it comes from, quoted from the documents **at `b6966b60`**, the upstream
commit the notes (`sloppy/notes`, `d6ece98d`, which changes only `.sloppy/`) and the shaped
documents (`sloppy/shaped`) were both built on.

| task                                | family  | tools         | written from                                            | graded by             |
| ----------------------------------- | ------- | ------------- | ------------------------------------------------------- | --------------------- |
| `metastate-why-rate-limit-ceiling`  | why     | read          | `Infrastructure/eVault.md` § Rate Limiting, 2026-10-12  | facts, then the judge |
| `metastate-why-handshake-evidence`  | why     | read          | `W3DS Protocol/Platform-Authentication.md`, 2026-09-29  | facts, then the judge |
| `metastate-why-company-board`       | why     | read          | `W3DS Protocol/Company-Delegation.md`, 2026-10-09       | facts, then the judge |
| `metastate-why-on-behalf-of`        | why     | read          | `W3DS Protocol/Access-Control.md`, 2026-08-31           | facts, then the judge |
| `metastate-locate-awareness-path`   | locate  | read          | `W3DS Protocol/Awareness-Protocol.md`, 2026-09-15       | files, then the judge |
| `metastate-locate-file-uris`        | locate  | read          | `W3DS Protocol/File-URIs.md`, 2026-05-29                | files, then the judge |
| `metastate-drift-reputation-engine` | drift   | read          | `W3DS Basics/Access-Policy.md`, 2026-08-30              | facts, then the judge |
| `metastate-brief-platform-data`     | brief   | read          | Data Ownership Rules, Web3 Adapter, Awareness, Ontology | the judge             |
| `metastate-handoff-handshake-ttl`   | handoff | edit, history | the reason is new; see below                            | facts, then the judge |
| `metastate-handoff-jwks-timeout`    | handoff | edit, history | the reason is new; see below                            | facts, then the judge |

The dates are the commit that wrote the passage the task turns on (`git log -S` on its path).
There is no change task: the subject's tests were not run here.

## The tasks

- `metastate-why-rate-limit-ceiling`: the Registry signs a token for any platform name, so the
  name is self-declared; the IP limit is the ceiling, so headroom means raising or exempting the
  platform's server IPs; a name block is advisory, so stopping a caller means blocking its IPs.
- `metastate-why-handshake-evidence`: `issuerJwksUri` comes from the deployment under test, which
  could otherwise point at keys it controls and certify itself, so keys come from the trusted
  issuer's own JWKS; the challenge is spent whether or not the chain holds, so a captured response
  cannot be replayed; evidence is presented so the verifier needs only public endpoints, never the
  read access the deployment is asking for.
- `metastate-why-company-board`: the eVault enforces none of the delegation model and the verifier
  decides from signatures and history; unsigned versions are ignored; the 2,000-version bound makes
  flooding a denial of service, never a takeover; the board must be in the first version so an
  existing company cannot be claimed by whoever adds directors first.
- `metastate-why-on-behalf-of`: `X-ON-BEHALF-OF` is an assertion, not a proof, and that is
  deliberate (specificity, and a platform that can write can already act as its users); it cannot
  escape a denial, which also matches the carrying platform.
- `metastate-locate-awareness-path`: `CREATE_AWARENESS_OUTBOX` in evault-core's `db.service.ts`,
  `AwarenessOutboxDispatcher`, the awareness service's `IngestService` and `SubscriptionMatcher`
  (the requesting platform dropped by origin), and `DeliveryEngine` with `deliveryRetryWindowMs`.
- `metastate-locate-file-uris`: the `uploadFile` resolver and `MAX_FILE_BYTES` in
  `graphql-server.ts`, `FILE_SCHEMA_ID` in `w3ds-uri.ts`, `GET /files/:metaEnvelopeId` in
  `http/server.ts`, `parseFileUri` and `dereferenceFileUri` in web3-adapter, and the `__file()`
  directive in `mapper.ts` uploading through `referenceFileValue`. All names were checked to exist
  at `b6966b60`.
- `metastate-brief-platform-data`: the eVault as source of truth and the reconstructability test,
  `handleChange` through the Web3 Adapter, awareness delivery and what a webhook receiver owes it,
  and what an entity type needs before it is persisted. Judged only.

## The drift task

`metastate-drift-reputation-engine` plants `fixtures/drift/metastate-reputation-engine.patch`. In
`authorize` (`packages/auth/src/platform/authorize.ts`) the guard
`!reading || reading.engine !== policy.reputationEngine` becomes `!reading`, so a reputation score
from any engine is weighed against the owner's `minimumReputation`; the refusal message and the
score message were rewritten to agree, and the test that pinned the rule in `authorize.spec.ts`
now expects a score of 99 from another engine to be allowed. The rule is written only in
`W3DS Basics/Access-Policy.md`: "A score from an engine the owner did not name counts as no score
at all." The denial code `reputation-engine-not-accepted` is left as it was, still used for a
missing reading. Every other line of `authorize`, `permittedDomains`, `evaluateGrants` and
`policy.ts` was read and agrees with the documents. The patch was checked with `git apply --check`
against `b6966b60`, `d6ece98d` and the shaped branch; the subject's tests were not run on it.

Every required fact of the drift grader counts only in an answer that also states the planted
difference the right way round (a score from an engine the owner did not name now weighed), and
the intent and document facts only together with the rule (it counts as no score and is refused).
Three forbidden facts take back a verdict that nothing is wrong, a rule stated backwards, and the
code described as refusing other engines.

**Repaired after the first batch, before judging.** Nine of the eighteen stored answers scored 0 while
stating the drift correctly: they put the engine first — "a score of 99 from any engine passes", "a score
from any engine counts" — where the gate wanted the verb first ("it accepts any engine"), or stated the
rule as the denial it calls for ("deny when `reading.engine !== policy.reputationEngine`") rather than as
"counts as no score". The gate and the rule fact were widened to those phrasings, with the windows
allowed to cross the dot in an identifier, and every stored answer was re-graded under the repaired
grader, the grades appended as `results/grades/objective-metastate-drift-reputation-engine-regrade.jsonl`
(a later grade wins), and the phrasings added to `test/fixtures/drift-answers.json`. All eighteen now
score 1; the suite's wrong answers still score 0 and 0.25. SURVEY.md § "The seventh project, measured"
carries the figures before and after.

## Handoff tasks

Two `handoff` tasks, as in `bench/README.md` § "Handoff tasks": `DEFAULT_TTL_MS` in
`packages/auth/src/platform/handshake.ts` (Brightwater Civic's operator-approved HSM) and
`JWKS_FETCH_TIMEOUT_MS` in `infrastructure/evault-core/src/core/auth/registry-token.ts`
(Kilnworth Cooperative's Registry scaled to zero overnight). Their facts cite `prompt_a`;
`test/handoff-tasks.test.mjs` checks each reason is new to the subject at `b6966b60`.

## Writing them

From the documents and the code at `b6966b60`, without reading the notes. No prompt names the
document that answers it. Each objective grader was scored with `lib/grade.mjs` against right
answers in other words, one of them markdown with headings and a fenced block, and wrong ones: an
uninformed guess, right vocabulary behind wrong claims, and for the drift a "nothing is wrong", a
wrong place, and the drift read backwards. The answers are kept in `test/fixtures/why-answers.json`,
`drift-answers.json` and `handoff-answers.json`, where the suite holds the grader to them:

```
metastate-why-rate-limit-ceiling   right: 1.00 1.00 1.00  wrong: 0.00 0.00 0.25 0.00  prompt: 0.00
metastate-why-handshake-evidence   right: 1.00 1.00 1.00  wrong: 0.00 0.25 0.00 0.00  prompt: 0.00
metastate-why-company-board        right: 1.00 1.00 1.00  wrong: 0.00 0.00 0.00 0.00  prompt: 0.00
metastate-why-on-behalf-of         right: 1.00 1.00 1.00  wrong: 0.00 0.25 0.00 0.00  prompt: 0.00
metastate-drift-reputation-engine  right: 1.00 1.00 1.00 1.00  wrong: 0.00 0.00 0.00 0.00 0.00 0.00 0.25  prompt: 0.00
metastate-handoff-handshake-ttl    right: 1.00 1.00  wrong: 0.00 0.00  prompt_b: 0.00
metastate-handoff-jwks-timeout     right: 1.00 1.00  wrong: 0.00 0.00  prompt_b: 0.00
```
