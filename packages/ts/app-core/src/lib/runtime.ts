/**
 * The platform seam. Everything that differs between the web shell and the
 * native (Tauri) shell lives behind this one interface, which is what lets one
 * codebase serve both — docs/ARCHITECTURE.md § "The two files that carry the
 * platform seam".
 *
 * **The ABSENCE of an optional member is meaningful**, and each line below says
 * what its absence decides. A shell leaves a member out to choose the default
 * behaviour, never because it has nothing to put there.
 */

import { setHost } from '@sloppy/client';
import type {
	AiKeysAccess,
	Commit,
	Credential,
	CredentialsAccess,
	Files,
	GitDefaultsAccess,
	History,
	IdentityAccess,
	ThreadsAccess
} from '@sloppy/local';
import type {
	BuildName,
	BuildRole,
	BuildStanding,
	ChatAgent,
	ChatEvent,
	ChatThread,
	ChatToolAnswer,
	DidSyr,
	OwnedRef,
	SloppyToolCall,
	StandingDraft,
	Ulid
} from '@sloppy/types';
import type { SloppyApi } from './api.js';
import { storedOrigin } from './stores/prefs.svelte.js';

/**
 * Which of the three deployments this app is running as
 * (docs/ARCHITECTURE.md § "Deployment modes"). It is what copy about where a
 * person's writing lives reads; `createApi` below is what the api layer reads.
 */
export type DeploymentMode = 'hosted' | 'self_hosted' | 'local';

/** One of the folders this device knows, as a list of them shows it. */
export interface KnownFolder {
	/** As the platform spells it, which is what opening one takes. */
	root: string;
	/** The graph in it, as its own `graph.json` says. Absent where this device
	 *  could not read one just now — a folder that is not there, or one holding
	 *  none yet. `owner` is whose folder it is, which is what says whether
	 *  closing it is this device's act; what they are called is `profileOf`'s
	 *  answer here as everywhere else, so no list holds a second copy of it.
	 *  `project` is where the code the graph is about is, as the graph says it;
	 *  absent is a graph that is nobody's project. */
	graph?: { ref: OwnedRef; name: string; owner: DidSyr; project?: string };
	/** Whether the folder is where this device last saw it. A folder that is
	 *  gone is still listed, because a person moved it and is the only one who
	 *  can say where to. */
	reachable: boolean;
}

/** The folder a graph on this device is kept in, and the one act that puts one
 *  there. The shell owns where a folder comes from; a page only asks. */
export interface VaultAccess {
	/** `undefined` before any folder has been opened, which is the first run. */
	folder(): string | undefined;
	/** The graph in the folder that is open, which is the one in front of
	 *  somebody here. A folder holding none is a folder somebody has just said a
	 *  graph is in, so one is started there. `undefined` while no folder is
	 *  open, which is the first run. */
	graph(): Promise<OwnedRef | undefined>;
	/** Open a folder and serve the graph in it from now on. `undefined` is
	 *  somebody who named none, and is not a failure. */
	open(): Promise<string | undefined>;
	/** Whether {@link open} asks somebody where. False is a device that keeps
	 *  its graphs in one place, and the offer says so rather than promising a
	 *  choice nobody gets. */
	readonly asks: boolean;
	/** Whether this folder stands alongside the graphs a Sloppy serves and is
	 *  closed again — a folder opened in a browser tab. Absent → the folder is
	 *  the only graph there is, so the graph a reader chose in another one is
	 *  let go of when this one opens. */
	readonly alongside?: boolean;
	/**
	 * Every folder this device knows, newest first. Absent, like the four acts
	 * below, is a shell that keeps one folder and no list of them, so nothing
	 * about choosing between them is put in front of anybody; a shell that
	 * defines one of them defines all of them.
	 */
	known?(): Promise<KnownFolder[]>;
	/** Serve the graph in that folder from now on. */
	openKnown?(root: string): Promise<void>;
	/** Take it off this device's list. Nothing in the folder is touched, and a
	 *  person opens it again by naming it again. */
	forget?(root: string): Promise<void>;
	/** The same act as {@link VaultAccess.open} for a folder a person means to
	 *  fill: what separates the two is the words the offer is made in — opening
	 *  a folder that holds a graph, or starting one that will.
	 *  `undefined` is somebody who named none. */
	start?(): Promise<string | undefined>;
	/** Start a graph in a place of this app's own, for somebody with no folder
	 *  to choose: it is kept with the rest of what this device keeps and listed
	 *  like any other. Resolves with the folder now open. Absent is a shell
	 *  that keeps graphs only where a person puts them. */
	startHere?(): Promise<string | undefined>;
	/** A copy of a graph kept somewhere else, brought onto this device.
	 *  `undefined` is somebody who chose not to say where to put it. */
	clone?(url: string, credential?: Credential): Promise<string | undefined>;
	/** Ask somebody for a project's root folder and serve the notes kept inside
	 *  it from now on, starting them where the project has none yet. Resolves
	 *  with the folder now open, or `undefined` where nobody named one. Absent
	 *  is a shell that cannot reach a project's own folder, and nothing about
	 *  opening one is put in front of anybody. */
	openProject?(): Promise<string | undefined>;
}

