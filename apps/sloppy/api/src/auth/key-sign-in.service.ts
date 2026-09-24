import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { verifyOpenPgpSignature } from "@sloppy/openpgp";
import {
  type AnswerChallengeRequest,
  type BoundKey,
  bindingFor,
  type KeyBinding,
  type Principal,
  type Session,
  type SignatureScheme,
  type SignInChallenge,
} from "@sloppy/types";
import { AppConfigService } from "../config/app-config.service";
import { ownOrigin } from "../media/remote-host";
import { SignInChallenges } from "./challenge";
import { KEY_BINDINGS } from "./key-bindings";
import { SESSION_SECRET } from "./session-secret";
import { SessionStore, viewerOf } from "./session.store";

/** Long enough to sign something on another device, short enough that a
 *  statement left on a screen is not a way in tomorrow. */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/**
 * How long a session settled this way lasts. There is no instance to ask
 * whether it still stands, so the expiry IS the whole of what ends it — a
 * person signs in again rather than being carried indefinitely.
 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type SignatureCheck = (params: {
  payload: string;
  signature: string;
  publicKey: string;
}) => Promise<boolean>;

/** A scheme with no check here authenticates nobody. Nothing in this build
 *  binds a key that signs content in `ed25519-multibase`. */
const CHECKS: Record<SignatureScheme, SignatureCheck | null> = {
  openpgp: verifyOpenPgpSignature,
  "ed25519-multibase": null,
};

const SIGNATURE_ARMOR =
  /-----BEGIN PGP SIGNATURE-----[\s\S]*?-----END PGP SIGNATURE-----/;

/** The signature in what somebody pasted. A key that hands the text back with
 *  the signature in it has still signed the text, and what the signature is
 *  held to is the statement this instance issued either way. */
function signatureIn(pasted: string): string {
  return SIGNATURE_ARMOR.exec(pasted)?.[0] ?? pasted;
}

/**
 * Signing in with a key of your own — docs/ARCHITECTURE.md § "Signing in with a
 * key of your own".
 *
 * Nothing here discovers a key. {@link KeyBinding} is asked which keys speak
 * for the principal, and a binding that answers `null` is a question that went
 * unanswered rather than an identity nobody holds a key for.
 */
@Injectable()
export class KeySignInService {
  private readonly logger = new Logger(KeySignInService.name);
  private readonly challenges: SignInChallenges;

  constructor(
    private readonly app: AppConfigService,
    @Inject(SESSION_SECRET) secret: string,
    @Inject(KEY_BINDINGS) private readonly bindings: readonly KeyBinding[],
    private readonly sessions: SessionStore,
  ) {
    this.challenges = new SignInChallenges(secret, CHALLENGE_TTL_MS);
  }

  challenge(principal: Principal): SignInChallenge {
    return this.challenges.issue({ principal, origin: this.origin });
  }

  async answer(request: AnswerChallengeRequest): Promise<Session> {
    const read = this.challenges.read(request.statement);
    if (!read || read.claim.origin !== this.origin) {
      throw new UnauthorizedException(
        "That text is not one Sloppy is waiting for. Start again.",
      );
    }
    const { principal } = read.claim;

    const keys = await this.keysThatSign(principal);
    const signature = signatureIn(request.signature);
    if (!(await this.signedBy(keys, read.statement, signature))) {
      throw new UnauthorizedException(
        "That signature does not check out for that address. Sign the text exactly as it is shown, with a key that address is known by, then paste the signature again.",
      );
    }
    if (!this.challenges.spend(read.token)) {
      throw new UnauthorizedException(
        "That text has already been used. Start again.",
      );
    }

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { credential, row } = await this.sessions.issue({
      did: principal,
      expires_at: expiresAt,
    });
    this.logger.log(`Signed in ${principal} by signature`);
    return { token: credential, expires_at: expiresAt, viewer: viewerOf(row) };
  }

  private get origin(): string {
    const origin = ownOrigin(this.app.publicUrl);
    if (!origin) {
      throw new ServiceUnavailableException(
        "Sloppy cannot sign anybody in just now. Try again in a moment.",
      );
    }
    return origin;
  }

  /** Which may be none. Neither door says whether a key was found for an
   *  address, so no keys meets the same refusal a wrong signature does. */
  private async keysThatSign(
    principal: Principal,
  ): Promise<readonly BoundKey[]> {
    const binding = bindingFor(principal, this.bindings);
    const held = binding ? await binding.keysFor(principal) : [];
    if (held === null) {
      throw new ServiceUnavailableException(
        "Sloppy could not check your key just now. Try again in a moment.",
      );
    }
    return held.filter((key) => key.signs === "content");
  }

  private async signedBy(
    keys: readonly BoundKey[],
    statement: string,
    signature: string,
  ): Promise<boolean> {
    // Somebody signs a file, and a file written by almost anything ends in a
    // newline that the text on screen does not have.
    const payloads = [statement, `${statement}\n`];
    for (const key of keys) {
      const check = CHECKS[key.scheme];
      if (!check) continue;
      for (const payload of payloads) {
        if (await check({ payload, signature, publicKey: key.key }))
          return true;
      }
    }
    return false;
  }
}
