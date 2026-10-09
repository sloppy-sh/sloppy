<script lang="ts">
	// The three faces a look is read in — DESIGN.md § Typography. Each is one of
	// the faces this build offers or a family somebody names here.
	import { FACE_NAME_MAX } from '@sloppy/types';
	import { ChoicePill } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import {
		FACE_LABELS,
		FACE_ROLES,
		FACES,
		type FaceRole,
		namesAFace,
		prefs
	} from '../stores/prefs.svelte.js';

	/** What each role is called, and what its own field asks for. */
	const ROLES: Record<FaceRole, { name: string; asked: string }> = {
		ui: { name: 'The app', asked: 'Family the app is set in' },
		heading: { name: 'Headings', asked: 'Family headings are set in' },
		mono: { name: 'Code and addresses', asked: 'Family code and addresses are set in' }
	};
	/** The choice that stands for a family of their own. */
	const THEIR_OWN = '…';

	let naming = $state<FaceRole | null>(null);
	let typed = $state('');
	let problem = $state<string | null>(null);

	/** The family a role is set in where it is one nothing here offers, which is
	 *  what the row shows and the field opens on. */
	function family(role: FaceRole): string | null {
		const face = prefs.current.fonts[role];
		return (FACES as string[]).includes(face) ? null : face;
	}

	/** The one of a row's choices that is on. */
	function picked(role: FaceRole): string {
		if (naming === role || family(role) !== null) return THEIR_OWN;
		return prefs.current.fonts[role];
	}

	function wear(role: FaceRole, face: string): void {
		naming = null;
		problem = null;
		prefs.set('fonts', { ...prefs.current.fonts, [role]: face });
	}

	function nameOne(role: FaceRole): void {
		naming = role;
		problem = null;
		typed = family(role) ?? '';
	}

	function useTyped(role: FaceRole): void {
		if (!namesAFace(typed)) {
			problem = 'That is not the name of a face. Type the family name on its own.';
			return;
		}
		const asked = typed.trim();
		typed = '';
		wear(role, asked);
	}
</script>

<div class="space-y-6">
	{#each FACE_ROLES as role (role)}
		{@const named = family(role)}
		<fieldset class="space-y-2">
			<legend class="text-sm text-muted-foreground">{ROLES[role].name}</legend>
			<div class="flex flex-wrap gap-2">
				{#each FACES as face (face)}
					<ChoicePill
						group="face-{role}"
						value={face}
						label={FACE_LABELS[face]}
						checked={picked(role) === face}
						onpick={() => wear(role, face)}
					/>
				{/each}
				<ChoicePill
					group="face-{role}"
					value={THEIR_OWN}
					label={named ?? 'Something else…'}
					checked={picked(role) === THEIR_OWN}
					onpick={() => nameOne(role)}
				/>
			</div>
			{#if naming === role}
				<form
					class="flex flex-col gap-2 sm:flex-row"
					onsubmit={(event) => {
						event.preventDefault();
						useTyped(role);
					}}
				>
					<Input
						bind:value={typed}
						maxlength={FACE_NAME_MAX}
						autocapitalize="words"
						autocomplete="off"
						spellcheck={false}
						aria-label={ROLES[role].asked}
						placeholder="A family on this device"
						class="h-control sm:flex-1"
					/>
					<div class="flex gap-2">
						<Button type="submit" variant="outline" class="h-control flex-1 sm:flex-none">
							Use it
						</Button>
						<Button
							type="button"
							variant="ghost"
							class="h-control flex-1 sm:flex-none"
							onclick={() => {
								naming = null;
								problem = null;
								typed = '';
							}}
						>
							Never mind
						</Button>
					</div>
				</form>
				{#if problem}
					<p class="text-sm text-destructive" role="alert">{problem}</p>
				{/if}
			{/if}
		</fieldset>
	{/each}
	<p class="text-sm text-muted-foreground">
		A family this device does not have reads in the face it had.
	</p>
</div>
