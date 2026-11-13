<script lang="ts">
	// Whether an assistant is offered at all, what this device reaches one
	// through, and what hears a headset — docs/ARCHITECTURE.md § "Asking a tool
	// to write the notes" and § "A headset beside the desk".
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import {
		CHAT_AGENTS,
		chatAgentName,
		chatAgentReach,
		SPEECH_AGENTS,
		SPEECH_ENDPOINTS,
		type SpeechAgent,
		speechAgentName,
		speechAgentReach
	} from '@sloppy/types';
	import type { KeyHeldFor, KeyProvider, SealBacking } from '@sloppy/local';
	import { Button } from '@sloppy/ui/button';
	import * as DropdownMenu from '@sloppy/ui/dropdown-menu';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { Switch } from '@sloppy/ui/switch';
	import { runtime, type SpeechSystemAllowed } from '../runtime.js';
	import { chat } from '../stores/chat.svelte.js';
	import { prefs } from '../stores/prefs.svelte.js';

	const keys = runtime.aiKeys();
	const hears = runtime.speech() !== undefined;
	const program = runtime.speechProgram();
	const system = runtime.speechSystem();
	const on = $derived(prefs.current.aiOffered);
	const agents = $derived(chat.agents);

	let held = $state.raw<readonly KeyHeldFor[]>([]);
	let typing = $state<KeyProvider | null>(null);
	let typed = $state('');
	let busy = $state<KeyProvider | null>(null);
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

	function reaches(agent: KeyProvider): boolean {
		return Array.isArray(agents) && agents.some((one) => one === agent);
	}

	function heldFor(agent: KeyProvider): SealBacking | undefined {
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

	async function keep(agent: KeyProvider): Promise<void> {
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

	async function forget(agent: KeyProvider): Promise<void> {
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

	let systemHere = $state<boolean | null>(null);
	let systemAllowed = $state<SpeechSystemAllowed | null>(null);
	let microphoneAllowed = $state<SpeechSystemAllowed | null>(null);
	let allowing = $state(false);
	/** Whether this computer may record the person and hear them, both of which
	 *  the chat's microphone needs. */
	const mayListen = $derived.by(() => {
		if (systemAllowed === null || microphoneAllowed === null) return null;
		const both = [microphoneAllowed, systemAllowed];
		if (both.every((one) => one === 'authorized')) return 'yes';
		if (both.some((one) => one === 'denied' || one === 'restricted')) return 'no';
		return 'not yet';
	});

	const speechAgents = $derived(
		SPEECH_AGENTS.filter((agent) => {
			switch (speechAgentReach(agent)) {
				case 'system':
					return systemHere === true;
				case 'program':
					return program !== undefined;
				case 'key':
					return true;
			}
		})
	);
	/** Nothing chosen is this computer's own, wherever it can hear. */
	const speaking = $derived(
		speechAgents.find((agent) => agent === (prefs.current.speechAgent ?? 'system')) ?? null
	);
	const speechModels = $derived(
		speaking === null ? [] : (SPEECH_ENDPOINTS[speaking]?.models ?? [])
	);
	const speechModel = $derived(
		speaking === null ? undefined : (prefs.current.speechModel[speaking] ?? speechModels[0])
	);
	const modelFile = $derived(prefs.current.speechProgramModel);

	let programHere = $state<boolean | null>(null);
	let choosingFile = $state(false);

	function speechAgentSaid(agent: SpeechAgent | null): string {
		if (agent === null) return 'Nothing';
		return speechAgentReach(agent) === 'program'
			? 'A program on this computer'
			: speechAgentName(agent);
	}

	async function lookForSystem(): Promise<void> {
		if (!system) return;
		systemHere = await system.present().catch(() => false);
		systemAllowed = systemHere ? await system.allowed().catch(() => null) : null;
		microphoneAllowed = systemHere ? await system.microphone().catch(() => null) : null;
	}

	async function allowListening(): Promise<void> {
		if (!system) return;
		allowing = true;
		try {
			microphoneAllowed = await system.allowMicrophone().catch(() => microphoneAllowed);
			systemAllowed = await system.authorize().catch(() => systemAllowed);
		} finally {
			allowing = false;
		}
	}

	function refusedSaid(allowed: SpeechSystemAllowed | null, what: string, where: string): string {
		if (allowed === 'denied') {
			return `Allow Sloppy to use ${what} in System Settings → Privacy & Security → ${where}.`;
		}
		return allowed === 'restricted' ? `This computer does not let Sloppy use ${what}.` : '';
	}

	const refusals = $derived(
		[
			refusedSaid(microphoneAllowed, 'the microphone', 'Microphone'),
			refusedSaid(systemAllowed, 'speech recognition', 'Speech Recognition')
		].filter((refused) => refused !== '')
	);

	async function allowSystem(): Promise<void> {
		if (!system || systemAllowed !== 'undecided') return;
		systemAllowed = await system.authorize().catch(() => systemAllowed);
	}

	function keyServesChat(agent: SpeechAgent): boolean {
		return CHAT_AGENTS.some((one) => one === agent && chatAgentReach(one) === 'key');
	}

	function hearWith(agent: string): void {
		const chosen = SPEECH_AGENTS.find((one) => one === agent) ?? null;
		prefs.set('speechAgent', chosen);
		if (chosen === 'system') void allowSystem();
	}

	function hearWithModel(model: string): void {
		if (speaking === null) return;
		prefs.set('speechModel', { ...prefs.current.speechModel, [speaking]: model });
	}

	async function lookForProgram(): Promise<void> {
		if (!program) return;
		programHere = null;
		programHere = await program.present().catch(() => false);
	}

	async function chooseModelFile(): Promise<void> {
		if (!program) return;
		choosingFile = true;
		try {
			const picked = await program.pickModel().catch(() => undefined);
			if (picked !== undefined) prefs.set('speechProgramModel', picked);
		} finally {
			choosingFile = false;
		}
	}

	function fileName(path: string): string {
		return path.split(/[\\/]/).at(-1) ?? path;
	}

	$effect(() => {
		if (on && speaking !== null && speechAgentReach(speaking) === 'program') void lookForProgram();
	});

	$effect(() => {
		if (on) void lookForSystem();
	});
</script>

{#snippet keyRow(agent: KeyProvider, name: string)}
	{@const backing = heldFor(agent)}
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
			<Button type="submit" class="h-control" disabled={busy === agent || typed.trim() === ''}>
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
{/snippet}

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
				onCheckedChange={(goes) => {
					prefs.set('chatInBackground', goes);
					if (!goes) chat.leaveTheOthers();
				}}
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
		<div class="flex items-start gap-3">
			<Switch
				id="ai-web"
				checked={prefs.current.chatReachesWeb}
				onCheckedChange={(goes) => prefs.set('chatReachesWeb', goes)}
			/>
			<div class="min-w-0 flex-1 space-y-1">
				<Label for="ai-web" class="text-sm font-normal">Let it read the web</Label>
				<p class="text-xs text-muted-foreground">
					It can look things up online while answering, from the next chat it opens. Off, it works
					from your files alone.
				</p>
			</div>
		</div>

		<ul class="space-y-3">
			{#each CHAT_AGENTS as agent (agent)}
				{@const name = chatAgentName(agent)}
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
						{@render keyRow(agent, name)}
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

		<section
			class="space-y-3 border-t pt-4"
			aria-labelledby="ai-speech"
			data-surface="speech-settings"
		>
			<div class="space-y-1">
				<h3 id="ai-speech" class="text-sm">Speech</h3>
				<p class="text-xs text-muted-foreground">
					What you say into the chat's microphone, or to a headset reading these notes, is turned
					into words here, and Sloppy keeps nothing of your voice.
				</p>
			</div>
			{#if !hears}
				<p class="text-xs text-muted-foreground">
					Speaking from a headset is set up in the Sloppy app on a computer.
				</p>
			{:else}
				{#if system && systemHere === false}
					<p class="text-xs text-muted-foreground">This computer cannot hear yet.</p>
				{/if}
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
					<p class="text-sm">Heard with</p>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="outline" class="h-9 gap-1 text-xs">
									{speechAgentSaid(speaking)}
									<ChevronDown class="size-3.5" />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start" class="w-60">
							<DropdownMenu.RadioGroup value={speaking ?? ''} onValueChange={hearWith}>
								{#if !speechAgents.includes('system')}
									<DropdownMenu.RadioItem class="min-h-control" value=""
										>Nothing</DropdownMenu.RadioItem
									>
								{/if}
								{#each speechAgents as agent (agent)}
									<DropdownMenu.RadioItem class="min-h-control" value={agent}>
										{speechAgentSaid(agent)}
									</DropdownMenu.RadioItem>
								{/each}
							</DropdownMenu.RadioGroup>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>

				{#if mayListen !== null}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1" data-surface="may-listen">
						<p class="text-sm">
							This computer may listen and hear
							<span class="text-muted-foreground">· {mayListen}</span>
						</p>
						{#if microphoneAllowed === 'undecided' || systemAllowed === 'undecided'}
							<Button
								variant="outline"
								class="h-9 text-xs"
								disabled={allowing}
								onclick={() => void allowListening()}
							>
								Allow
							</Button>
						{/if}
					</div>
					{#each refusals as refused (refused)}
						<p class="text-sm text-destructive" role="alert">{refused}</p>
					{/each}
				{/if}

				{#if speaking === 'system'}
					<p class="text-xs text-muted-foreground">Heard on this computer; nothing leaves it.</p>
				{:else if speaking !== null && speechAgentReach(speaking) === 'program'}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<p class="text-sm">
							{speechAgentName(speaking)}
							<span class="text-muted-foreground">
								· {programHere === null
									? 'looking…'
									: programHere
										? 'on this computer'
										: 'not on this computer'}
							</span>
						</p>
						<Button
							variant="ghost"
							class="h-9 text-xs"
							disabled={programHere === null}
							onclick={() => void lookForProgram()}
						>
							Look again
						</Button>
					</div>
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<p class="min-w-0 text-sm break-all">
							{#if modelFile === null}
								<span class="text-muted-foreground">No model chosen yet.</span>
							{:else}
								Model <span class="text-muted-foreground">· {fileName(modelFile)}</span>
							{/if}
						</p>
						<Button
							variant="outline"
							class="h-9 text-xs"
							disabled={choosingFile}
							onclick={() => void chooseModelFile()}
						>
							{modelFile === null ? 'Choose a model file' : 'Choose another'}
						</Button>
					</div>
					<p class="text-xs text-muted-foreground">Heard on this computer; nothing leaves it.</p>
				{:else if speaking !== null}
					{#if keys && keyServesChat(speaking)}
						<p class="text-sm">
							{speechAgentName(speaking)}
							<span class="text-muted-foreground">
								· {heldFor(speaking) === undefined
									? 'give a key above, and it serves both'
									: 'uses the key above'}
							</span>
						</p>
					{:else if keys}
						{@render keyRow(speaking, speechAgentName(speaking))}
					{/if}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
						<p class="text-sm">Model</p>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline" class="h-9 gap-1 text-xs">
										{speechModel}
										<ChevronDown class="size-3.5" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-60">
								<DropdownMenu.RadioGroup value={speechModel} onValueChange={hearWithModel}>
									{#each speechModels as model (model)}
										<DropdownMenu.RadioItem class="min-h-control" value={model}>
											{model}
										</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
					<p class="text-xs text-muted-foreground">
						What you say is sent to {speechAgentName(speaking)} to be turned into words.
					</p>
				{/if}
			{/if}
		</section>
	{/if}
</div>
