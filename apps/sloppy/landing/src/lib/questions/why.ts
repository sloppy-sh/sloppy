// Why the better of With Sloppy and the docs alone scored higher on each task of the final test,
// read from the judge's notes and the representative answers. Keyed by the outcome it explains, so
// a re-export that flips a task shows no reason rather than a wrong one.

export const WHY: Record<string, { winner: 'mcp' | 'bare' | 'level'; why: string }> = {
	'gitlab-brief-cells': {
		winner: 'bare',
		why: 'Docs alone named doc/development/fixed_items_model.md and the rule that static data gets fixed ids in code; With Sloppy left both out and barely said an organization must be movable between cells. Neither said Cells is GitLab.com-only.'
	},
	'gitlab-drift-state-precedence': {
		winner: 'mcp',
		why: 'Both found that unarchive now returns [:archived, :deletion_scheduled, :maintenance] and pointed to namespaces_state_propagation.md. Docs alone then wondered if the doc was stale and the change deliberate; With Sloppy treated the doc as the intent and the rewritten comments as untrustworthy.'
	},
	'gitlab-handoff-chatops-timeout': {
		winner: 'level',
		why: "Both kept the 12-minute timeout for the same reason: Kestrel Bank's self-managed instance syncs trace sections every 10 minutes. Both found it in the commit message and the comment in chat_notification_worker.rb."
	},
	'gitlab-handoff-design-upload-cap': {
		winner: 'mcp',
		why: "With Sloppy recommended keeping MAX_FILES at 6 until the F5 load balancer's 64 MB limit is dealt with. Docs alone found the same commit but recommended going back to 10 and asking the customer to raise the limit. Close: one With Sloppy run left out Halvorsen's name."
	},
	'gitlab-locate-cells-claims': {
		winner: 'mcp',
		why: 'Close. Both named Cells::Claimable and its callbacks, Cells::BulkClaimsWorker with build_destroy_metadata_for_worker, and the two verification workers plus VerificationService. The gap is run-to-run noise in how much unverified extra detail each answer added.'
	},
	'gitlab-locate-retention-check': {
		winner: 'bare',
		why: 'Close. Both named db/docs/data_retention/, Gitlab::Database::RetentionPolicy and the definitions spec with its allowlist. With Sloppy lost a little more for citing added_tables.rb and Danger paths it had not opened.'
	},
	'gitlab-why-cells-claims': {
		winner: 'bare',
		why: 'Neither mentioned scoping uniqueness with the sharding key. With Sloppy also only implied that the verification service fixes drift, and its "three things claimed" framing was slightly off, so Docs alone kept a small lead.'
	},
	'gitlab-why-fixed-items': {
		winner: 'mcp',
		why: 'Close. Docs alone gave a path for the Plan model that could not be confirmed. With Sloppy cited fixed_items_model.md but not the Cells static-data doc. The two half-point losses nearly cancel out.'
	},
	'gitlab-why-retention-strategy': {
		winner: 'level',
		why: 'Both covered the dead tuples, the table that never shrinks, the WAL and replica load, the near-free partition detach, and the 50 GB and narrow-table exceptions. Both cited data_retention_policy.md.'
	},
	'gitlab-why-state-propagation': {
		winner: 'mcp',
		why: 'Docs alone claimed archiving does not propagate to descendants and found no design note. With Sloppy cited ADR 003 and namespaces_state_propagation.md, the outbox row in the same transaction, the cron worker that re-enqueues stalled rows, and the precedence that leaves a deletion-scheduled subgroup alone.'
	},
	'milvus-brief-query-views': {
		winner: 'bare',
		why: 'Both covered the bottleneck reason, the DataView and QueryView versions, the state machine, and that nothing serves production yet. With Sloppy called the Proxy two-phase and QueryNode delete path still planned, and tied the README \u00a71\u20132 citation to the reason only loosely.'
	},
	'milvus-drift-ewma-seed': {
		winner: 'mcp',
		why: 'Close. Both found it now seeds when the smoothed service time is 0 instead of on metricExpireInterval expiry, gave the 20-versus-4 outlier example, and cited the 20261019 look-aside balancer design doc. Neither warned that the comment and tests were rewritten. The gap is run-to-run.'
	},
	'milvus-handoff-aggregation-levels': {
		winner: 'mcp',
		why: "Both kept 5 for Nordwind Retail's five-level catalogue grouping. With Sloppy stated as fact that validation at five levels stays under 2 ms, while Docs alone dismissed that figure as unverified."
	},
	'milvus-handoff-pin-cleanup': {
		winner: 'mcp',
		why: 'Both kept 20 seconds because of the 6 to 9 second pin release on etcd spread across three zones. One Docs alone answer left out Ostrava and the availability zones, which cost it on the facts check.'
	},
	'milvus-locate-s3-auth-guard': {
		winner: 'bare',
		why: 'Close. Both named GuardedS3EndpointProvider, InstallS3EndpointAuthGuard and MinioChunkManager::PreCheck. With Sloppy also named a second test file, test_minio_endpoint_auth.cpp, and BuildS3Client helpers that could not be confirmed.'
	},
	'milvus-locate-wal-chunking': {
		winner: 'mcp',
		why: "Close. Both named SplitIntoChunks, appendWithOptionalChunking, ChunkAssembler in scanner_switchable.go and streaming.splitChunkSN, off by default. Docs alone hedged on the produce-server guard; With Sloppy's extras (AssembleChunks, AdvanceTimeTick, proxy.splitChunk) all checked out."
	},
	'milvus-why-autoid-upsert': {
		winner: 'bare',
		why: 'Close. Both explained the Delete(P) plus Insert(G) split across VChannels, the three row outcomes, and why a key that is not found gets an allocator ID, citing the 20260803 design doc. One With Sloppy run dropped a point.'
	},
	'milvus-why-import-v3': {
		winner: 'mcp',
		why: "Close. Both described the single read into sorted fragments, the k-way merge into one segment, and the off-by-default enableImportV3 gate, citing the 20260921 design doc. With Sloppy tied V2's growing hashed_stats more completely to the etcd request limit."
	},
	'milvus-why-metacache-by-id': {
		winner: 'mcp',
		why: 'With Sloppy gave the real reason from the 20260716 metacache design doc: id- and alias-driven invalidations forced a full linear scan under the global write lock, stalling the proxy at around 1M collections. Docs alone explained fillMu correctly but missed that reason and never cited the doc.'
	},
	'milvus-why-rg-shard-leaders': {
		winner: 'mcp',
		why: "With Sloppy cited the 20260824 per-resource-group design doc and PR #52716, and said the response tag leaves the proxy's shard-leader cache and its invalidation unchanged. Docs alone cited only proto comments and code, and skipped the invalidation point."
	},
	'pulsar-brief-scalable-topics': {
		winner: 'bare',
		why: "Docs alone listed the Stream, Queue and Checkpoint consumers and pointed to spec/scalable-topics; With Sloppy read only PIP-460's opening, admitted it could not name the consumer types and never named the spec directory."
	},
	'pulsar-drift-v1-topic-names': {
		winner: 'mcp',
		why: "Close: both found the cluster being dropped against PIP-457. With Sloppy also said the constructor's comment and TopicNameTest line 115 had been rewritten to match the bug; Docs alone treated the comment as merely describing the behaviour."
	},
	'pulsar-handoff-coalesced-bytes': {
		winner: 'level',
		why: 'Both recommended keeping 16 KiB and found the Marlow Exchange reason in the commit and the comment beside the constant: a TLS-inspecting appliance adding about 3 ms per extra 16 KiB record, tripling p99 at 64 KiB.'
	},
	'pulsar-handoff-consumer-race-retries': {
		winner: 'mcp',
		why: 'Both found the Brightline Rail load-balancer drain of up to 10 seconds in the commit, then doubted it against internalAddConsumer. Docs alone went on to recommend reverting to 5; With Sloppy hedged instead of siding with the reviewer.'
	},
	'pulsar-locate-metadata-threads': {
		winner: 'mcp',
		why: 'Close, and the representative answers scored the same: both named the -event, -scheduler and -worker executors, chooseThread(path) and metadataStoreSerDesThreads, and both missed the -batch-flusher thread. One Docs-alone run slipped to 0.875.'
	},
	'pulsar-locate-topic-list-memory': {
		winner: 'bare',
		why: 'Close. Both named TopicListMemoryLimiter, ServerCnx, TopicListService, LookupProxyHandler and the two maxTopicListInFlight settings, but one With Sloppy run fell to 0.82; it worked from grep output without opening the files.'
	},
	'pulsar-why-close-inactive': {
		winner: 'mcp',
		why: 'With Sloppy cited PIP-470 (pip/pip-470.md) as the source of the reasoning. Docs alone cited only code and ServiceConfiguration, and wrongly said inactivity requires no producers as well as no subscriptions.'
	},
	'pulsar-why-etcd': {
		winner: 'bare',
		why: "Both gave the findProvider error, PIP-462 and the jetcd reasons. With Sloppy added a guess that etcd once failed confusingly or fell back to ZooKeeper, and two of its three runs used wording the facts check reads as 'etcd still works'."
	},
	'pulsar-why-json-schema': {
		winner: 'mcp',
		why: 'With Sloppy named AutoConsumeSchema, GenericJsonSchema and AvroBaseStructSchema as the Java consumers the lenient fallback broke, and credited PIP-464 for that reason; Docs alone named neither class and left the reasoning mostly unsourced.'
	},
	'pulsar-why-recycler': {
		winner: 'mcp',
		why: "Close: both cited CODING.md and PIP-443 with the 7x and 13x benchmark. Docs alone lost a little for unverifiable extras, such as its claim that there is no metric for the Recycler's CPU cost."
	},
	'llvm-brief-clangir': {
		winner: 'mcp',
		why: 'With Sloppy covered the Microsoft EH lowering and personality functions, and said that sharing refactors are deferred, both from the CIR design documents. Docs alone left those out and added unverifiable claims, such as AArch64 not being done.'
	},
	'llvm-drift-signature-never-writes': {
		winner: 'bare',
		why: 'All three named the exact change — getNeverWritesMask now returns ~UsageMask & getDeclaredMask() where it is meant to return ~UsageMask & 0xF — and cited llvm/docs/DirectX/SemanticSignatures.md for the rule. The gap is whether a run committed to the document: five of six With Sloppy runs hedged that the document might be stale or the narrowing deliberate, where four of six docs-alone runs said plainly that the unit test had been changed to match the code.'
	},
	'llvm-handoff-debuginfod-timeout': {
		winner: 'mcp',
		why: 'Both found the Harrowgate caching proxy and its 110-150 second cold fetches. With Sloppy kept firmly to 180 and cited commit c112fe045; Docs alone hedged that 90 was a fair revert, and one of its runs fell to 0.85.'
	},
	'llvm-handoff-gdb-remote-timeout': {
		winner: 'mcp',
		why: 'Close: both found the Velmora serial-over-IP bridge (about 1.5 s per round trip) in the commit and advised keeping 15 s. Both missed the 6-8 second attach figure in the facts check, and one Docs-alone run scored slightly lower.'
	},
	'llvm-locate-cir-abi-lowering': {
		winner: 'mcp',
		why: "With Sloppy placed the shared classification code in llvm/lib/ABI and gave ABITypeMapper's .cpp file. Docs alone named only llvm/ABI/Types.h and hedged on the .cpp location, failing the check for llvm/lib/ABI."
	},
	'llvm-locate-key-instruction-atoms': {
		winner: 'mcp',
		why: "With Sloppy named CodeGenFunction::addInstToCurrentSourceAtom in Clang's CodeGen. Docs alone put addInstToCurrentSourceAtom on CGDebugInfo and missed the CodeGenFunction wrapper; both found mapAtomInstance, RemapSourceAtom and NextAtomGroup."
	},
	'llvm-why-ai-tool-policy': {
		winner: 'bare',
		why: 'Both representative answers scored full marks from llvm/docs/AIToolPolicy.md: human in the loop, extractive contributions, and good first issues kept for learning. One With Sloppy run dropped to 0.9; all three Docs-alone runs were perfect.'
	},
	'llvm-why-fir-assert': {
		winner: 'mcp',
		why: 'Close: both explained the fir.if and cf.assert gaps from flang/docs/InlineRuntimeChecks.md, and both cited PR #223287 rather than #228502 and #231245. The small gap is run-to-run variance, with one Docs-alone run at 0.93.'
	},
	'llvm-why-lfi-sandbox': {
		winner: 'bare',
		why: 'Close: both drew all three reasons from llvm/docs/LFI.md. With Sloppy added an unsupported claim that the assembler is the right place to enforce a safe instruction subset; Docs alone marked its own inference as inference.'
	},
	'llvm-why-mlir-tokens': {
		winner: 'level',
		why: 'Both explained from mlir/docs/Tokens.md that a token must always lead back to the op it came from, why AnyType excludes tokens, the reuse of SSA def-use, and why tokens cannot cross IsolatedFromAbove.'
	},
	'carbon-brief-safety': {
		winner: 'mcp',
		why: 'Close. With Sloppy stated the build modes and overhead targets cleanly (spatial 1-2%, temporal under 1%, no default RC or GC), while Docs alone opened by claiming the safety documents disagree and added a bounds-check opt-out the design does not describe.'
	},
	'carbon-drift-trailing-directives': {
		winner: 'level',
		why: 'Both found the missing is_trailing check before the //@ directive checks, cited proposals/p007441-trailing-comments.md as the rule and ignored the rewritten code comment; each had one run that scored lower.'
	},
	'carbon-handoff-bracket-region': {
		winner: 'level',
		why: "Both recovered the full reason from the comment in mismatched_brackets.cpp and the commit message: Kestrel Robotics' 3,200-item generated declarations, the greedy fallback turning about 400 declarations into class members, and 11 ms at 4,000 items."
	},
	'carbon-handoff-locked-cache-age': {
		winner: 'level',
		why: 'Both found the Brightwater build daemon that holds its runtimes entry locked for up to three weeks, the eviction at 10 days and the failed links, citing the comment in runtimes_cache.h and the commit.'
	},
	'carbon-locate-bracket-recovery': {
		winner: 'level',
		why: 'Both named FixMismatchedBrackets, RegionSearch and BeamNode, the CloserRules/OpenerRules/AdvanceRules tables, Lexer::DiagnoseAndFixMismatchedBrackets with ErrorRecoveryBuffer, and mismatched_brackets_eval; both lost a little on line numbers that could not be confirmed.'
	},
	'carbon-locate-diagnostic-rendering': {
		winner: 'mcp',
		why: 'With Sloppy named Terminal::Buffer in common/terminal/buffer.h as what Renderer draws into. Docs alone said it draws into Terminal::OutputBufferRef in output_buffer_ref.h, missing the buffer type entirely.'
	},
	'carbon-why-charliteral-difference': {
		winner: 'bare',
		why: "Close, one run's worth. Both gave IntLiteral, the consistency and layering reasons and char - char staying i32; With Sloppy also claimed char - char was originally i32 to match the literal difference, which p007314 does not say."
	},
	'carbon-why-clang-irgen': {
		winner: 'mcp',
		why: 'Both gave the progressive-lowering reason and all three rejected options from p006641 and clang_api.md. Docs alone added claims it could not back, such as a generate_ast.cpp line and Swift and LLDB comparisons, and one of its runs scored 0.87.'
	},
	'carbon-why-diagnostic-sorting': {
		winner: 'mcp',
		why: "With Sloppy used the proposal's F(1 2) missing-comma example and said ties at a scope's closing brace, like unused x and y, would otherwise be non-deterministic and break golden tests. Docs alone cited a TODO in scope_stack.cpp that does not appear to exist."
	},
	'carbon-why-orphan-scopes': {
		winner: 'bare',
		why: "Docs alone scored 0.93 to 0.96 on every run, naming both holes and the same-file anchor rule. With Sloppy's typical answer was as good or better, but one of its three runs fell to 0.73, which pulled its mean down."
	},
	'dotnet-brief-cdac': {
		winner: 'bare',
		why: 'Docs alone stated the versioning rules more fully: string versions that are only different, never newer, and what is fixed from the first release candidate. With Sloppy was vaguer on versioning and added details it had not checked, such as a magic value and a cdac.h path.'
	},
	'dotnet-drift-component-resolver-order': {
		winner: 'mcp',
		why: 'Both caught the prepended resolver ([resolver, .. _resolvers]) against native-hosting-load-context.md. With Sloppy also gave the consequence, a two-component shared Foo.dll example where the later component overrides the earlier one, which Docs alone never spelled out.'
	},
	'dotnet-handoff-expect-continue-timeout': {
		winner: 'mcp',
		why: "Docs alone recommended going back to 1 second and dismissed the Quillmere gateway's 1.4 to 2.2 second answer as one deployment's quirk. With Sloppy kept that reason in view: multi-gigabyte uploads due a 401 being sent in full, then sent again on retry."
	},
	'dotnet-handoff-watcher-buffer': {
		winner: 'mcp',
		why: "With Sloppy took the reason from the commit message: 2,000 to 3,000 renames in about a second overflowing 8 KB, Error raised, finished jobs never picked up. Docs alone's typical answer used its own estimates instead. Neither named Tarnwick, and both wavered on the recommendation."
	},
	'dotnet-locate-async-inlining': {
		winner: 'mcp',
		why: "With Sloppy gave full paths and named fgSetupAsyncFrameTransitionCall alongside fgInlineAppendAsyncFrameStatements. Docs alone left out fgSetupAsyncFrameTransitionCall and gave bare file names under a 'src/coreclr/jit/ unless noted' preface, so fginline.cpp and async.cpp were never given with their paths."
	},
	'dotnet-locate-external-memory-handles': {
		winner: 'bare',
		why: 'Close. Both named ExternalMemoryHandle, gcenv.ee.cpp, datadescriptor.inc, the cDAC contract files and DacRefWalker::WalkExternalMemoryHandles; With Sloppy said it had not opened externalmemoryhandle.cpp or DacRefWalker::Next, and lost a fraction on that.'
	},
	'dotnet-why-async-inlining': {
		winner: 'bare',
		why: 'Docs alone listed everything still not inlined: awaits that may suspend in try regions, and awaits into a non-async root. With Sloppy named only the try regions, and one of its runs dropped to 0.87.'
	},
	'dotnet-why-com-properties': {
		winner: 'level',
		why: 'Both scored full marks: getter then setter to match the built-in CCW layout, propputref existing only in type library metadata and IDispatch, init being a C#-only distinction, SYSLIB1091 for rejected shapes, and default-implemented properties for wrapping two methods.'
	},
	'dotnet-why-illink-cache': {
		winner: 'level',
		why: 'Both found all three behaviours intended in task-cache.md, the runtime deliberately left out of the cache key, hits not replaying warnings, and arbitrary ExtraArgs bypassing the cache, and each lost the same small amount for claims beyond the doc.'
	},
	'dotnet-why-r2r-macho': {
		winner: 'level',
		why: 'Both scored full marks from readytorun-platform-native-envelope.md: __managedcode because the linker treats __text specially, RVAs as subtractor relocations against __mh_dylib_header, the host doing the load, and the export rename for custom hosts.'
	},
	'metastate-brief-platform-data': {
		winner: 'bare',
		why: "Docs alone named Data Ownership Rules, the Web3 Adapter and the Awareness Protocol and said the event is committed with the data; With Sloppy worked from the skill's reference pages and the webhook guide, never said the event is committed with the data, and claimed the sources disagree on delivery. Both ran long for 'as briefly as you can'."
	},
	'metastate-drift-reputation-engine': {
		winner: 'mcp',
		why: 'Close. Both found the dropped engine check and pointed to Access-Policy.md. One Docs alone run read the rewritten test in authorize.spec.ts as if it stated the intent.'
	},
	'metastate-handoff-handshake-ttl': {
		winner: 'level',
		why: "Both kept the five-minute TTL and gave the reason stage A had left: Brightwater Civic's HSM waits for operator approval."
	},
	'metastate-handoff-jwks-timeout': {
		winner: 'level',
		why: "Both kept the 12-second timeout for Kilnworth Cooperative's Registry, which scales to zero overnight, and neither reached for the 5 seconds vault-access-guard.ts uses."
	},
	'metastate-locate-awareness-path': {
		winner: 'bare',
		why: 'Docs alone searched the code and named SubscriptionMatcher; With Sloppy described the matching step from the note and never opened the class that does it. Neither gave the backoff schedule.'
	},
	'metastate-locate-file-uris': {
		winner: 'bare',
		why: 'Close. Both named uploadFile with MAX_FILE_BYTES, FILE_SCHEMA_ID, the GET /files/:metaEnvelopeId redirect, parseFileUri and dereferenceFileUri; one With Sloppy run described toGlobal calling referenceFileValue without naming the __file() directive.'
	},
	'metastate-why-company-board': {
		winner: 'mcp',
		why: 'With Sloppy cited Company-Delegation.md and said flooding a record is a denial of service, never a takeover. Docs alone answered from the comments in history.ts, placed the 2,000-version cap in the demo rather than packages/auth, and never named the document.'
	},
	'metastate-why-handshake-evidence': {
		winner: 'mcp',
		why: 'With Sloppy cited Platform-Authentication.md and said the verifier needs only public endpoints. Docs alone reasoned from chain.ts and handshake.ts, claimed the eVault is public so reading it would add nothing, and never named the document.'
	},
	'metastate-why-on-behalf-of': {
		winner: 'bare',
		why: "Docs alone gave the document's reason: specificity is what makes a user grant mean anything. With Sloppy only implied it, and cited the Post Platform Guide's access-control page rather than the protocol's Access-Control.md."
	},
	'metastate-why-rate-limit-ceiling': {
		winner: 'mcp',
		why: 'With Sloppy said the IP limit is the ceiling and the fix is to raise or exempt the server IPs, citing the eVault documentation. Docs alone found the same in global-rate-limiter.ts and cited the code, never the page. Both added figures the documents do not give.'
	}
};
