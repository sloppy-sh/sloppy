<script lang="ts">
	// What the build's sessions said, under the card: each one's turns and acts
	// drawn the way a chat's are, grouped by the session they were said in —
	// DESIGN.md § "A build".
	import type { Build, ChatTurn, ContextUsage, OwnedRef, Ulid } from '@sloppy/types';
	import { SvelteSet } from 'svelte/reactivity';
	import { sessionSaid } from './build-said.js';
	import ChatThread from './chat-thread.svelte';
	import ContextChart from './context-chart.svelte';

	let {
		build,
		turns,
		contextOf,
		onOpen
	}: {
		build: Build;
		/** Every turn the thread holds; each is grouped by the session it was
		 *  said in. */
		turns: readonly ChatTurn[];
		contextOf: (conversation: Ulid) => ContextUsage | null;
		/** Read a note an act left. */
		onOpen: (note: OwnedRef) => void;
	} = $props();

	const sessions = $derived(
		build.sessions.map((one) => ({
			...one,
			title: one.task === undefined ? undefined : titleOf(one.task),
			turns: turns.filter((turn) => turn.conversation === one.conversation)
		}))
	);

	/** The sessions whose bands are listed under their bar. */
	const listed = new SvelteSet<Ulid>();

	function titleOf(task: string): string | undefined {
		return build.plan?.tasks.find((one) => one.id === task)?.title;
	}
</script>

<ol class="space-y-4">
	{#each sessions as session (session.conversation)}
		<li data-build-session={session.conversation}>
			<h4 class="text-xs font-medium text-muted-foreground">
				{sessionSaid(session.role, session.title)}
			</h4>
			{#if session.task === undefined}
				{@const usage = contextOf(session.conversation)}
				{#if usage}
					<div class="mt-1">
						<ContextChart
							{usage}
							open={listed.has(session.conversation)}
							onOpenChange={(up) =>
								up ? listed.add(session.conversation) : listed.delete(session.conversation)}
						/>
					</div>
				{/if}
			{/if}
			<div class="mt-1">
				<ChatThread turns={session.turns} done={() => undefined} kept={() => undefined} {onOpen} />
			</div>
		</li>
	{/each}
</ol>