/** The folders a device has open at once, as it holds them. */
export interface OpenTabs {
	/** In the order opened. */
	open: readonly string[];
	/** One of `open`, or undefined where none is open. */
	active: string | undefined;
}

/**
 * The folders this device has open at once and which is in front of
 * somebody — docs/ARCHITECTURE.md § "Several folders open at once". A folder is
 * OPENED as a tab through {@link VaultAccess} (`openKnown`, `start`,
 * `openProject`, `clone`): the shell adds it where it is not open and makes it
 * active.
 *
 * Absent from {@link AppRuntime} is a shell that opens one folder at a time,
 * and nothing about tabs is put in front of anybody.
 */
export interface TabsAccess {
	held(): OpenTabs;
	/** Take a folder off. Where the active one closes, the shell serves the one
	 *  after it, else the one before; {@link TabsAccess.changed} says which.
	 *  Closing the only one REJECTS, with words for the person in its
	 *  message. */
	close(root: string): Promise<void>;
	/** Told after every change, opens included. Returns the disposer. */
	changed(hear: (tabs: OpenTabs) => void): () => void;
}

/**
 * A draft of the notes: a copy of the folder that a chat writes into, standing
 * apart from the one somebody has open until they merge it or discard it —
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 *
 * **One per thread, and it outlives the session and the app.** It is a branch
 * and a copy on the disk, so {@link DraftAccess.standing} reads what is there
 * rather than what this run remembers, and a draft is still standing after the
 * app is closed and opened again. The draft's id IS its thread's, so
 * {@link DraftAccess.start} for a thread whose draft stands answers that one
 * rather than making a second.
 *
 * **Reviewing and merging are NOT here, and deliberately.** What a draft holds
 * is a copy of a graph, and reading two copies of a graph against each other
 * and settling them is the store's — `previewVault` and `importVault` in
 * `@sloppy/local`, handed the vaults {@link History.readAt} answers for the
 * draft's tip and for the version it forked from. Putting either on this seam
 * would make the chat a second store. So this seam owns the two halves the
 * PLATFORM owns, making the copy and reaching it, and a page does the rest
 * through the store already serving the folder in front of somebody.
 *
 * Every act here REJECTS with words for the person in its message.
 */
export interface DraftAccess {
	/** Every draft standing on this device, for whichever threads have written
	 *  anything. An EMPTY list is none, and is not a failure. */
	standing(): Promise<StandingDraft[]>;
	/** The draft the thread `id` works in: the one standing for it where there
	 *  is one, and otherwise a new one whose notes are the folder's as they
	 *  stand, kept as the draft's first version — so
	 *  {@link StandingDraft.from} is that version and not whichever one the
	 *  folder was last kept at. */
	start(id: Ulid): Promise<StandingDraft>;
	/** The draft gone, both halves of it, with nothing of it left behind. The
	 *  folder in front of somebody is untouched either way, and a draft that is
	 *  not there is not a failure. */
	discard(draft: StandingDraft): Promise<void>;
	/** The draft's copy of the project, rooted where the agent works — what a
	 *  store serving that chat's acts is handed, exactly as
	 *  {@link AppRuntime.project} answers for the folder in front of somebody. */
	files(draft: StandingDraft): Files;
	/** The states the draft has been in, rooted at its notes.
	 *  `StandingDraft.from` is the version it forked from and
	 *  {@link History.currentCommit} the draft as it stands, so
	 *  {@link History.readAt} on the two is what a review reads. */
	history(draft: StandingDraft): History;
}

