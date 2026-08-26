// One failure type, carrying both audiences.
//
// `code` is for a platform, which branches on it; `message` is for a person,
// and follows AI.md § "User-Facing Copy Names the Outcome, Never the
// Mechanism" — it says what to do next, not what broke.

export class IdpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IdpError";
  }
}

export function isIdpError(error: unknown): error is IdpError {
  return error instanceof IdpError;
}
