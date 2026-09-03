import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
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
import { AssetLinks } from "../media/asset-link";
import { type Delegation, SyrService } from "../syr/syr.service";

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
 */
interface Voice {
  did: DidSyr;
  where: string;
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
  ) {}

  /** Oldest first, which is the order a conversation is read in. */
  async comments(
    delegation: Delegation,
    node: OwnedRef,
  ): Promise<NoteComment[]> {
    const post = syrPostRefFor(node);
    const written = await this.fromEveryVoice(delegation, (where, did) =>
      this.syr.listPublicComments(where, did, post),
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
    const made = await this.fromEveryVoice(delegation, (where, did) =>
      this.syr.listPublicReactions(where, did, post),
    );
    const catalogs = new Catalogs((where, did) =>
      this.syr.listPublicEmoji(where, did),
    );
    const drawn: NoteReaction[] = [];
    for (const held of made.sort((a, b) =>
      a.record.created_at.localeCompare(b.record.created_at),
    )) {
      if (!this.isOn(held.record, post)) continue;
      const view = await this.reactionView(
        held.from.where,
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
    // syr's create route toggles, so a reaction the person already had comes
    // off; asking again puts back what the caller asked to be there.
    const made =
      (await this.syr.createReaction(delegation, wanted)) ??
      (await this.syr.createReaction(delegation, wanted));
    if (!made) {
      throw new BadRequestException(
        "That reaction could not be added. Try again.",
      );
    }
    const catalogs = new Catalogs((where, did) =>
      this.syr.listPublicEmoji(where, did),
    );
    // The reader's own reaction, so their own instance is where it is read back.
    const view = await this.reactionView(
      delegation.syr_instance_url,
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
   */
  private async voices(delegation: Delegation): Promise<Voice[]> {
    const reachable: Voice[] = [
      { did: delegation.did, where: delegation.syr_instance_url },
    ];
    try {
      for (const follow of await this.syr.listFollowing(delegation)) {
        if (follow.followed_did === delegation.did) continue;
        reachable.push({
          did: follow.followed_did,
          where: follow.followed_provider_url ?? delegation.syr_instance_url,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Could not read who ${delegation.did} follows: ${reason(err)}`,
      );
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
    read: (instanceUrl: string, did: DidSyr) => Promise<T[]>,
  ): Promise<Held<T>[]> {
    const voices = await this.voices(delegation);
    const answers = await Promise.allSettled(
      voices.map((voice) => read(voice.where, voice.did)),
    );
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
   * `where` is the instance that served the reaction, which is also the one
   * holding the catalog it names.
   */
  private async reactionView(
    where: string,
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
    const entry = await catalogs.entry(where, reaction.did, reaction.value);
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

  constructor(
    private readonly read: (
      instanceUrl: string,
      did: DidSyr,
    ) => Promise<SyrEmoji[]>,
  ) {}

  async entry(
    instanceUrl: string,
    did: DidSyr,
    shortcode: string,
  ): Promise<SyrEmoji | undefined> {
    const key = `${instanceUrl}|${did}`;
    let catalog = this.held.get(key);
    if (!catalog) {
      catalog = this.read(instanceUrl, did).catch(() => []);
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