/**
 * A build's lines and checkouts on this device — docs/ARCHITECTURE.md
 * § "Building from the notes".
 *
 * **The line is a real branch of the project's own repository**, so what is
 * standing is read out of the repository rather than out of what a run
 * remembers, and a build is still there after the app has been closed and
 * opened again. Nothing here touches the folder in front of the person or any
 * line of theirs.
 *
 * **Bringing a line in is NOT here, and deliberately.** A build's line is an
 * ordinary line of the folder's, so taking it in is `History.merge` on the
 * folder — the merge that settles notes note by note and refuses a conflict in
 * the code — and putting a second merge on this seam would make a build a
 * second history.
 *
 * **The checkouts are named by the build's id**, under the app's own private
 * data, so every act but {@link BuildAccess.start} and
 * {@link BuildAccess.standing} takes that id alone.
 *
 * Every act REJECTS with words for the person in its message.
 */
export interface BuildAccess {
	/**
	 * The line the build `id` writes on and the checkout it is worked on in:
	 * the line opened at `from` where there is none, and the one standing where
	 * there is, so asking twice answers the same line rather than making a
	 * second. `root` is the folder the project is in and `name` what the build is
	 * called, which is what the line is named after: a page makes one out of what
	 * the person typed with `buildNameFrom` and asks for another where that comes
	 * to nothing, so nothing here is ever refused over a name.
	 */
	start(
		root: string,
		id: Ulid,
		name: BuildName,
		from: string
	): Promise<{ line: string; path: string }>;
	/** The checkout one task works in, on a branch of the line nobody is shown.
	 *  Asking again for a task that has one answers that one. */
	taskCheckout(id: Ulid, task: string): Promise<string>;
	/**
	 * What is in a checkout, rooted where the session works — what a store
	 * serving a build session's note acts is handed, exactly as
	 * {@link DraftAccess.files} answers for a draft. `path` is a checkout this
	 * seam answered with: the line's from {@link BuildAccess.start}, or a
	 * task's from {@link BuildAccess.taskCheckout}.
	 *
	 * **This is where an implementer's notes land**, so a build's writing never
	 * reaches the folder in front of the person, any line of theirs, or the
	 * places {@link AppRuntime.placeFiles} serves.
	 */
	files(path: string): Files;
	/**
	 * What is in that checkout, kept as one version. **It stages the whole
	 * checkout, the code and the notes**, because the checkout is the build's
	 * own and the code is the point; the rule that a commit stages only the
	 * notes is the person's folder's.
	 *
	 * `undefined` is a checkout holding nothing that is not already kept, which
	 * is not a failure.
	 */
	commit(path: string, message: string): Promise<Commit | undefined>;
	/**
	 * The task's branch merged into the line, in the line's own checkout.
	 * `merged` true is a merge that is done and committed.
	 *
	 * `conflicts` is every path left in two versions, as files in the line's
	 * checkout, for a session to settle there — nothing here settles one, and
	 * the merge is finished by committing that checkout.
	 */
	mergeTask(id: Ulid, task: string): Promise<{ merged: boolean; conflicts: string[] }>;
	/** The task's checkout and its branch gone, with nothing of either left
	 *  behind. What it merged into the line stays. A task that is not there is
	 *  not a failure. */
	finishTask(id: Ulid, task: string): Promise<void>;
	/** Everything of the build gone: its tasks' checkouts and branches, the
	 *  line's checkout and the line itself. Nothing of it is recoverable, and
	 *  the person's own folder and lines are untouched. A build that is not
	 *  there is not a failure. */
	discard(id: Ulid): Promise<void>;
	/** Every build standing in the repository at `root`. An EMPTY list is none,
	 *  and is not a failure. */
	standing(root: string): Promise<BuildStanding[]>;
}

