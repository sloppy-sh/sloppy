<script lang="ts">
	// Who the versions kept in this folder are by, how they are signed, where
	// else the folder is kept and how this device gets in there —
	// docs/ARCHITECTURE.md § "The vault's history".
	import type { Credential } from '@sloppy/local';
	import type { OwnedRef } from '@sloppy/types';
	import { ConfirmModal, CopyButton } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Label } from '@sloppy/ui/label';
	import { gitSettings, onADesktop, type PlaceKept } from '../stores/git-settings.svelte.js';
	import { graphs } from '../stores/graphs.svelte.js';

	/** `SigningConfig`'s three kinds, with the two ssh keys told apart: picking
	 *  the one this app keeps and naming a key file are two different acts. */
	type SigningChoice = 'none' | 'kept' | 'file' | 'openpgp';

	/** Which part of this surface an answer belongs under. */
	type Section = 'user' | 'signing' | 'places';

	const desktop = onADesktop();

	let typedUser = $state<{ name: string; email: string } | null>(null);
	let picked = $state<SigningChoice | null>(null);
	let keyPath = $state<string | null>(null);
	let program = $state<string | null>(null);
	let keyId = $state<string | null>(null);

	let adding = $state(false);
	let newName = $state('');
	let newUrl = $state('');

	let editing = $state<string | null>(null);
	let editName = $state('');
	let editUrl = $state('');

	let asking = $state(false);
	let removing = $state('');
	let refusedRemoval = $state<string | null>(null);

	let wayFor = $state<string | null>(null);
	let wayKind = $state<Credential['kind']>('token');
	let token = $state('');
	let username = $state('');
	let sshKept = $state(true);
	let sshPath = $state('');

	let where = $state<Section | null>(null);
	let problem = $state<string | null>(null);

	const user = $derived(typedUser ?? gitSettings.user ?? { name: '', email: '' });
	const signing = $derived(gitSettings.signing);
	const chosen = $derived(
		picked ??
			(signing.kind === 'ssh' ? (signing.key.kind === 'kept' ? 'kept' : 'file') : signing.kind)
	);
	const path = $derived(
		keyPath ?? (signing.kind === 'ssh' && signing.key.kind === 'file' ? signing.key.path : '')
	);
	const programNamed = $derived(
		program ?? (signing.kind === 'openpgp' ? (signing.program ?? '') : '')
	);
	const keyNamed = $derived(keyId ?? (signing.kind === 'openpgp' ? (signing.keyId ?? '') : ''));

	let openFolder: OwnedRef | undefined;

	$effect(() => {
		// The graph in front of somebody is the folder that is open, so another
		// one opening is another folder's settings.
		const folder = graphs.current;
		if (folder === openFolder) return;
		openFolder = folder;
		forgetWhatWasTyped();
		void gitSettings.read();
	});

	function forgetWhatWasTyped(): void {
		typedUser = null;
		picked = null;
		keyPath = null;
		program = null;
		keyId = null;
		adding = false;
		newName = '';
		newUrl = '';
		editing = null;
		editName = '';
		editUrl = '';
		asking = false;
		removing = '';
		refusedRemoval = null;
		wayFor = null;
		wayKind = 'token';
		token = '';
		username = '';
		sshKept = true;
		sshPath = '';
		where = null;
		problem = null;
	}

	function began(section: Section): void {
		where = section;
		problem = null;
	}

	function refuse(section: Section, says: string): void {
		where = section;
		problem = says;
	}

	function saveUser(event: SubmitEvent): void {
		event.preventDefault();
		const name = user.name.trim();
		const email = user.email.trim();
		if (!name || !email) {
			refuse('user', 'Type the name and the email to keep your versions in.');
			return;
		}
		began('user');
		void gitSettings.setUser({ name, email });
	}

	async function choose(choice: SigningChoice): Promise<void> {
		picked = choice;
		began('signing');
		const now =
			choice === 'none'
				? ({ kind: 'none' } as const)
				: choice === 'kept'
					? ({ kind: 'ssh', key: { kind: 'kept' } } as const)
					: undefined;
		// The other two are chosen here and settled by the form under them.
		if (now && !(await gitSettings.signWith(now))) picked = null;
	}

	function signWithAKeyFile(event: SubmitEvent): void {
		event.preventDefault();
		const named = path.trim();
		if (!named) {
			refuse('signing', 'Type where the key is on this device.');
			return;
		}
		began('signing');
		void gitSettings.signWith({ kind: 'ssh', key: { kind: 'file', path: named } });
	}

	function signWithAProgram(event: SubmitEvent): void {
		event.preventDefault();
		const named = programNamed.trim();
		const key = keyNamed.trim();
		began('signing');
		void gitSettings.signWith({
			kind: 'openpgp',
			...(named ? { program: named } : {}),
			...(key ? { keyId: key } : {})
		});
	}

	async function addPlace(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const url = newUrl.trim();
		if (!url) {
			refuse('places', 'Type the address your graph is kept at.');
			return;
		}
		began('places');
		if (await gitSettings.addPlace(newName.trim() || 'origin', url)) {
			adding = false;
			newName = '';
			newUrl = '';
		}
	}

	function openEdit(place: PlaceKept): void {
		editing = editing === place.name ? null : place.name;
		editName = place.name;
		editUrl = place.url;
		problem = null;
	}

	async function saveEdit(place: PlaceKept, event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const name = editName.trim();
		const url = editUrl.trim();
		if (!name || !url) {
			refuse('places', 'Give it a name and an address.');
			return;
		}
		began('places');
		let done = url === place.url || (await gitSettings.setPlaceAddress(place.name, url));
		if (done && name !== place.name) done = await gitSettings.renamePlace(place.name, name);
		if (done) editing = null;
	}

	function askToRemove(place: PlaceKept): void {
		removing = place.name;
		refusedRemoval = null;
		asking = true;
	}

	/** Refusing leaves the question standing, with what the history said in it. */
	async function removeThePlace(): Promise<void> {
		began('places');
		if (await gitSettings.removePlace(removing)) return;
		refusedRemoval = gitSettings.says;
		throw new Error(refusedRemoval ?? '');
	}

	function openWayIn(place: PlaceKept): void {
		wayFor = wayFor === place.name ? null : place.name;
		const held = place.credential;
		wayKind = held?.kind ?? 'token';
		username = held?.kind === 'token' ? (held.username ?? '') : '';
		sshKept = held?.kind === 'ssh' ? held.key.kind === 'kept' : true;
		sshPath = held?.kind === 'ssh' && held.key.kind === 'file' ? held.key.path : '';
		token = '';
		problem = null;
	}

	async function saveWayIn(host: string, event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (wayKind === 'token' && !token.trim()) {
			refuse('places', 'Paste the token your host gave you.');
			return;
		}
		if (wayKind === 'ssh' && !sshKept && !sshPath.trim()) {
			refuse('places', 'Type where the key is on this device.');
			return;
		}
		began('places');
		const credential: Credential =
			wayKind === 'token'
				? {
						kind: 'token',
						...(username.trim() ? { username: username.trim() } : {}),
						token: token.trim()
					}
				: {
						kind: 'ssh',
						key: sshKept ? { kind: 'kept' } : { kind: 'file', path: sshPath.trim() }
					};
		if (await gitSettings.holdWayIn(host, credential)) {
			wayFor = null;
			token = '';
		}
	}

	async function forgetWayIn(host: string): Promise<void> {
		began('places');
		if (await gitSettings.forgetWayIn(host)) wayFor = null;
	}
