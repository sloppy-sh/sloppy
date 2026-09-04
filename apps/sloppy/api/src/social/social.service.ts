import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  splitOwnedRef,
  asTimestamp,
  type CommentSignedPayloadV1,
  CreateNoteCommentRequestSchema,
  CreateNoteReactionRequestSchema,
  type CustomEmoji,
  type DidSyr,
  type NoteComment,
  type NoteReaction,
  type OwnedRef,
  splitStoreRef,
  StoreRefSchema,
  storeRefFor,
  type SyrComment,
  type SyrEmoji,
  type SyrReaction,
  syrPostRefFor,
} from "@sloppy/types";
import type { z } from "zod";
import { AppConfigService } from "../config/app-config.service";
import { AssetLinks } from "../media/asset-link";
import type { HostPolicy } from "../media/remote-host";
import { peerReach } from "../peer/peer-fetch";
import { type Delegation, SyrService } from "../syr/syr.service";
import { PointerRepository } from "./pointer.repository";

/** As the route parsed them: what the wire accepts is the request type, and
 *  what a schema hands back after trimming and defaulting is this. */
type CreateNoteComment = z.output<typeof CreateNoteCommentRequestSchema>;
type CreateNoteReaction = z.output<typeof CreateNoteReactionRequestSchema>;

/** The two halves a note is addressed by inside an identity store, which never
 *  learns it is a note. */
type PostRef = ReturnType<typeof syrPostRefFor>;

/**
 * One store this reader can reach, and where it answers. A DID names a person
 * and never a place, so the instance travels with it everywhere: an identity
 * hosted elsewhere is not in this instance's manifest and asking here for one
 * of their records answers nothing at all.
 *
 * `reach` is present on every store but the reader's own, whose address the
 * deployment chose: everywhere else is an address somebody named, held to the
 * one answer `media/remote-host.ts` gives about which this instance connects to.
 */
interface Voice {
  did: DidSyr;
  where: string;
  reach?: HostPolicy;
}

/** What one voice held, kept beside the voice so a second read of the same
 *  record goes back to the store that served it. */
interface Held<T> {
  from: Voice;
  record: T;
}