/** What {@link ChatAccess.open} is asked for. */
export interface ChatAsked {
	/** Which agent is to do it. **Absent is whichever one this device has**,
	 *  which is the whole answer while it has one. */
	agent?: ChatAgent;
	/** Which model it is to answer with, as that agent names its models.
	 *  **Absent is whatever the agent would answer with on its own**, which is
	 *  what somebody who has chosen nothing gets. */
	model?: string;
	/**
	 * Which thread is opening this: its `id`, which is the draft to run in and
	 * the session to open as; its `session`, which is the conversation to pick
	 * up where there is one to pick up — **absent is a thread no agent has
	 * opened yet, and a new conversation**; and its `places`, which the agent
	 * is given to read beside the project, every one of them again every time,
	 * because nothing can be added to a session once it is running.
	 *
	 * **A session asked to be picked up may not be**: it may be gone, or the
	 * agent may turn it down. The shell opens a new one in that case, and the
	 * `started` event's `session` is what says which one answered.
	 */
	thread: Pick<ChatThread, 'id' | 'session' | 'places'>;
	/**
	 * Which of the thread's conversations this is, and so what this call
	 * replaces: the conversation standing under this id for this thread is
	 * ended and every other one of the thread's is left standing. Every turn
	 * said into it carries it (`ChatTurn.conversation`), which is what tells a
	 * page which turns and which window belong to which session.
	 *
	 * **Absent is the thread's one conversation**, which is a chat's. A build
	 * runs one per phase and one per task, up to `BUILD_TASKS_AT_ONCE` at once,
	 * so each of those names its own. `thread.session` beside this is what the
	 * AGENT calls the conversation to pick up, and the two are never read for
	 * each other.
	 */
	conversation?: Ulid;
	/**
	 * What this session is FOR. It decides which tools of the agent's own it is
	 * allowed and barred, and which of Sloppy's acts it is served — by a table
	 * the shell keeps, because those tool names are one program's dialect and
	 * no shape here carries them. `toolsForRole` in `@sloppy/types` is the
	 * acts' half of that table.
	 *
	 * **Absent is the chat**: today's pair of reading tools, and the chat's own
	 * brief.
	 */
	role?: BuildRole;
	/** The folder the session runs in, as the platform spells one. **Absent is
	 *  the thread's draft**, which is where a chat works; a build names the
	 *  checkout its task or its line is worked on in. */
	cwd?: string;
	/** Whether the agent may read the web while it answers. **Absent is that
	 *  it may.** Fixed for the session: a change reaches the next one opened. */
	reachesWeb?: boolean;
	/** What the conversation was so far, in words, for an agent that cannot pick
	 *  the one asked for up: the shell says it before the first thing said,
	 *  into the conversation it opens in that one's place, and nowhere else.
	 *  **Absent is nothing to hand over.** */
	carried?: string;
}

/**
 * One live conversation, as the shell hands it back. Everything said into it
 * and every end to it goes through this handle, so a page holding two of them
 * is holding two threads' conversations and can say nothing into the wrong one.
 */
export interface ChatLive {
	/** Say something, which begins a turn. It resolves when the agent has been
	 *  told, NOT when the turn ends — `ended` says that. Saying nothing REJECTS,
	 *  and so does saying anything while a turn is underway, because the agent is
	 *  answering the last thing it was told. */
	say(said: string): Promise<void>;
	/** End the turn underway, resolving once it has ended. The conversation
	 *  stands, and the next {@link ChatLive.say} goes on with it. Nothing
	 *  underway is not a failure. */
	stop(): Promise<void>;
	/** End the conversation, resolving once it has ended. What the agent was
	 *  doing goes with it and a page is told `over`; there is nothing to go on
	 *  with, so the next thing a page asks for is {@link ChatAccess.open}, and
	 *  `say` after it rejects. One already over is not a failure. The draft is
	 *  untouched: it stands until somebody merges it or discards it. */
	close(): Promise<void>;
	/**
	 * Ask the agent how full its window is. The answer arrives at `hear` as a
	 * `context` event rather than here, because an agent answers this on the
	 * same channel it says everything else on. `'summary'` is the cheap form
	 * and `'full'` the whole breakdown. Nothing underway is not a failure, and
	 * neither is an agent that does not answer.
	 *
	 * Absent → this shell cannot ask, so the chart draws only what a turn
	 * already said and nothing offers a refresh.
	 */
	context?(detail: 'summary' | 'full'): Promise<void>;
}

