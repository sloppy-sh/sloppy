//! Signing a commit, and the key this app keeps for it — `SigningConfig` in
//! `@sloppy/local` is the shape, docs/ARCHITECTURE.md § "The vault's history"
//! is what each kind does.
//!
//! An ssh signature is made in this process, because a phone has no program to
//! call out to; an openpgp one is made by the program git config names, which
//! is a desktop's alone.
