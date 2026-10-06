# Vendored crates

A crate here is somebody else's source kept in this repository, built from this
path rather than fetched. Each keeps the licence it arrived under.

## `tauri-plugin-crypto-hw`

Sealing an API key with whatever this device holds keys in — a secure element,
a TPM, the system keyring, or a file as the last resort.
`docs/ARCHITECTURE.md` § "Asking a tool to write the notes" says what Sloppy
does with it; the crate's own README says what each platform seals with.

- From <https://github.com/sosweetham/tauri-plugin-crypto-hw>, at `d31be08`,
  which is version 0.2.0.
- MIT, and `LICENSE.md` beside the source is that licence.
- Only what the crate itself needs is here. Its npm half is not: this app calls
  the commands by name through `invoke`, so there is nothing to import.

**To take a newer one**, replace the directory from that repository and bump the
path dependency if its version moved:

    git -C <the plugin> archive <rev> android build.rs Cargo.toml ios \
      LICENSE.md permissions README.md src \
      | tar -x -C apps/sloppy/native/src-tauri/vendor/tauri-plugin-crypto-hw

**Changes made here do not travel.** Anything worth keeping belongs in that
repository first, and then comes back through the line above — otherwise the
next person to update this directory writes over it.