/**
 * Chatting with an agent on this device about the project in front of
 * somebody — docs/ARCHITECTURE.md § "Asking a tool to write the notes". A page
 * opens a conversation for a thread, says things into it, is told what the
 * agent is doing, is asked to do Sloppy's own acts when the agent calls one,
 * and answers for the person when one of those acts would write.
 *
 * **One live conversation per thread and {@link ChatAsked.conversation}, and
 * {@link ChatAccess.open} replaces that one.** What is opened is the thread's:
 * its draft, its places, and the conversation picked up where there is one. A
 * chat names no conversation and runs one, so opening one again for the same
 * thread ends the one that stood there; a build names one per session and runs
 * several at once, so opening one ends only what stood under that id. Every
 * other conversation, of this thread and of every other, is left standing;
 * **`over` is one conversation's end** — whichever way it ended and whether or
 * not anything went wrong — and says nothing about any other.
 *
 * **How many stand at once is the STORE's rule, never this seam's.** A shell
 * holds whatever it is asked to hold, and `stores/chat.svelte.ts` is the one
 * place a chat that waits while somebody is reading another thread is told
 * apart from one that goes on answering wherever they are.
 *
 * **The IMPLEMENTATION parses, in both directions, and no caller repeats it.**
 * The members here and on {@link ChatLive} take and answer plain TypeScript,
 * which holds nothing at runtime, and a tool call is composed by a program
 * reading somebody's checked-out tree. So a shell parses every event against
 * `ChatEventSchema`
 * before a page sees it, holds the arguments it carries to `argumentsFit`, and
 * parses what a page hands back (`ChatToolAnswerSchema`) and what a person
 * typed (`CHAT_ASKED_MAX`) before acting on any of it. A page spells no check
 * of its own; `ChatTurn`, `ChatSession` and `turnFits` are the surface's own
 * vocabulary and cross nothing.
 *
 * **A call reaches {@link ChatAccess.open}'s `serve` with its arguments
 * already parsed**, against the act's own schema in `CHAT_TOOL_SPECS` — which
 * is stricter than the JSON Schema the agent was advertised, so a place is
 * inside the project by the time a page reads it. A call whose arguments do not
 * parse never reaches the page: the shell answers the AGENT with what the shape
 * refused it for, as trouble, so the agent can call again — dropping it instead
 * would leave the agent waiting on an answer that never comes.
 *
 * **Every act LANDS, and nothing is asked.** A session works on a draft — a
 * copy of the folder, kept apart from the one in front of somebody until they
 * have read it — so a write costs them no answer while it runs and costs the
 * run no wait. {@link ChatAccess.drafts} is where a draft comes from and
 * {@link DraftAccess} is what a page does with one.
 *
 * **A page serving a writing act writes as the project's CONTAINER, and never
 * as the person.** `containerDataAt` in `@sloppy/local` is where that store's
 * data goes and is spelled nowhere else, `writeOnto` beside it is the one write
 * path — it lands where `writesAlone` is true and offers an amendment where
 * somebody else has written in the note — and nothing writes a note file by
 * hand. A store rooted anywhere else writes as whoever is signed in here, for
 * whom `writesAlone` is true on every note they have written, so every one of
 * them is written over rather than offered. Where the session works in a draft,
 * that store is rooted at {@link DraftAccess.files} — the draft's copy of the
 * project — and the container's own data is carried into the copy, so the
 * writing a draft carries is by the same writer the folder's is. Where the
 * session is a build's, it is rooted at {@link BuildAccess.files} for the
 * checkout {@link ChatAsked.cwd} names, so an implementer's notes land on the
 * build's line and nothing of the person's moves.
 */