/**
 * Comments and reactions on a note, assembled out of identity stores — Sloppy
 * holds none of them, and neither `comment` nor `reaction` is a word in its
 * vocabulary. AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store".
 *
 * Discovery is pull-only, so what this can answer with is what the reader and
 * the identities they follow have written, and nothing beyond it. A surface
 * that implies otherwise is lying; docs/ARCHITECTURE.md § "Federating the
 * graph" carries the consequence.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    private readonly syr: SyrService,
    private readonly links: AssetLinks,
    private readonly pointers: PointerRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Somebody's claim that they said something about a note of the author's. It
   * is stored and nothing more: what makes it show is the read, which resolves
   * the claimed identity to its own store and keeps only what that store serves
   * in that name.
   *
   * The answer says nothing about whether it was kept. A depositor learning
   * that a bound refused them, or that a note admits no answers, learns
   * something about somebody else's graph they did not already know.
   */
  async leaveReply(
    note: OwnedRef,
    left: { voice: DidSyr; comment_id: string },
  ): Promise<void> {
    const author = splitOwnedRef(note).did;
    if (left.voice === author) return;
    if (!(await this.pointers.admitsAnswers(author, note))) return;
    await this.pointers.leave({ author, note, ...left });
  }

  /** Oldest first, which is the order a conversation is read in. */
  async comments(
    delegation: Delegation,
    node: OwnedRef,
  ): Promise<NoteComment[]> {
    const post = syrPostRefFor(node);
    const written = await this.fromEveryVoice(
      delegation,
      (voice) =>
        this.syr.listPublicComments(voice.where, voice.did, post, voice.reach),
      node,
    );
    return written
      .map((held) => held.record)
      .filter((comment) => this.isAbout(comment, post))
      .map((comment) => this.commentView(comment, node))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /**
   * Written to the reader's own store and then signed there, because syr's
   * create route drops the signed envelope it accepts. A signature that does
   * not land leaves the comment unsigned, which is an ordinary state of one and
   * not worth losing what somebody wrote over.
   */
  async comment(
    delegation: Delegation,
    request: CreateNoteComment,
  ): Promise<NoteComment> {
    const post = syrPostRefFor(request.node);
    const ancestors = request.reply_to
      ? await this.chainTo(delegation, post, request.reply_to)
      : [];
    const written = await this.syr.createComment(delegation, {
      ...post,
      ancestor_chain: ancestors,
      content: request.content,
      visibility: "public",
      status: "completed",
    });
    await this.sign(delegation, written, post);
    return this.commentView(written, request.node);
  }

  async removeComment(
    delegation: Delegation,
    commentId: string,
  ): Promise<void> {
    await this.syr.deleteComment(delegation, storeRecord(commentId));
  }

  async reactions(
    delegation: Delegation,
    node: OwnedRef,
  ): Promise<NoteReaction[]> {
    const post = syrPostRefFor(node);
    const made = await this.fromEveryVoice(
      delegation,
      (voice) =>
        this.syr.listPublicReactions(voice.where, voice.did, post, voice.reach),
      node,
    );
    const catalogs = new Catalogs((voice) =>
      this.syr.listPublicEmoji(voice.where, voice.did, voice.reach),
    );
    const drawn: NoteReaction[] = [];
    for (const held of made.sort((a, b) =>
      a.record.created_at.localeCompare(b.record.created_at),
    )) {
      if (!this.isOn(held.record, post)) continue;
      const view = await this.reactionView(
        held.from,
        held.record,
        node,
        catalogs,
      );
      if (view) drawn.push(view);
    }
    return drawn;
  }

  async react(
    delegation: Delegation,
    request: CreateNoteReaction,
  ): Promise<NoteReaction> {
    const node = request.node;
    const post = syrPostRefFor(node);
    const carried =
      request.kind === "character"
        ? { kind: "unicode" as const, value: request.character }
        : await this.ownEmojiReaction(delegation, request.emoji_id);
    const wanted = {
      parent_type: "post" as const,
      parent_did: post.post_did,
      parent_id: post.post_id,
      ...carried,
    };
    // syr's create route toggles and no pair of calls to it is atomic, so a
    // mark the person already made is read back rather than sent again: sending
    // it takes it off, and putting it back is then one more call's luck.
    const held = await this.ownMark(delegation, post, carried);
    const made =
      held ??
      (await this.syr.createReaction(delegation, wanted)) ??
      (await this.syr.createReaction(delegation, wanted));
    if (!made) {
      throw new BadRequestException(
        "That reaction could not be added. Try again.",
      );
    }
    const catalogs = new Catalogs((voice) =>
      this.syr.listPublicEmoji(voice.where, voice.did, voice.reach),
    );
    // The reader's own reaction, so their own instance is where it is read back.
    const view = await this.reactionView(
      { did: delegation.did, where: delegation.syr_instance_url },
      made,
      node,
      catalogs,
    );
    if (!view) {
      throw new BadRequestException(
        "That reaction could not be added. Try again.",
      );
    }
    return view;
  }

  async removeReaction(
    delegation: Delegation,
    reactionId: string,
  ): Promise<void> {
    await this.syr.deleteReaction(delegation, storeRecord(reactionId));
  }

  /**
   * Every store the reader can reach: their own, and those of the identities
   * they follow, each at the instance that hosts it.
   *
   * A pointer carries no address, so where its voice answers is asked of the
   * READER's own instance and never taken from the deposit. Nothing in syr
   * binds a DID to a place — a store answering in a name proves nothing about
   * whose name it is — so a voice this instance cannot place is one whose words
   * nobody here can attribute, and it is left out. docs/ARCHITECTURE.md
   * § "Federating the graph" carries what that costs.
   */
  private async voices(
    delegation: Delegation,
    about?: OwnedRef,
  ): Promise<Voice[]> {
    const own = delegation.syr_instance_url;
    const elsewhere = peerReach(this.config);
    const at = (did: DidSyr, where: string): Voice =>
      where === own ? { did, where } : { did, where, reach: elsewhere };

    const reachable: Voice[] = [at(delegation.did, own)];
    const already = new Set<DidSyr>([delegation.did]);
    try {
      for (const follow of await this.syr.listFollowing(delegation)) {
        if (already.has(follow.followed_did)) continue;
        already.add(follow.followed_did);
        reachable.push(
          at(follow.followed_did, follow.followed_provider_url ?? own),
        );
      }
    } catch (err) {
      this.logger.warn(
        `Could not read who ${delegation.did} follows: ${reason(err)}`,
      );
    }
    // A note of the reader's own reaches further than the reader does: somebody
    // they do not follow can still have left a pointer on it, which is the whole
    // of how a stranger's answer arrives at all.
    if (about !== undefined && splitOwnedRef(about).did === delegation.did) {
      const claimed: DidSyr[] = [];
      for (const left of await this.pointers.pointersOn(
        delegation.did,
        about,
      )) {
        if (already.has(left.voice)) continue;
        already.add(left.voice);
        claimed.push(left.voice);
      }
      const stores = await Promise.all(
        claimed.map((voice) => this.syr.providerFor(own, voice)),
      );
      claimed.forEach((did, which) => {
        const where = stores[which];
        if (where !== null) reachable.push(at(did, where));
      });
    }
    return reachable;
  }

  /**
   * What every reachable store answers, each record still paired with the voice
   * that served it — and nothing it answers in a name it does not hold. One
   * identity's own endpoint is asked about one note, so a record carrying
   * anybody else's DID is dropped rather than drawn; docs/ARCHITECTURE.md
   * § "Federating the graph" carries why it has to be.
   *
   * A store that will not answer costs that person's words rather than the
   * whole conversation, which is why nothing here throws on one.
   */
  private async fromEveryVoice<T extends { did: DidSyr }>(
    delegation: Delegation,
    read: (voice: Voice) => Promise<T[]>,
    about?: OwnedRef,
  ): Promise<Held<T>[]> {
    const voices = await this.voices(delegation, about);
    const answers = await Promise.allSettled(voices.map(read));
    const held: Held<T>[] = [];
    answers.forEach((answer, at) => {
      const from = voices[at];
      if (answer.status === "rejected") {
        this.logger.warn(
          `${from.did} did not answer: ${reason(answer.reason)}`,
        );
        return;
      }
      const theirs = answer.value.filter((record) => record.did === from.did);
      if (theirs.length !== answer.value.length) {
        this.logger.warn(
          `${from.where} answered for ${from.did} carrying ${
            answer.value.length - theirs.length
          } record(s) attributed to somebody else.`,
        );
      }
      for (const record of theirs) held.push({ from, record });
    });
    return held;
  }

  /**
   * Root first, immediate parent last — the shape syr threads on. The parent's
   * own chain is read from the store that holds it; a parent this reader cannot
   * see leaves a chain of one, which still says what the reply answers.
   */
  private async chainTo(
    delegation: Delegation,
    post: PostRef,
    replyTo: string,
  ): Promise<string[]> {
    const parent = splitStoreRef(StoreRefSchema.parse(replyTo));
    const voices = await this.voices(delegation);
    const author = voices.find((voice) => voice.did === parent.did);
    if (!author) return [replyTo];
    try {
      const theirs = await this.syr.listPublicComments(
        author.where,
        author.did,
        post,
        author.reach,
      );
      const held = theirs.find(
        (one) => one.did === author.did && one.local_id === parent.localId,
      );
      if (held) return [...held.ancestor_chain, replyTo];
    } catch (err) {
      this.logger.warn(`Could not read ${replyTo}: ${reason(err)}`);
    }
    return [replyTo];
  }

  private async sign(
    delegation: Delegation,
    written: SyrComment,
    post: PostRef,
  ): Promise<void> {
    // `created_at` is the store's own serialization of what it just wrote: the
    // signature is over those bytes, not over a timestamp normalized here.
    const payload: CommentSignedPayloadV1 = {
      type: "comment@v1",
      did: written.did,
      comment_id: written.local_id,
      ...post,
      ancestor_chain: written.ancestor_chain,
      content: written.content,
      visibility: "public",
      status: "completed",
      created_at: written.created_at,
    };
    try {
      const signed = await this.syr.signContent(
        delegation,
        payload,
        "comment@v1",
      );
      await this.syr.signComment(
        delegation,
        { did: written.did, localId: written.local_id },
        {
          content_signature: signed.signature,
          signed_payload_json: JSON.stringify(payload),
          signing_device_public_key: signed.delegate_public_key,
        },
      );
    } catch (err) {
      this.logger.warn(`Comment left unsigned: ${reason(err)}`);
    }
  }

  private isAbout(comment: SyrComment, post: PostRef): boolean {
    return (
      comment.post_did === post.post_did && comment.post_id === post.post_id
    );
  }

  /**
   * The mark this person has already made on this note, of the one they are
   * asking for. Their own store is the only one they can have made it in, and a
   * read that does not land answers `null` — no worse than not asking, which is
   * what {@link react} does with it.
   */
  private async ownMark(
    delegation: Delegation,
    post: PostRef,
    carried: { kind: SyrReaction["kind"]; value: string },
  ): Promise<SyrReaction | null> {
    try {
      const made = await this.syr.listPublicReactions(
        delegation.syr_instance_url,
        delegation.did,
        post,
      );
      return (
        made.find(
          (one) =>
            one.did === delegation.did &&
            this.isOn(one, post) &&
            one.kind === carried.kind &&
            one.value === carried.value,
        ) ?? null
      );
    } catch (err) {
      this.logger.warn(
        `Could not read what ${delegation.did} has already marked: ${reason(err)}`,
      );
      return null;
    }
  }

  private isOn(reaction: SyrReaction, post: PostRef): boolean {
    return (
      reaction.parent_type === "post" &&
      reaction.parent_did === post.post_did &&
      reaction.parent_id === post.post_id
    );
  }

  private commentView(comment: SyrComment, node: OwnedRef): NoteComment {
    const parent = StoreRefSchema.safeParse(comment.ancestor_chain.at(-1));
    return {
      comment_id: storeRefFor(comment.did, comment.local_id),
      author: comment.did,
      node,
      ...(parent.success ? { reply_to: parent.data } : {}),
      content: comment.content,
      created_at: asTimestamp(comment.created_at),
      updated_at: asTimestamp(comment.updated_at),
      ...(comment.content_signature
        ? { content_signature: comment.content_signature }
        : {}),
      ...(comment.signed_payload_json
        ? { signed_payload_json: comment.signed_payload_json }
        : {}),
      ...(comment.signing_device_public_key
        ? { signing_device_public_key: comment.signing_device_public_key }
        : {}),
    };
  }

  /**
   * `null` for a reaction this build cannot draw — one carried by a kind it has
   * no renderer for, or naming an entry that has left its author's catalog.
   * Dropped rather than refused: one reaction nobody can see must not cost the
   * reader the rest of them.
   *
   * `from` is the store that served the reaction, which is also the one holding
   * the catalog it names.
   */
  private async reactionView(
    from: Voice,
    reaction: SyrReaction,
    node: OwnedRef,
    catalogs: Catalogs,
  ): Promise<NoteReaction | null> {
    const held = {
      reaction_id: storeRefFor(reaction.did, reaction.local_id),
      author: reaction.did,
      node,
    };
    if (reaction.kind === "unicode") {
      return { kind: "character", ...held, character: reaction.value };
    }
    if (reaction.kind === "gif") return null;
    const entry = await catalogs.entry(from, reaction.value);
    return entry
      ? { kind: "emoji", ...held, emoji: this.emojiView(entry) }
      : null;
  }

  /**
   * The caller's own catalog and no other. A reaction is read back through the
   * catalog of whoever MADE it, so one taken from somebody else's would arrive
   * unresolvable; and what is sent is read out of the store rather than off the
   * request, so a caller cannot point a reaction at a picture of their choosing.
   */
  private async ownEmojiReaction(delegation: Delegation, emojiId: string) {
    const named = catalogEntryId(emojiId);
    const catalog =
      named.did === delegation.did
        ? await this.syr.listPublicEmoji(delegation.syr_instance_url, named.did)
        : [];
    const entry = catalog.find((one) => one.local_id === named.localId);
    if (!entry) {
      throw new BadRequestException("Pick an emoji from your own set.");
    }
    return {
      kind: entry.is_sticker ? ("sticker" as const) : ("custom_emoji" as const),
      value: entry.shortcode,
      image_url: entry.url,
    };
  }

  private emojiView(entry: SyrEmoji): CustomEmoji {
    return {
      emoji_id: `${entry.did}/${entry.local_id}`,
      did: entry.did,
      shortcode: entry.shortcode,
      kind: entry.is_sticker ? "sticker" : "emoji",
      src: this.links.to(entry.url),
    };
  }
}

