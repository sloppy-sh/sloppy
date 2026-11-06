<script lang="ts">
	// The code sheet for a surface that has no project of its own in hand: the
	// draft's review and a build's result — DESIGN.md § "An anchor into code".
	import type { CodeAnchor, OwnedRef } from '@sloppy/types';
	import { api } from '../api.js';
	import { provenanceOver, type NotesSource } from '../code-provenance.js';
	import { fileAddress, filesUnder, textIn } from '../project-code.js';
	import { runtime } from '../runtime.js';
	import CodePreview from './code-preview.svelte';

	let {
		open = $bindable(false),
		anchor,
		notes = api,
		onOpenNote,
		onReachable
	}: {
		open?: boolean;
		anchor: CodeAnchor | null;
		/** Told whether the project's code is beside the notes here, which is where a
		 *  place is worth offering at all. */
		onReachable?: (is: boolean) => void;
		/** Where the notes reaching the file are read from. */
		notes?: NotesSource;
		onOpenNote?: (note: OwnedRef) => void;
	} = $props();

	let project = $state.raw<Awaited<ReturnType<typeof runtime.project>> | null>(null);

	$effect(() => {
		let asking = true;
		void runtime.project().then(
			(found) => {
				if (asking) project = found;
			},
			() => {
				if (asking) project = undefined;
			}
		);
		return () => {
			asking = false;
		};
	});

	$effect(() => {
		onReachable?.(!!project);
	});

	/** Read afresh each time the sheet opens. */
	const why = $derived(open ? provenanceOver(notes) : undefined);

	const openWhereFilesOpen = $derived.by(() => {
		const folder = project;
		const opens = runtime.openExternal();
		if (!folder || !opens) return undefined;
		return async (path: string) => {
			await opens(fileAddress(folder.root, path));
		};
	});
</script>

{#if project}
	{@const folder = project}
	<CodePreview
		bind:open
		{anchor}
		read={(path) => textIn(folder, path)}
		list={(path) => filesUnder(folder, path)}
		{...openWhereFilesOpen === undefined ? {} : { openWhereFilesOpen }}
		{...why === undefined ? {} : { why }}
		{...onOpenNote === undefined ? {} : { onOpenNote }}
	/>
{/if}
