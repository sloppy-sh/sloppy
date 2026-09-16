//! The commands behind the remote half of `History` in `@sloppy/local`, which
//! declares every act and what its answer means —
//! docs/ARCHITECTURE.md § "The vault's history" names each one and what it is
//! handed.
//!
//! A credential is never held here: the page reads it and passes it per call,
//! so this shell keeps no secret of anybody's.
