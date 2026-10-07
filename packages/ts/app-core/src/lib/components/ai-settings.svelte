<script lang="ts">
	// Whether an assistant is offered at all, and what this device reaches one
	// through — docs/ARCHITECTURE.md § "Asking a tool to write the notes".
	import { CHAT_AGENTS, type ChatAgent, chatAgentName, chatAgentReach } from '@sloppy/types';
	import type { KeyHeldFor, SealBacking } from '@sloppy/local';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { Switch } from '@sloppy/ui/switch';
	import { runtime } from '../runtime.js';
	import { chat } from '../stores/chat.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';

	const keys = runtime.aiKeys();
	const on = $derived(prefs.current.aiOffered);
	const agents = $derived(chat.agents);

	let held = $state.raw<readonly KeyHeldFor[]>([]);
	let typing = $state<ChatAgent | null>(null);
	let typed = $state('');
	let busy = $state<ChatAgent | null>(null);
	let trouble = $state<string | null>(null);

	async function readHeld(): Promise<void> {
		if (!keys) return;
		held = await keys.held().catch(() => []);
	}

	$effect(() => {
		if (!on) return;
		void readHeld();
		if (chat.agents === null && chat.reaches) void chat.lookForAgents();
	});

	function turn(offered: boolean): void {
		prefs.set('aiOffered', offered);
	}

	function reaches(agent: ChatAgent): boolean {
		return Array.isArray(agents) && agents.includes(agent);
	}

	function heldFor(agent: ChatAgent): SealBacking | undefined {
		return held.find((one) => one.provider === agent)?.backing;
	}

	/** What keeping a key here means, as the person reads it. */
	function keptSaid(backing: SealBacking): string {
		switch (backing) {
			case 'hardware':
				return "A key is kept here, in this device's secure hardware.";
			case 'system':
				return 'A key is kept here, by the system.';
			case 'software':
				return 'A key is kept here.';
		}
	}

	async function keep(agent: ChatAgent): Promise<void> {
		if (!keys) return;
		busy = agent;
		trouble = null;
		try {
			await keys.hold(agent, typed);
			typed = '';
			typing = null;
			await readHeld();
			await chat.lookForAgents();
		} catch (error) {
			trouble =
				error instanceof Error && error.message !== ''
					? error.message
					: 'Sloppy could not keep that key just now. Try again.';
		} finally {
			busy = null;
		}
	}

	async function forget(agent: ChatAgent): Promise<void> {
		if (!keys) return;
		busy = agent;
		trouble = null;
		try {
			await keys.forget(agent);
			await readHeld();
			await chat.lookForAgents();
		} finally {
			busy = null;
		}
	}
</script>

<div class="space-y-4" data-surface="ai-settings">
	<div class="flex items-start gap-3">
		<Switch id="ai-offered" checked={on} onCheckedChange={turn} />
		<div class="min-w-0 flex-1 space-y-1">
			<Label for="ai-offered" class="text-sm font-normal">Work with an assistant</Label>
			<p class="text-xs text-muted-foreground">
				Sloppy can talk with an assistant about the project these notes are about. It reads the code
				and writes notes; what it writes stands in a draft you read whole before any of it lands in
				your folder.
			</p>
		</div>
	</div>

	{#if on}
		<div class="flex items-start gap-3">
			<Switch
				id="ai-elsewhere"
				checked={prefs.current.chatInBackground}
				onCheckedChange={(goes) => prefs.set('chatInBackground', goes)}
			/>
			<div class="min-w-0 flex-1 space-y-1">
				<Label for="ai-elsewhere" class="text-sm font-normal">
					Keep answering while you are elsewhere
				</Label>
				<p class="text-xs text-muted-foreground">
					A chat you leave goes on until it is done, and what it wrote is there when you come back.
					Off, it waits for you.
				</p>
			</div>
		</div>

		<ul class="space-y-3">
			{#each CHAT_AGENTS as agent (agent)}
				{@const name = chatAgentName(agent)}
				{@const backing = heldFor(agent)}
				<li class="space-y-2">
					{#if chatAgentReach(agent) === 'program'}
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
							<p class="text-sm">
								{name}
								<span class="text-muted-foreground">
									· {agents === null
										? 'looking…'
										: reaches(agent)
											? 'on this machine'
											: 'not on this machine'}
								</span>
							</p>
							<Button
								variant="ghost"
								class="h-9 text-xs"
								disabled={agents === null}
								onclick={() => void chat.lookForAgents()}
							>
								Look again
							</Button>
						</div>
					{:else if keys}
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
							<p class="text-sm">
								{name}
								{#if backing !== undefined}
									<span class="text-muted-foreground">· {keptSaid(backing)}</span>
								{/if}
							</p>
							{#if backing !== undefined}
								<Button
									variant="ghost"
									class="h-9 text-xs"
									disabled={busy === agent}
									onclick={() => void forget(agent)}
								>
									Forget it
								</Button>
							{:else if typing !== agent}
								<Button
									variant="outline"
									class="h-9 text-xs"
									onclick={() => {
										typing = agent;
										typed = '';
									}}
								>
									Give a key
								</Button>
							{/if}
						</div>
						{#if typing === agent}
							<form
								class="flex flex-wrap items-center gap-2"
								onsubmit={(event) => {
									event.preventDefault();
									void keep(agent);
								}}
							>
								<Input
									bind:value={typed}
									type="password"
									class="h-control min-w-0 flex-1"
									autocapitalize="none"
									autocomplete="off"
									spellcheck="false"
									aria-label="Key for {name}"
									placeholder="Paste the key"
								/>
								<Button
									type="submit"
									class="h-control"
									disabled={busy === agent || typed.trim() === ''}
								>
									Keep it here
								</Button>
								<Button
									type="button"
									variant="ghost"
									class="h-control"
									onclick={() => {
										typing = null;
										typed = '';
									}}
								>
									Never mind
								</Button>
								<p class="w-full text-xs text-muted-foreground">
									The key stays on this device and is used only to ask {name}.
								</p>
							</form>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>

		{#if trouble}
			<p class="text-sm text-destructive" role="alert">{trouble}</p>
		{/if}

		{#if Array.isArray(agents) && agents.length === 0}
			<p class="text-sm text-muted-foreground" role="status">
				Nothing here can answer yet. Install Claude Code, or give a key above.
			</p>
		{/if}
	{/if}
</div>