</script>

{#snippet pill(
	group: string,
	value: string,
	label: string,
	checked: boolean,
	pick: () => void,
	off = false
)}
	<label class={off ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}>
		<input
			type="radio"
			name={group}
			{value}
			{checked}
			disabled={off}
			onchange={pick}
			class="peer sr-only"
		/>
		<span
			class="inline-flex h-11 items-center rounded-md border border-border bg-card px-4 text-sm text-muted-foreground transition-colors duration-150 ease-out peer-checked:border-primary peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none"
		>
			{label}
		</span>
	</label>
{/snippet}

{#snippet trouble(section: Section)}
	{#if where === section && (problem ?? gitSettings.says)}
		<p class="text-sm text-destructive" role="alert">{problem ?? gitSettings.says}</p>
	{/if}
{/snippet}

{#if gitSettings.offers}
	<div class="space-y-8 pt-2" data-surface="history-settings">
		<p class="text-sm text-muted-foreground">
			What you set here is this folder's. The name on your versions and the way they are signed also
			start off the next folder you begin on this device.
		</p>

		<section class="space-y-3">
			<h3 class="text-sm font-medium">Who your versions are by</h3>
			<p class="text-sm text-muted-foreground">
				Every version you keep in this folder is kept in this name.
				{#if !gitSettings.user}
					Until you say, it is your graph's owner.
				{/if}
			</p>
			<form class="space-y-3" onsubmit={saveUser}>
				<div class="space-y-1">
					<Label for="history-git-name">Your name</Label>
					<Input
						id="history-git-name"
						name="git-name"
						autocomplete="name"
						value={user.name}
						oninput={(event) => (typedUser = { ...user, name: event.currentTarget.value })}
						class="h-11"
					/>
				</div>
				<div class="space-y-1">
					<Label for="history-git-email">Your email</Label>
					<Input
						id="history-git-email"
						name="git-email"
						type="email"
						inputmode="email"
						autocomplete="email"
						autocapitalize="none"
						spellcheck={false}
						value={user.email}
						oninput={(event) => (typedUser = { ...user, email: event.currentTarget.value })}
						class="h-11"
					/>
				</div>
				<Button type="submit" variant="outline" class="h-11" disabled={gitSettings.busy}>
					Save who they're by
				</Button>
			</form>
			{@render trouble('user')}
		</section>

		<section class="space-y-3">
			<h3 class="text-sm font-medium">How they're signed</h3>
			<p class="text-sm text-muted-foreground">
				A signature says a version came from you, and a host shows it beside your writing.
			</p>
			<fieldset class="space-y-3">
				<legend class="sr-only">How your versions are signed</legend>
				<div class="flex flex-wrap gap-2">
					{@render pill('signing', 'none', 'Not signed', chosen === 'none', () => choose('none'))}
					{@render pill('signing', 'kept', 'With a key Sloppy keeps', chosen === 'kept', () =>
						choose('kept')
					)}
					{@render pill('signing', 'file', 'With a key on this device', chosen === 'file', () =>
						choose('file')
					)}
					{@render pill(
						'signing',
						'openpgp',
						'With your OpenPGP program',
						chosen === 'openpgp',
						() => choose('openpgp'),
						!desktop
					)}
				</div>
			</fieldset>
			{#if !desktop}
				<p class="text-sm text-muted-foreground">
					Signing with an OpenPGP program takes a desktop. Sloppy can keep a key for you here
					instead.
				</p>
			{/if}

			{#if chosen === 'kept'}
				{#if gitSettings.keptKey}
					<p class="text-sm text-muted-foreground">
						Paste this into GitHub or GitLab as a signing key, and what you keep here shows there as
						yours.
					</p>
					<p
						class="rounded-md border border-border bg-card p-3 font-mono text-xs break-all select-text"
					>
						{gitSettings.keptKey}
					</p>
					<CopyButton value={gitSettings.keptKey} label="Copy the key" />
				{:else}
					<p class="text-sm text-muted-foreground">Sloppy is keeping a key for this folder.</p>
				{/if}
			{/if}

			{#if chosen === 'file'}
				<form class="space-y-3" onsubmit={signWithAKeyFile}>
					<div class="space-y-1">
						<Label for="history-key-file">Where the key is on this device</Label>
						<Input
							id="history-key-file"
							name="key-file"
							autocapitalize="none"
							spellcheck={false}
							placeholder="~/.ssh/id_ed25519"
							value={path}
							oninput={(event) => (keyPath = event.currentTarget.value)}
							class="h-11"
						/>
					</div>
					<Button type="submit" variant="outline" class="h-11" disabled={gitSettings.busy}>
						Sign with this key
					</Button>
				</form>
			{/if}

			{#if chosen === 'openpgp'}
				<form class="space-y-3" onsubmit={signWithAProgram}>
					<div class="space-y-1">
						<Label for="history-pgp-program">Which program signs</Label>
						<Input
							id="history-pgp-program"
							name="pgp-program"
							autocapitalize="none"
							spellcheck={false}
							placeholder="gpg"
							value={programNamed}
							oninput={(event) => (program = event.currentTarget.value)}
							class="h-11"
						/>
					</div>
					<div class="space-y-1">
						<Label for="history-pgp-key">Which key it signs with</Label>
						<Input
							id="history-pgp-key"
							name="pgp-key"
							autocapitalize="none"
							spellcheck={false}
							value={keyNamed}
							oninput={(event) => (keyId = event.currentTarget.value)}
							class="h-11"
						/>
					</div>
					<p class="text-sm text-muted-foreground">
						Leave either empty and Sloppy uses what this device is already set up with.
					</p>
					<Button type="submit" variant="outline" class="h-11" disabled={gitSettings.busy}>
						Sign with this program
					</Button>
				</form>
			{/if}
			{@render trouble('signing')}
		</section>

		<section class="space-y-3">
			<h3 class="text-sm font-medium">Where else your graph is kept</h3>
			<p class="text-sm text-muted-foreground">
				Somewhere you can reach this folder from another device — your own host, or an account on
				GitHub or GitLab. Naming one here sends nothing; the history is where you put yours there
				and take newer ones in.
			</p>

			{#if gitSettings.places.length > 0}
				<ul class="space-y-2">
					{#each gitSettings.places as place (place.name)}
						<li class="space-y-2 rounded-md border border-border bg-card p-3">
							<p class="text-sm font-medium">{place.name}</p>
							<p class="text-sm break-all text-muted-foreground select-text">{place.url}</p>
							{#if place.host && gitSettings.holdsWaysIn}
								<p class="text-sm text-muted-foreground">
									{place.credential
										? `Sloppy can get into ${place.host}.`
										: `Sloppy has no way into ${place.host} yet.`}
								</p>
							{/if}
							<div class="flex flex-wrap gap-2">
								<Button
									variant="outline"
									class="h-11"
									onclick={() => openEdit(place)}
									aria-expanded={editing === place.name}
								>
									Change it
								</Button>
								{#if place.host && gitSettings.holdsWaysIn}
									<Button
										variant="outline"
										class="h-11"
										onclick={() => openWayIn(place)}
										aria-expanded={wayFor === place.name}
									>
										{place.credential ? 'Change the way in' : 'Add a way in'}
									</Button>
								{/if}
								<Button variant="ghost" class="h-11" onclick={() => askToRemove(place)}>
									Remove it
								</Button>
							</div>

							{#if editing === place.name}
								<form class="space-y-3" onsubmit={(event) => saveEdit(place, event)}>
									<div class="space-y-1">
										<Label for="history-place-name-{place.name}">What you call it</Label>
										<Input
											id="history-place-name-{place.name}"
											name="place-name"
											autocapitalize="none"
											spellcheck={false}
											bind:value={editName}
											class="h-11"
										/>
									</div>
									<div class="space-y-1">
										<Label for="history-place-url-{place.name}">Its address</Label>
										<Input
											id="history-place-url-{place.name}"
											name="place-url"
											inputmode="url"
											autocapitalize="none"
											spellcheck={false}
											bind:value={editUrl}
											class="h-11"
										/>
									</div>
									<Button type="submit" variant="outline" class="h-11" disabled={gitSettings.busy}>
										Save this place
									</Button>
								</form>
							{/if}

							{#if wayFor === place.name && place.host}
								{@const host = place.host}
								<form class="space-y-3" onsubmit={(event) => saveWayIn(host, event)}>
									<fieldset class="space-y-3">
										<legend class="text-sm font-medium">How Sloppy gets into {host}</legend>
										<div class="flex flex-wrap gap-2">
											{@render pill(
												`way-${place.name}`,
												'token',
												'With a token',
												wayKind === 'token',
												() => (wayKind = 'token')
											)}
											{@render pill(
												`way-${place.name}`,
												'ssh',
												'With an ssh key',
												wayKind === 'ssh',
												() => (wayKind = 'ssh')
											)}
										</div>
									</fieldset>

									{#if wayKind === 'token'}
										<div class="space-y-1">
											<Label for="history-token-{place.name}">
												{place.credential?.kind === 'token'
													? 'Paste a token to put in place of the one saved'
													: 'The token your host gave you'}
											</Label>
											<Input
												id="history-token-{place.name}"
												name="token"
												type="password"
												autocomplete="off"
												autocapitalize="none"
												spellcheck={false}
												bind:value={token}
												class="h-11"
											/>
										</div>
										<div class="space-y-1">
											<Label for="history-username-{place.name}">
												Your username there, if it asks for one
											</Label>
											<Input
												id="history-username-{place.name}"
												name="username"
												autocomplete="username"
												autocapitalize="none"
												spellcheck={false}
												bind:value={username}
												class="h-11"
											/>
										</div>
									{:else}
										<fieldset class="space-y-3">
											<legend class="sr-only">Which key</legend>
											<div class="flex flex-wrap gap-2">
												{@render pill(
													`key-${place.name}`,
													'kept',
													'The key Sloppy keeps',
													sshKept,
													() => (sshKept = true)
												)}
												{@render pill(
													`key-${place.name}`,
													'file',
													'A key on this device',
													!sshKept,
													() => (sshKept = false)
												)}
											</div>
										</fieldset>
										{#if !sshKept}
											<div class="space-y-1">
												<Label for="history-way-key-{place.name}">
													Where the key is on this device
												</Label>
												<Input
													id="history-way-key-{place.name}"
													name="way-key"
													autocapitalize="none"
													spellcheck={false}
													placeholder="~/.ssh/id_ed25519"
													bind:value={sshPath}
													class="h-11"
												/>
											</div>
										{/if}
									{/if}

									<p class="text-sm text-muted-foreground">
										This stays on this device and never goes into your folder.
										{#if gitSettings.placesAt(host) > 1}
											Everywhere you keep your graph at {host} is reached with it.
										{/if}
									</p>
									<div class="flex flex-wrap gap-2">
										<Button
											type="submit"
											variant="outline"
											class="h-11"
											disabled={gitSettings.busy}
										>
											Save the way in
										</Button>
										{#if place.credential}
											<Button
												type="button"
												variant="ghost"
												class="h-11"
												disabled={gitSettings.busy}
												onclick={() => forgetWayIn(host)}
											>
												Forget it
											</Button>
										{/if}
									</div>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if adding}
				<form class="space-y-3" onsubmit={addPlace}>
					<div class="space-y-1">
						<Label for="history-new-place-name">What you call it</Label>
						<Input
							id="history-new-place-name"
							name="new-place-name"
							autocapitalize="none"
							spellcheck={false}
							placeholder="origin"
							bind:value={newName}
							class="h-11"
						/>
					</div>
					<div class="space-y-1">
						<Label for="history-new-place-url">Its address</Label>
						<Input
							id="history-new-place-url"
							name="new-place-url"
							inputmode="url"
							autocapitalize="none"
							spellcheck={false}
							placeholder="https://github.com/you/notes.git"
							bind:value={newUrl}
							class="h-11"
						/>
					</div>
					<Button type="submit" variant="outline" class="h-11" disabled={gitSettings.busy}>
						Keep it there too
					</Button>
				</form>
			{:else}
				<Button
					variant="outline"
					class="h-11"
					onclick={() => {
						adding = true;
						problem = null;
					}}
				>
					Add somewhere else
				</Button>
			{/if}
			{@render trouble('places')}
		</section>

		{#if where === null && gitSettings.says}
			<p class="text-sm text-destructive" role="alert">{gitSettings.says}</p>
		{/if}
	</div>

	<ConfirmModal
		bind:open={asking}
		title="Stop keeping it at {removing}?"
		description="This folder forgets where that is. What is kept there stays there, and what is here stays here."
		confirmLabel="Stop keeping it there"
		refused={refusedRemoval}
		onconfirm={removeThePlace}
	/>
{/if}