export interface ChatAccess {
	/** The agents this device can reach. An EMPTY list is a device with none,
	 *  and the offer says so rather than failing when somebody takes it. */
	agents(): Promise<ChatAgent[]>;
	/**
	 * Start a conversation for `asked.thread` and {@link ChatAsked.conversation},
	 * ending the one that stood under that pair and leaving every other
	 * conversation standing, this thread's and every other thread's. It resolves
	 * with the handle once the conversation is ready to be said into; `started`
	 * reaches `hear` when the agent has said what it is and what tools it has,
	 * which is after the first turn begins.
	 *
	 * **A device with no agent REJECTS**, with words for the person in its
	 * message, which are the ones the surface shows.
	 *
	 * `serve` is the page doing one of Sloppy's own acts and answering for it —
	 * every act, the chat's and a build's alike, which is why it takes
	 * `SloppyToolCall` and not the chat's half of it.
	 * It is asked once per call, and what it resolves with is what the agent
	 * reads; it REJECTS where the act could not be done, and the shell tells
	 * the agent so in the words of the rejection rather than leaving it
	 * waiting. **A shell with {@link ChatAccess.drafts} runs the conversation in
	 * the thread's draft**, so the folder a page serves a call against is that
	 * draft's and not the one in front of somebody.
	 */
	open(
		asked: ChatAsked,
		hear: (event: ChatEvent) => void,
		serve: (call: SloppyToolCall) => Promise<ChatToolAnswer>
	): Promise<ChatLive>;
	/** The draft a session works in — {@link DraftAccess} declares every act.
	 *  Absent → this shell keeps no draft, so nothing about one is put in front
	 *  of anybody. */
	drafts?: DraftAccess;
	/** The lines and checkouts a build works in — {@link BuildAccess} declares
	 *  every act. Absent → this shell cannot open a line of work for a build,
	 *  so nothing about building is put in front of anybody. */
	builds?: BuildAccess;
}

