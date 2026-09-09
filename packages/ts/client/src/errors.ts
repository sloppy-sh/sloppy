/**
 * Any non-OK response. `detail` is the server's own `message` — words it chose
 * for a person — so a surface shows that where it has it, and its own copy
 * where it does not. `message` is for a log; it names a path and a status,
 * which is exactly what product copy may not say.
 */
export class SloppyApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: string;

  constructor(
    status: number,
    message: string,
    opts: { code?: string; detail?: string } = {},
  ) {
    super(message);
    this.name = "SloppyApiError";
    this.status = status;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

/**
 * A method whose contract is declared but whose milestone has not landed. It is
 * a named error rather than a missing method on purpose: a call site that wants
 * the feature compiles against the signature that will serve it, instead of
 * inventing a second one beside it.
 */
export class SloppyNotImplementedError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = "SloppyNotImplementedError";
    this.feature = feature;
  }
}

export function notImplemented(feature: string): never {
  throw new SloppyNotImplementedError(feature);
}

/**
 * Something that genuinely needs another machine to exist, asked of a client
 * serving a graph off this device. `feature` is a noun phrase, because it is
 * read as the first half of a sentence a person sees.
 */
export class ServerRequiredError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(`${feature} needs a server connection`);
    this.name = "ServerRequiredError";
    this.feature = feature;
  }
}

/** A whole method body, for anything a client cannot serve on its own. */
export function serverOnly(feature: string): never {
  throw new ServerRequiredError(feature);
}
