<script lang="ts">
	// The three faces a look is read in — DESIGN.md § Typography. Each is one of
	// the faces this build offers or a family somebody names here.
	import { FACE_NAME_MAX } from '@sloppy/types';
	import { ChoicePill } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import {
		type Face,
		FACE_LABELS,
		FACE_ROLES,
		FACES,
		type FaceRole,
		faceStack,
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
	/** The face a role's own stack already is: the app's own face is Inter
	 *  (DESIGN.md § Typography), so The app would otherwise stand two choices
	 *  that set the same face. */
	const ITS_OWN: Partial<Record<FaceRole, Face>> = { ui: 'inter' };

	/** The faces a role is offered, which is every one of them but the face it
	 *  is already set in by default. */
	function offered(role: FaceRole): Face[] {
		return FACES.filter((face) => face !== ITS_OWN[role]);
	}

	let naming = $state<FaceRole | null>(null);
	/** What is in a role's field, where that is not the family already kept
	 *  there, and what was wrong with the last name submitted to it. */
	let typed = $state<Partial<Record<FaceRole, string>>>({});
	let problem = $state<Partial<Record<FaceRole, string>>>({});

	/** The family a role is set in where it is one nothing here offers, which is
	 *  what the row shows and the field opens on. */
	function family(role: FaceRole): string | null {
		const face = prefs.current.fonts[role];
		return (FACES as string[]).includes(face) ? null : face;
	}

	/** Whether the field is open. A role standing on a family of its own keeps it
	 *  open, because a typed name is corrected and cleared there rather than
	 *  behind a choice that is already made. */
	function asking(role: FaceRole): boolean {
		return naming === role || family(role) !== null;
	}

	/** The one of a row's choices that is on. */
	function picked(role: FaceRole): string {
		if (asking(role)) return THEIR_OWN;
		const face = prefs.current.fonts[role];
		return face === ITS_OWN[role] ? 'system' : face;
	}

	function inTheField(role: FaceRole): string {
		return typed[role] ?? family(role) ?? '';
	}

	function wear(role: FaceRole, face: string): void {
		naming = null;
		delete typed[role];
		delete problem[role];
		prefs.set('fonts', { ...prefs.current.fonts, [role]: face });
	}

	function nameOne(role: FaceRole): void {
		naming = role;
		delete problem[role];
	}

	function useTyped(role: FaceRole): void {
		const asked = inTheField(role).trim();
		if (!namesAFace(asked)) {
			problem[role] = 'That is not the name of a face. Type the family name on its own.';
			return;
		}
		wear(role, asked);
	}

	/** A face reads best as itself, so each name is drawn in the face it names.
	 *  `system` is drawn in whatever the role already has, which is what
	 *  Default means. */
	function drawnIn(role: FaceRole, face: string): string | undefined {
		const stack = faceStack(role, face);
		return stack === null ? undefined : `font-family: ${stack}`;
	}

	/** Back to the face that is kept: the family, where the role stands on one,
	 *  and otherwise out of the field and on to the face it had. */
	function letItBe(role: FaceRole): void {
		delete typed[role];
		delete problem[role];
		if (naming === role) naming = null;
	}
</script>

<div class="space-y-6">
	{#each FACE_ROLES as role (role)}
		{@const named = family(role)}
		<fieldset class="space-y-2">
			<legend class="text-sm text-muted-foreground">{ROLES[role].name}</legend>
			<div class="flex flex-wrap gap-2">
				{#each offered(role) as face (face)}
					<ChoicePill
						group="face-{role}"
						value={face}
						label={FACE_LABELS[face]}
						checked={picked(role) === face}
						style={drawnIn(role, face)}
						onpick={() => wear(role, face)}
					/>
				{/each}
				<ChoicePill
					group="face-{role}"
					value={THEIR_OWN}
					label={named ?? 'Something else…'}
					checked={picked(role) === THEIR_OWN}
					style={named === null ? undefined : drawnIn(role, named)}
					onpick={() => nameOne(role)}
				/>
			</div>
			{#if asking(role)}
				<form
					class="flex flex-col gap-2 sm:flex-row"
					onsubmit={(event) => {
						event.preventDefault();
						useTyped(role);
					}}
				>
					<Input
						bind:value={() => inTheField(role), (asked) => (typed[role] = asked)}
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
							onclick={() => letItBe(role)}
						>
							Never mind
						</Button>
					</div>
				</form>
				{#if problem[role]}
					<p class="text-sm text-destructive" role="alert">{problem[role]}</p>
				{/if}
			{/if}
		</fieldset>
	{/each}
	<p class="text-sm text-muted-foreground">
		A family this device does not have reads in the face it had.
	</p>
</div>