export interface AppRuntime {
	/** The origin this build shipped with, or `''` for same-origin. A device
	 *  pointed at another Sloppy is served by that one instead, and returning to
	 *  the default returns to this. `initRuntime` publishes the answer to
	 *  `@sloppy/client`'s host module, so nothing else spells a URL. */
	apiHost(): string;
	mode(): DeploymentMode;
	token: {
		get(): string | undefined;
		set(v: string): void;
		clear(): void;
	};
	fetchImpl(): typeof fetch;
	/** Absent → a rejected session surfaces wherever it was noticed. Present →
	 *  the shell signs out app-wide. */
	onAuthInvalid?(): void;
	/** Absent on web, where syr's consent page navigates the current tab.
	 *  Present on native, which opens the system browser so consent returns via
	 *  a deep link — a WebView cannot host somebody else's sign-in. */
	openExternal?(url: string): Promise<void> | void;
	/** Where consent puts somebody down when it is done, as an absolute URL.
	 *  Absent → `${location.origin}/`, which is where a tab already stands. A
	 *  shell the system browser cannot navigate back into names a URL that
	 *  reaches it instead, and the API only hands a session to a target it
	 *  recognises. */
	signInRedirect?(): string;
	/** PRESENT means this platform can serve the graph with no network at all:
	 *  the folder on the device is the whole store. Absent → the remote client.
	 *  A shell that defines it reports `mode() === 'local'` while it is in use,
	 *  and calls {@link resetApi} when that changes. */
	createApi?(): SloppyApi;
	/** Where a note of this person's is opened on the web, as an origin. Absent →
	 *  the page's own, which is the answer wherever the shell is served from one
	 *  a peer could open; a shell that is not names this or nothing. */
	webOrigin?(): string | undefined;
	/** Hand a person a file to keep. Absent → the browser saves it, which is
	 *  what a tab does and a webview does not, so a shell inside one supplies
	 *  this; `null` where it has no way to save one, and the offer of a copy
	 *  says so rather than doing nothing. */
	saveFile?: ((name: string, body: Blob) => Promise<void>) | null;
	/** Ask a person for a file to bring in; `accept` is a file input's list of
	 *  extensions. Resolving to `null` is a person who chose none. Absent → a
	 *  file input on the page, which is what a tab has; `null` where the shell
	 *  has no way to ask at all, and the offer says so rather than doing
	 *  nothing. */
	openFile?: ((accept: string) => Promise<File | null>) | null;
	/** Present where the graph in front of somebody is a folder on this device,
	 *  and absent everywhere else — a shell that defines it also defines
	 *  {@link createApi}. It is what the first-run surface asks for a folder
	 *  with, so no page spells a platform's way of finding one. */
	vault?: VaultAccess;
	/** The folders open at once on this device — a shell that defines it also
	 *  defines {@link AppRuntime.vault}. Absent → this shell opens one folder at
	 *  a time, and nothing about tabs is put in front of anybody.
	 *  {@link TabsAccess} declares every act. */
	tabs?: TabsAccess;
	/** The identities this device holds, and the three ways one arrives —
	 *  a shell that defines it also defines {@link AppRuntime.vault}. Absent →
	 *  this platform keeps no identity of its own, so nothing about holding,
	 *  choosing or carrying one is put in front of anybody. `IdentityAccess` in
	 *  `@sloppy/local` declares every act. */
	identities?: IdentityAccess;
	/** The states the graph in front of somebody has been in — a shell that
	 *  defines it also defines {@link AppRuntime.vault}. Absent → this platform
	 *  keeps no history of a graph, and nothing about one is put in front of
	 *  anybody; `undefined` from it is a shell that keeps histories with no
	 *  graph open. `History` in `@sloppy/local` declares every act. */
	history?(): History | undefined;
	/** The code the graph in front of somebody is written about, rooted at the
	 *  project — a shell that defines it also defines {@link AppRuntime.vault}.
	 *  Absent → this platform reads no folder. `undefined` from it is a graph
	 *  that is nobody's project, where an anchor into code is the ordinary link
	 *  it is and nothing is offered to point at one; docs/ARCHITECTURE.md § "A
	 *  project's container" is what decides which. */
	project?(): Promise<Files | undefined>;
	/** What a folder started on this device begins with, kept beside the
	 *  graphs rather than in one — a shell that defines it also defines
	 *  {@link AppRuntime.vault}. Absent → nothing here can be told who its
	 *  commits are by, and nothing about that is put in front of anybody.
	 *  `GitDefaultsAccess` in `@sloppy/local` declares every act. */
	gitDefaults?: GitDefaultsAccess;
	/** What this device was given to reach the hosts a person keeps their
	 *  folders on. Absent → this platform holds none, so nothing is offered
	 *  that would need one. `CredentialsAccess` in `@sloppy/local` declares
	 *  every act. */
	credentials?: CredentialsAccess;
	/** The keys this device holds for the agents a key opens. Absent → this
	 *  platform keeps none, so nothing that would need one is offered.
	 *  `AiKeysAccess` in `@sloppy/local` declares every act. */
	aiKeys?: AiKeysAccess;
	/** Chatting with an agent on this device about the project — a shell that
	 *  defines it also defines {@link AppRuntime.project}. Absent → nothing here
	 *  can run a program of the person's, so nothing about a chat is put in
	 *  front of anybody, which is every browser tab. {@link ChatAccess}
	 *  declares every act. */
	chat?: ChatAccess;
	/** The chats this device holds — a shell that defines it also defines
	 *  {@link AppRuntime.chat}. Absent → nothing here keeps a conversation, so
	 *  a chat lasts as long as the page showing it and nothing about a list of
	 *  them is put in front of anybody. `ThreadsAccess` in `@sloppy/local`
	 *  declares every act. */
	threads?: ThreadsAccess;
	/**
	 * The files for a place a thread may read, rooted at `root` — what a store
	 * serving that place's note acts is handed, exactly as
	 * {@link AppRuntime.project} answers for the project the chat is about.
	 *
	 * `undefined` is a root this shell will NOT serve, which is the answer for
	 * anything the person has not opened: the shell holds the list of folders
	 * it admits and this is where that list is read. Absent → this platform
	 * reads no folder but the one in front of somebody, so nothing about
	 * adding a place is offered.
	 */
	placeFiles?(root: string): Files | undefined;
	/**
	 * Ask somebody for another folder a thread may read, and admit it — the one
	 * way a root {@link placeFiles} did not already serve becomes one it does.
	 * Resolves with the folder and whatever graph it already holds, or
	 * `undefined` where nobody named one.
	 *
	 * **The folder is read and nothing else.** It is not opened, not served, and
	 * no graph is started in it, so a folder somebody reads from is left exactly
	 * as they keep it and the graph in front of them does not move. Absent → the
	 * places a chat reads are the folders this device already knows, and naming
	 * another is not offered.
	 */
	askPlace?(): Promise<KnownFolder | undefined>;
	/** How a stored picture's address becomes one this page can load. Absent →
	 *  the API's proxy, so viewing somebody else's note never reaches their
	 *  instance from here. A shell serving a graph off the device answers with
	 *  the address its own webview loads a file from — nothing it holds is
	 *  somebody else's to leak. */
	assetSrc?(src: string): string;
}

