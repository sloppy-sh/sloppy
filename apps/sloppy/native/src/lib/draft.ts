/**
 * This shell's half of `DraftAccess` in `@sloppy/app-core`, which declares
 * every act and what its answer means. The copy itself is
 * `src-tauri/src/draft.rs`; reaching one is the `Files` and the `History` this
 * shell already answers for a folder, rooted inside the copy.
 */

import type { ChatAccess } from '@sloppy/app-core';
import type { Files, History } from '@sloppy/local';
import { StandingDraftSchema, type StandingDraft, type Ulid } from '@sloppy/types';
import { invoke } from '@tauri-apps/api/core';
import { refusal, tauriHistory, type Invoke } from './files';

/** The seam, which `@sloppy/app-core` carries on `ChatAccess` rather than
 *  exporting beside it. */
export type DraftAccess = NonNullable<ChatAccess['drafts']>;

/** The commands `src-tauri` answers. */
const STANDING = 'draft_standing';
const START = 'draft_start';
const DISCARD = 'draft_discard';

const NO_NOTES = 'Open the notes you want a draft of first.';
const DIDNT_WORK = 'That did not work. Try again.';

class TauriDrafts implements DraftAccess {
	/** One being taken per thread, so that the page asking and a session
	 *  opening do not make two copies of one folder. */
	private readonly starting = new Map<Ulid, Promise<StandingDraft>>();

	constructor(
		private readonly notes: () => string | undefined,
		private readonly device: Files,
		private readonly call: Invoke
	) {}

	async standing(): Promise<StandingDraft[]> {
		const root = this.notes();
		if (root === undefined) return [];
		return this.held(root);
	}

	async start(id: Ulid): Promise<StandingDraft> {
		let starting = this.starting.get(id);
		if (!starting) {
			starting = this.takes(this.here(), id).finally(() => this.starting.delete(id));
			this.starting.set(id, starting);
		}
		return starting;
	}

	async discard(draft: StandingDraft): Promise<void> {
		await this.asked<void>(DISCARD, { root: this.here(), id: draft.id });
	}

	files(draft: StandingDraft): Files {
		return this.device.at(draft.root);
	}

	history(draft: StandingDraft): History {
		return tauriHistory(draft.vault, this.call);
	}

	private async takes(root: string, id: Ulid): Promise<StandingDraft> {
		const held = (await this.held(root)).find((draft) => draft.id === id);
		return held ?? read(await this.asked(START, { root, id }));
	}

	private async held(root: string): Promise<StandingDraft[]> {
		return (await this.asked<unknown[]>(STANDING, { root })).map(read);
	}

	private here(): string {
		const root = this.notes();
		if (root === undefined) throw refusal(NO_NOTES);
		return root;
	}

	private async asked<T>(command: string, args: Record<string, unknown>): Promise<T> {
		try {
			return await this.call<T>(command, args);
		} catch (reason) {
			throw refusal(reason);
		}
	}
}

/** What the bridge answered, held to the shape the seam is declared in — a
 *  store is rooted at what it carries, so neither path is taken on trust. */
function read(held: unknown): StandingDraft {
	const draft = StandingDraftSchema.safeParse(held);
	if (!draft.success) throw refusal(DIDNT_WORK);
	return draft.data;
}

/** `notes` is where the graph in front of somebody is kept, asked again each
 *  time because opening another folder is another set of drafts. */
export function tauriDrafts(
	notes: () => string | undefined,
	device: Files,
	call: Invoke = invoke
): DraftAccess {
	return new TauriDrafts(notes, device, call);
}