/**
 * The catalogs one read of a note's reactions has already asked for. A person
 * reacts with their own emoji, so this is one fetch per identity that used one
 * and none at all for a note reacted to off the keyboard.
 */
class Catalogs {
  private readonly held = new Map<string, Promise<SyrEmoji[]>>();

  constructor(private readonly read: (voice: Voice) => Promise<SyrEmoji[]>) {}

  async entry(voice: Voice, shortcode: string): Promise<SyrEmoji | undefined> {
    const key = `${voice.where}|${voice.did}`;
    let catalog = this.held.get(key);
    if (!catalog) {
      catalog = this.read(voice).catch(() => []);
      this.held.set(key, catalog);
    }
    const code = shortcode.toLowerCase();
    return (await catalog).find((one) => one.shortcode.toLowerCase() === code);
  }
}

/** A record an identity store issued, as everything that threads on one cites
 *  it: `<did>:<local id>`. */
function storeRecord(ref: string): { did: string; localId: string } {
  const parsed = StoreRefSchema.safeParse(ref);
  if (!parsed.success) throw new BadRequestException("That is not there.");
  return splitStoreRef(parsed.data);
}

/** A catalog entry, which Sloppy carries as `<did>/<local id>` — the form
 *  `CustomEmoji.emoji_id` already has. */
function catalogEntryId(emojiId: string): { did: string; localId: string } {
  const cut = emojiId.lastIndexOf("/");
  if (cut < 1 || cut === emojiId.length - 1) {
    throw new BadRequestException("Pick an emoji from your own set.");
  }
  return { did: emojiId.slice(0, cut), localId: emojiId.slice(cut + 1) };
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