const TOKEN_KEY = 'sloppy_token';

/**
 * Existing and being readable are different things: a browser told to block site
 * data throws on the accessor itself, so `typeof localStorage` is not a guard —
 * it throws too. This runs at module scope, so an unguarded read loses the whole
 * app at import for anyone with cookies off. They get a session that lasts the
 * life of the tab instead.
 */
function storedToken(): string | undefined {
	try {
		return localStorage.getItem(TOKEN_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

function storeToken(v: string | undefined): void {
	try {
		if (v === undefined) localStorage.removeItem(TOKEN_KEY);
		else localStorage.setItem(TOKEN_KEY, v);
	} catch {
		// Memory already holds it; persisting is the only thing lost.
	}
}

let memToken: string | undefined = storedToken();

const localStorageToken: AppRuntime['token'] = {
	get: () => memToken,
	set: (v) => {
		memToken = v;
		storeToken(v);
	},
	clear: () => {
		memToken = undefined;
		storeToken(undefined);
	}
};

let current: AppRuntime = {
	apiHost: () => '',
	mode: () => 'hosted',
	token: localStorageToken,
	fetchImpl: () => globalThis.fetch.bind(globalThis)
};

function host(): string {
	return storedOrigin() ?? current.apiHost();
}

/**
 * Call from the shell's root layout, before any page mounts. Unset fields keep
 * their defaults, and it is idempotent.
 */
export function initRuntime(rt: Partial<AppRuntime> & Pick<AppRuntime, 'apiHost'>): void {
	updateRuntime(rt);
}

/**
 * Settle a member again while the app is running, for a shell that serves the
 * graph from one place and then from another. A field passed as `undefined`
 * becomes absent, which is what puts its documented absence back; a field left
 * out is untouched. The caller swaps what serves the app, so it calls
 * {@link resetApi} as well.
 */
export function updateRuntime(rt: Partial<AppRuntime>): void {
	current = { ...current, ...rt };
	setHost(host());
}

/**
 * Point a running app at the Sloppy this device now names. That alone re-points
 * a live client, because the client reads the host per request — swapping
 * remote ↔ local is what additionally needs {@link resetApi}.
 *
 * A session belongs to the Sloppy that opened it, so the caller ends it and
 * lets go of what was read as well.
 */
export function repointRuntime(): void {
	setHost(host());
}

/** Late-binding facade — modules hold this, never the config object itself. */
export const runtime = {
	/** The origin in use — the one this device names, else {@link AppRuntime.apiHost}. */
	apiHost: () => host(),
	mode: () => current.mode(),
	token: {
		get: () => current.token.get(),
		set: (v: string) => current.token.set(v),
		clear: () => current.token.clear()
	},
	fetchImpl: () => current.fetchImpl(),
	authInvalid: () => current.onAuthInvalid?.(),
	openExternal: (): AppRuntime['openExternal'] => current.openExternal,
	signInRedirect: (): string | undefined => current.signInRedirect?.(),
	createApi: (): SloppyApi | undefined => current.createApi?.(),
	webOrigin: (): string | undefined => current.webOrigin?.(),
	vault: (): VaultAccess | undefined => current.vault,
	tabs: (): TabsAccess | undefined => current.tabs,
	identities: (): IdentityAccess | undefined => current.identities,
	history: (): History | undefined => current.history?.(),
	project: async (): Promise<Files | undefined> => current.project?.(),
	gitDefaults: (): GitDefaultsAccess | undefined => current.gitDefaults,
	credentials: (): CredentialsAccess | undefined => current.credentials,
	aiKeys: (): AiKeysAccess | undefined => current.aiKeys,
	chat: (): ChatAccess | undefined => current.chat,
	threads: (): ThreadsAccess | undefined => current.threads,
	placeFiles: (): AppRuntime['placeFiles'] => current.placeFiles,
	askPlace: (): AppRuntime['askPlace'] => current.askPlace,
	saveFile: (): AppRuntime['saveFile'] => current.saveFile,
	openFile: (): AppRuntime['openFile'] => current.openFile,
	assetSrc: (): AppRuntime['assetSrc'] => current.assetSrc
};
