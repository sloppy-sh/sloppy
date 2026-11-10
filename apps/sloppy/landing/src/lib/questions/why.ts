// Why the better of With Sloppy and the docs alone scored higher on each task of the final test,
// read from the judge's notes and the representative answers. Keyed by the outcome it explains, so
// a re-export that flips a task shows no reason rather than a wrong one.

export const WHY: Record<string, { winner: 'mcp' | 'bare' | 'level'; why: string }> = {
	'gitlab-brief-cells': {
		winner: 'bare',
		why: 'Docs alone named doc/development/fixed_items_model.md and the rule that static data gets fixed ids in code; With Sloppy left both out and barely said an organization must be movable between cells. Neither said Cells is GitLab.com-only.'
	},
	'gitlab-drift-state-precedence': {
		winner: 'bare',
		why: 'Close. Both found that unarchive now returns [:archived, :deletion_scheduled, :maintenance] against namespaces_state_propagation.md, and two runs on each side leaned on the rewritten comments; the With Sloppy ones also hedged that the change might be a deliberate redesign.'
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
		winner: 'bare',
		why: 'Docs alone scored full marks on every run. With Sloppy cited fixed_items_model.md but not the Cells static-data doc, and offered auto_generate_ids! without warning that auto-generated ids must not be stored.'
	},
	'gitlab-why-retention-strategy': {
		winner: 'mcp',
		why: 'Close. Both covered the dead tuples, the table that never shrinks, the WAL and replica load, the near-free partition detach and the exceptions from data_retention_policy.md; one Docs alone run added unsupported specifics such as a web_hook_logs example.'
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
		winner: 'bare',
		why: 'Close. Both found it now seeds when the smoothed service time is 0, against the look-aside balancer design doc; one Docs alone run said the comment had been changed with the code, while one With Sloppy run never addressed the comment or tests at all.'
	},
	'milvus-handoff-aggregation-levels': {
		winner: 'mcp',
		why: "Both kept 5 for Nordwind Retail's five-level catalogue grouping. With Sloppy stated as fact that validation at five levels stays under 2 ms, while Docs alone dismissed that figure as unverified."
	},
	'milvus-handoff-pin-cleanup': {
		winner: 'level',
		why: "Both scored full marks on every run: keep 20 seconds, because releasing a large snapshot's pins on etcd spread across three availability zones takes 6 to 9 seconds."
	},
	'milvus-locate-s3-auth-guard': {
		winner: 'mcp',
		why: 'Close. Both named GuardedS3EndpointProvider, InstallS3EndpointAuthGuard and MinioChunkManager::PreCheck, and both mentioned an unconfirmed second test file; one Docs alone run also hedged on ChunkManager.cpp call sites it had not checked.'
	},
	'milvus-locate-wal-chunking': {
		winner: 'bare',
		why: 'Close. Docs alone scored full marks on every run naming SplitIntoChunks, appendWithOptionalChunking and ChunkAssembler; two With Sloppy runs added unconfirmed extras such as service_param.go and IsChunkedPayload or hedged on the produce-server call.'
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
		winner: 'bare',
		why: 'Close. Every run named the -event, -scheduler and -worker executors and chooseThread(path) and missed the -batch-flusher thread; With Sloppy lost a little more for saying it had not read AbstractBatchedMetadataStore, though one Docs alone run left that class out.'
	},
	'pulsar-locate-topic-list-memory': {
		winner: 'mcp',
		why: 'Close. Both named TopicListMemoryLimiter, ServerCnx, TopicListService, LookupProxyHandler and the maxTopicListInFlight settings, and one run on each side gave the broker and proxy files without their full paths; the rest is noise.'
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
		winner: 'bare',
		why: 'Close. Both named the four CIR documents and the mirroring of classic codegen; With Sloppy called the flatten pass LowerCFG rather than FlattenCFG, two of its runs left out cir.cleanup.scope, cir.try and the Itanium and Microsoft lowering, and it added counts it could not back.'
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
		winner: 'bare',
		why: 'Both found the Velmora serial-over-IP bridge in the commit and advised keeping 15 s. One Docs alone run also gave the 6-8 second attach figure the facts check looks for, which no With Sloppy run did.'
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
		winner: 'level',
		why: 'Both scored full marks on every run from llvm/docs/AIToolPolicy.md: human in the loop, extractive contributions, and good first issues kept for learning.'
	},
	'llvm-why-fir-assert': {
		winner: 'bare',
		why: 'Close: both explained the fir.if and cf.assert gaps from flang/docs/InlineRuntimeChecks.md. One Docs alone run was perfect, while every With Sloppy run tied the design to PR #223287 rather than #228502 and #231245 and never said nothing emits the op yet.'
	},
	'llvm-why-lfi-sandbox': {
		winner: 'level',
		why: 'Both drew all three reasons from llvm/docs/LFI.md, including the uxtw guard against the base in x27, and each lost the same small amount for unverifiable line numbers and extras.'
	},
	'llvm-why-mlir-tokens': {
		winner: 'mcp',
		why: 'Close. Both explained from mlir/docs/Tokens.md why a token must lead back to the op it came from and why AnyType excludes tokens; one Docs alone run added an unsupported claim that FunctionOpInterface bars tokens from function signatures.'
	},
	'carbon-brief-safety': {
		winner: 'level',
		why: 'Level on average. Both named README.md, terminology.md and the p005914 proposal with the build modes and overhead targets; one Docs alone run claimed there are no overhead targets at all, while With Sloppy lost evenly across its runs for running long and not tying the why to a document.'
	},
	'carbon-drift-trailing-directives': {
		winner: 'mcp',
		why: "With Sloppy found the missing is_trailing check against proposals/p007441-trailing-comments.md on all three runs. One Docs alone run took the function's rewritten comment, that a directive counts wherever the // falls, as the intent and missed the change."
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
		winner: 'mcp',
		why: 'Close. Both named FixMismatchedBrackets, RegionSearch and BeamNode, the rule tables, Lexer::DiagnoseAndFixMismatchedBrackets and mismatched_brackets_eval; one With Sloppy run had nothing the judge could not confirm, where every Docs alone run lost a little on line numbers and helper names it admitted not checking.'
	},
	'carbon-locate-diagnostic-rendering': {
		winner: 'mcp',
		why: 'With Sloppy named Terminal::Buffer in common/terminal/buffer.h as what Renderer draws into. Docs alone said it draws into Terminal::OutputBufferRef in output_buffer_ref.h, missing the buffer type entirely.'
	},
	'carbon-why-charliteral-difference': {
		winner: 'mcp',
		why: "Close. Both gave IntLiteral, the consistency and layering reasons and char - char staying i32; one Docs alone run lost more for an arithmetic.md line citation and a quoted 'somewhat arbitrary' that could not be confirmed."
	},
	'carbon-why-clang-irgen': {
		winner: 'mcp',
		why: 'Both gave the progressive-lowering reason and all three rejected options from p006641 and clang_api.md. Docs alone added claims it could not back, such as a generate_ast.cpp line and Swift and LLDB comparisons, and one of its runs scored 0.87.'
	},
	'carbon-why-diagnostic-sorting': {
		winner: 'bare',
		why: 'Both explained last_byte_offset and the on-scope tie-break, and few runs said ties would make golden tests non-deterministic. Two With Sloppy runs also missed the consequence-before-cause reason against plain line and column order, which two Docs alone runs gave, so one near-perfect With Sloppy run could not lift its mean.'
	},
	'carbon-why-orphan-scopes': {
		winner: 'mcp',
		why: 'Close. With Sloppy had one perfect run naming both holes from proposals/p007140-orphan-rule-for-scopes.md, though another never named the generic-scope hole; Docs alone named both on every run but each added an unconfirmed details.md line citation.'
	},
	'dotnet-brief-cdac': {
		winner: 'mcp',
		why: 'Both covered the descriptor, the string versions that are only different and never newer, and the advisory reader version, and both added an unverified reader-version-3 example. With Sloppy more often said which documents it had read for the reasons, datacontracts_design.md among them, where two Docs alone runs gave the documents only as places to look.'
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
		winner: 'bare',
		why: 'Both found the 2,000 to 3,000 renames in about a second overflowing 8 KB, and both wavered on the recommendation. One Docs alone run gave every fact the check looks for, render farm and finished jobs never picked up included, while one With Sloppy run leaned toward reverting and never said where it found the reason.'
	},
	'dotnet-locate-async-inlining': {
		winner: 'mcp',
		why: "With Sloppy gave full paths and named fgSetupAsyncFrameTransitionCall alongside fgInlineAppendAsyncFrameStatements. Docs alone left out fgSetupAsyncFrameTransitionCall and gave bare file names under a 'src/coreclr/jit/ unless noted' preface, so fginline.cpp and async.cpp were never given with their paths."
	},
	'dotnet-locate-external-memory-handles': {
		winner: 'level',
		why: 'Both named ExternalMemoryHandle, gcenv.ee.cpp, datadescriptor.inc, the cDAC contract files and DacRefWalker::WalkExternalMemoryHandles, and each lost the same fraction for line numbers and extras such as dacvars.h that could not be confirmed.'
	},
	'dotnet-why-async-inlining': {
		winner: 'bare',
		why: 'Docs alone listed everything still not inlined: awaits that may suspend in try regions, and awaits into a non-async root. With Sloppy named only the try regions, and one of its runs dropped to 0.87.'
	},
	'dotnet-why-com-properties': {
		winner: 'bare',
		why: 'Close. All runs gave getter then setter to match the built-in CCW layout, propputref living only in type library metadata and IDispatch, and SYSLIB1091; one With Sloppy run did not state the getter-before-setter order plainly enough for the facts check.'
	},
	'dotnet-why-illink-cache': {
		winner: 'mcp',
		why: 'Close. Both found all three behaviours intended in task-cache.md; two With Sloppy runs scored full marks, while every Docs alone run lost a little for unverified extras such as Cache@2 advice and an illink-tasks.md citation.'
	},
	'dotnet-why-r2r-macho': {
		winner: 'mcp',
		why: 'Close. Both explained __managedcode and the subtractor relocations against __mh_dylib_header from readytorun-platform-native-envelope.md; two Docs alone runs added small unsupported claims, such as __mh_dylib_header being right only for dylibs.'
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
		winner: 'mcp',
		why: "Both gave the document's reason. With Sloppy cited the access-control page's section on who the requesting party is, and one Docs alone run claimed group denials fail open and never said the behaviour is deliberate, which cost it on both checks."
	},
	'metastate-why-rate-limit-ceiling': {
		winner: 'mcp',
		why: 'With Sloppy said the IP limit is the ceiling and the fix is to raise or exempt the server IPs, citing the eVault documentation. Docs alone found the same in global-rate-limiter.ts and cited the code, never the page. Both added figures the documents do not give.'
	}
};
