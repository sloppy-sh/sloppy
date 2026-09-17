//! Signing a commit, and the key this app keeps for it — `SigningConfig` in
//! `@sloppy/local` is the shape, docs/ARCHITECTURE.md § "The vault's history"
//! is what each kind does.
//!
//! An ssh signature is made in this process, because a phone has no program to
//! call out to; an openpgp one is made by the program git config names, which
//! is a desktop's alone.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use git2::{Config, ConfigLevel, Oid, Repository};
use serde::{Deserialize, Serialize};
use ssh_key::rand_core::OsRng;
use ssh_key::{Algorithm, Fingerprint, HashAlg, LineEnding, PrivateKey, PublicKey, SshSig};

use crate::history::HistoryError;
use crate::vault::own_only;

/// The two halves of the key this app makes — `KEPT_KEY_FILE` and
/// `KEPT_KEY_PUBLIC_FILE` in `@sloppy/local`, in the same private data.
const KEPT_KEY: &str = "signing.key";
pub const KEPT_KEY_PUBLIC: &str = "signing.key.pub";

/// Who this folder takes a signature from. Git reads it wherever
/// `gpg.ssh.allowedSignersFile` points, and this app writes and reads it here.
const ALLOWED_SIGNERS: &str = ".sloppy/allowed_signers";

/// What git calls an SSHSIG made over a commit.
const NAMESPACE: &str = "git";

/// The program an openpgp signature is made by where nobody named one.
const DEFAULT_PROGRAM: &str = "gpg";

/// `SshKey` in `@sloppy/local`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SshKey {
    Kept,
    File { path: String },
}

/// `SigningConfig` in `@sloppy/local`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SigningConfig {
    None,
    #[serde(rename_all = "camelCase")]
    Ssh {
        key: SshKey,
        /// Answered about the key this app keeps, and never read back: what
        /// a folder signs with is the key, not the half a host is given.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_key: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Openpgp {
        #[serde(skip_serializing_if = "Option::is_none")]
        program: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        key_id: Option<String>,
    },
}

/// `Commit.signature` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct Signed {
    pub(crate) by: String,
    pub(crate) verified: bool,
}

fn said(config: &Config, key: &str) -> Option<String> {
    config
        .get_string(key)
        .ok()
        .map(|held| held.trim().to_owned())
        .filter(|held| !held.is_empty())
}

/// The one line a host takes the kept key in, and nothing where this device
/// has not made one yet.
fn shown(data: &Path) -> Option<String> {
    let (_, public) = kept_at(data);
    fs::read_to_string(public)
        .ok()
        .map(|held| held.trim().to_owned())
        .filter(|held| !held.is_empty())
}

/// The private half, and the public half beside it.
pub(crate) fn kept_at(data: &Path) -> (PathBuf, PathBuf) {
    (data.join(KEPT_KEY), data.join(KEPT_KEY_PUBLIC))
}

/// How this folder is signed, as git config has it. Signing turned on with no
/// key named is nothing signed, because there is nothing to sign with.
pub fn read(repo: &Repository, data: &Path) -> Result<SigningConfig, HistoryError> {
    let config = repo.config()?;
    if !config.get_bool("commit.gpgsign").unwrap_or(false) {
        return Ok(SigningConfig::None);
    }
    let named = said(&config, "user.signingkey");
    if said(&config, "gpg.format").as_deref() == Some("ssh") {
        return Ok(match named {
            Some(path) => {
                let key = which_key(&path, data);
                let public_key = matches!(key, SshKey::Kept).then(|| shown(data)).flatten();
                SigningConfig::Ssh { key, public_key }
            }
            None => SigningConfig::None,
        });
    }
    Ok(SigningConfig::Openpgp {
        program: said(&config, "gpg.program"),
        key_id: named,
    })
}

fn which_key(path: &str, data: &Path) -> SshKey {
    let (private, public) = kept_at(data);
    let named = PathBuf::from(path);
    if named == private || named == public {
        SshKey::Kept
    } else {
        SshKey::File {
            path: path.to_owned(),
        }
    }
}

/// How this folder signs from now on. What it is given has to be something this
/// device can sign with, and while somebody is choosing is the only place that
/// is said — docs/ARCHITECTURE.md § "The vault's history".
pub fn write(
    repo: &Repository,
    root: &Path,
    data: &Path,
    signing: &SigningConfig,
) -> Result<(), HistoryError> {
    let mut config = repo.config()?.open_level(ConfigLevel::Local)?;
    match signing {
        SigningConfig::None => {
            config.set_bool("commit.gpgsign", false)?;
        }
        SigningConfig::Ssh { key, .. } => {
            let (path, public) = ssh_key_of(key, data)?;
            vouch_for(root, &public)?;
            config.set_str("gpg.format", "ssh")?;
            config.set_str("user.signingkey", &path.to_string_lossy())?;
            config.set_str(
                "gpg.ssh.allowedSignersFile",
                &root.join(ALLOWED_SIGNERS).to_string_lossy(),
            )?;
            config.set_bool("commit.gpgsign", true)?;
        }
        SigningConfig::Openpgp { program, key_id } => {
            only_on_a_desktop()?;
            runs_here(program.as_deref().unwrap_or(DEFAULT_PROGRAM))?;
            config.set_str("gpg.format", "openpgp")?;
            match program {
                Some(program) => config.set_str("gpg.program", program)?,
                None => {
                    let _ = config.remove("gpg.program");
                }
            }
            match key_id {
                Some(key_id) => config.set_str("user.signingkey", key_id)?,
                None => {
                    let _ = config.remove("user.signingkey");
                }
            }
            config.set_bool("commit.gpgsign", true)?;
        }
    }
    Ok(())
}

#[cfg(desktop)]
fn only_on_a_desktop() -> Result<(), HistoryError> {
    Ok(())
}

#[cfg(not(desktop))]
fn only_on_a_desktop() -> Result<(), HistoryError> {
    Err(HistoryError::new(
        "Signing this way needs a computer. Sign with the key Sloppy keeps instead.",
    ))
}

/// Whether the program that would sign is one this machine can run: a name it
/// has nothing under, a folder and a file it may not execute are all the same
/// answer to somebody choosing.
fn runs_here(program: &str) -> Result<(), HistoryError> {
    use std::process::{Command, Stdio};

    match Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Err(_) => Err(no_program(program)),
        Ok(_) => Ok(()),
    }
}

/// Where the key is and what its public half says, the key made where it is the
/// one this app keeps and there is none yet.
fn ssh_key_of(key: &SshKey, data: &Path) -> Result<(PathBuf, PublicKey), HistoryError> {
    match key {
        SshKey::Kept => {
            let (_, public) = kept_at(data);
            let held = keep(data)?;
            Ok((public, held.public_key().clone()))
        }
        SshKey::File { path } => {
            let at = PathBuf::from(path);
            let public = public_half(&at)?;
            read_private(&at)?;
            Ok((at, public))
        }
    }
}

/// Both halves of a key somebody named by either of them. `user.signingkey` is
/// as often the public half as the private one — it is what a host asks a
/// person to paste — and the other half is the file beside it under the same
/// name.
pub(crate) fn halves(at: &Path) -> (PathBuf, PathBuf) {
    let named = at.to_string_lossy().into_owned();
    match named.strip_suffix(".pub") {
        Some(private) => (PathBuf::from(private), at.to_path_buf()),
        None => (at.to_path_buf(), PathBuf::from(format!("{named}.pub"))),
    }
}

/// The public half of a key somebody named, whichever half they named.
fn public_half(at: &Path) -> Result<PublicKey, HistoryError> {
    let (private, public) = halves(at);
    for path in [public, private] {
        if let Ok(held) = fs::read_to_string(&path) {
            if let Ok(public) = PublicKey::from_openssh(&held) {
                return Ok(public);
            }
            if let Ok(key) = PrivateKey::from_openssh(held.as_bytes()) {
                return Ok(key.public_key().clone());
            }
        }
    }
    Err(no_such_key())
}

fn no_such_key() -> HistoryError {
    HistoryError::new("Sloppy cannot read that key. Choose another one.")
}

/// The key this app keeps, made the first time it is asked for. The private
/// half is nobody else's business and is written as such.
pub fn keep(data: &Path) -> Result<PrivateKey, HistoryError> {
    let (private, public) = kept_at(data);
    if let Ok(held) = fs::read(&private) {
        if let Ok(key) = PrivateKey::from_openssh(&held) {
            if !public.exists() {
                write_public(&public, key.public_key())?;
            }
            return Ok(key);
        }
    }
    let key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).map_err(|_| no_such_key())?;
    fs::create_dir_all(data)?;
    fs::write(
        &private,
        key.to_openssh(LineEnding::LF)
            .map_err(|_| no_such_key())?
            .as_bytes(),
    )?;
    own_only(&private, 0o600)?;
    write_public(&public, key.public_key())?;
    Ok(key)
}

fn write_public(at: &Path, key: &PublicKey) -> Result<(), HistoryError> {
    let mut held = key.to_openssh().map_err(|_| no_such_key())?;
    held.push('\n');
    fs::write(at, held)?;
    Ok(())
}

/// The folder vouches for this key from now on, and goes on vouching for
/// whatever it vouched for before.
fn vouch_for(root: &Path, key: &PublicKey) -> Result<(), HistoryError> {
    let at = root.join(ALLOWED_SIGNERS);
    let held = fs::read_to_string(&at).unwrap_or_default();
    let mark = key.fingerprint(HashAlg::Sha256);
    if vouched(&held).contains(&mark) {
        return Ok(());
    }
    let mut written = held;
    if !written.is_empty() && !written.ends_with('\n') {
        written.push('\n');
    }
    let who = key.comment();
    let who = if who.trim().is_empty() {
        "sloppy"
    } else {
        who.trim()
    };
    written.push_str(&format!(
        "{who} {}\n",
        key.to_openssh().map_err(|_| no_such_key())?
    ));
    if let Some(folder) = at.parent() {
        fs::create_dir_all(folder)?;
    }
    fs::write(&at, written)?;
    Ok(())
}

/// Every key an allowed signers file vouches for. A line this cannot read is
/// one somebody else's tool wrote and is left alone rather than refused.
fn vouched(held: &str) -> Vec<Fingerprint> {
    let mut found = Vec::new();
    for line in held.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        for (at, part) in parts.iter().enumerate() {
            if !(part.starts_with("ssh-") || part.starts_with("ecdsa-") || part.starts_with("sk-"))
            {
                continue;
            }
            let Some(encoded) = parts.get(at + 1) else {
                continue;
            };
            if let Ok(key) = PublicKey::from_openssh(&format!("{part} {encoded}")) {
                found.push(key.fingerprint(HashAlg::Sha256));
            }
            break;
        }
    }
    found
}

/// The keys this device can tell are what they claim to be: the one it keeps,
/// and the ones this folder vouches for.
pub struct Trust {
    held: Vec<Fingerprint>,
}

impl Trust {
    pub fn of(root: &Path, data: &Path) -> Self {
        let mut held = vouched(&fs::read_to_string(root.join(ALLOWED_SIGNERS)).unwrap_or_default());
        let (_, public) = kept_at(data);
        if let Ok(kept) = fs::read_to_string(&public) {
            if let Ok(key) = PublicKey::from_openssh(&kept) {
                held.push(key.fingerprint(HashAlg::Sha256));
            }
        }
        Trust { held }
    }

    fn holds(&self, mark: &Fingerprint) -> bool {
        self.held.iter().any(|one| one == mark)
    }
}

/// What a listing says about a commit's signature, and nothing at all where
/// nobody signed it.
pub fn signature_of(repo: &Repository, id: Oid, trust: &Trust) -> Option<Signed> {
    let (armour, signed) = repo.extract_signature(&id, None).ok()?;
    let armour = std::str::from_utf8(&armour).ok()?.trim().to_owned();
    if armour.starts_with("-----BEGIN SSH SIGNATURE-----") {
        let sig = SshSig::from_pem(armour.as_bytes()).ok()?;
        let key = PublicKey::from(sig.public_key().clone());
        let mark = key.fingerprint(HashAlg::Sha256);
        let verified = trust.holds(&mark) && key.verify(NAMESPACE, &signed, &sig).is_ok();
        return Some(Signed {
            by: mark.to_string(),
            verified,
        });
    }
    if armour.starts_with("-----BEGIN PGP SIGNATURE-----") {
        return Some(Signed {
            // An openpgp key is neither one this app keeps nor one an allowed
            // signers file vouches for, which is the whole of what this device
            // can tell for itself.
            by: openpgp_issuer(&armour).unwrap_or_else(|| "an unknown key".to_owned()),
            verified: false,
        });
    }
    None
}

/// The signature over a commit, and nothing where this folder signs none.
pub fn sign(repo: &Repository, data: &Path, content: &str) -> Result<Option<String>, HistoryError> {
    match read(repo, data)? {
        SigningConfig::None => Ok(None),
        SigningConfig::Ssh { key, .. } => {
            let held = match key {
                SshKey::Kept => keep(data)?,
                SshKey::File { path } => read_private(Path::new(&path))?,
            };
            let sig = held
                .sign(NAMESPACE, HashAlg::Sha512, content.as_bytes())
                .map_err(|_| no_such_key())?;
            Ok(Some(sig.to_pem(LineEnding::LF).map_err(|_| no_such_key())?))
        }
        SigningConfig::Openpgp { program, key_id } => {
            only_on_a_desktop()?;
            Ok(Some(by_program(
                program.as_deref().unwrap_or(DEFAULT_PROGRAM),
                key_id.as_deref(),
                content,
            )?))
        }
    }
}

/// The half that signs, of the key somebody named by either half.
fn read_private(at: &Path) -> Result<PrivateKey, HistoryError> {
    let (private, _) = halves(at);
    let held = fs::read(&private).map_err(|_| no_such_key())?;
    let key = PrivateKey::from_openssh(&held).map_err(|_| no_such_key())?;
    if key.is_encrypted() {
        return Err(HistoryError::new(
            "That key is locked with a passphrase, which Sloppy cannot ask for yet. Choose one without it, or let Sloppy keep a key for you.",
        ));
    }
    Ok(key)
}

fn by_program(program: &str, key_id: Option<&str>, content: &str) -> Result<String, HistoryError> {
    use std::process::{Command, Stdio};

    let mut how = Command::new(program);
    how.arg("--armor").arg("--detach-sign");
    if let Some(key_id) = key_id {
        how.arg("--local-user").arg(key_id);
    }
    let mut running = how
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| no_program(program))?;
    running
        .stdin
        .take()
        .ok_or_else(|| no_program(program))?
        .write_all(content.as_bytes())?;
    let held = running.wait_with_output()?;
    if !held.status.success() {
        return Err(HistoryError::new(
            "Signing did not go through. Check that the key is one this computer can use.",
        ));
    }
    let armour = String::from_utf8(held.stdout)
        .map_err(|_| HistoryError::new("Signing did not go through. Try again."))?;
    Ok(armour)
}

fn no_program(program: &str) -> HistoryError {
    HistoryError::new(format!(
        "Sloppy could not run {program}. Check that it is installed."
    ))
}

/// The key an openpgp signature says made it, as the long id a person reads it
/// by — RFC 4880 § 5.2.3, the issuer subpacket of the signature packet.
fn openpgp_issuer(armour: &str) -> Option<String> {
    let packet = unarmoured(armour)?;
    let (tag, body) = first_packet(&packet)?;
    if tag != 2 || !matches!(*body.first()?, 4 | 5) {
        return None;
    }
    let mut at = 4;
    let mut found = None;
    for _ in 0..2 {
        let len = u16::from_be_bytes([*body.get(at)?, *body.get(at + 1)?]) as usize;
        let held = body.get(at + 2..at + 2 + len)?;
        if let Some(id) = issuer_in(held) {
            found = Some(id);
        }
        at += 2 + len;
        if found.is_some() {
            break;
        }
    }
    found
}

/// The base64 an armoured block carries, without its headers or the checksum
/// line that ends it.
fn unarmoured(armour: &str) -> Option<Vec<u8>> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine as _;

    let mut encoded = String::new();
    let mut started = false;
    for line in armour.lines() {
        let line = line.trim();
        if !started {
            if line.is_empty() {
                started = true;
            }
            continue;
        }
        if line.starts_with('=') || line.starts_with("-----END") {
            break;
        }
        encoded.push_str(line);
    }
    BASE64.decode(encoded).ok()
}

/// One packet's tag and body — RFC 4880 § 4.2, both length formats.
fn first_packet(held: &[u8]) -> Option<(u8, &[u8])> {
    let first = *held.first()?;
    if first & 0x80 == 0 {
        return None;
    }
    if first & 0x40 != 0 {
        let tag = first & 0x3f;
        let one = *held.get(1)? as usize;
        let (len, from) = match one {
            0..=191 => (one, 2),
            192..=223 => (((one - 192) << 8) + *held.get(2)? as usize + 192, 3),
            255 => (
                u32::from_be_bytes([*held.get(2)?, *held.get(3)?, *held.get(4)?, *held.get(5)?])
                    as usize,
                6,
            ),
            _ => return None,
        };
        return held.get(from..from + len).map(|body| (tag, body));
    }
    let tag = (first >> 2) & 0x0f;
    let (len, from) = match first & 0x03 {
        0 => (*held.get(1)? as usize, 2),
        1 => (
            u16::from_be_bytes([*held.get(1)?, *held.get(2)?]) as usize,
            3,
        ),
        2 => (
            u32::from_be_bytes([*held.get(1)?, *held.get(2)?, *held.get(3)?, *held.get(4)?])
                as usize,
            5,
        ),
        _ => return None,
    };
    held.get(from..from + len).map(|body| (tag, body))
}

/// The issuer among a run of subpackets: the key id itself, or the last eight
/// bytes of the fingerprint, which is the same id.
fn issuer_in(held: &[u8]) -> Option<String> {
    let mut at = 0;
    while at < held.len() {
        let one = *held.get(at)? as usize;
        let (len, from) = match one {
            0..=191 => (one, at + 1),
            192..=254 => (
                ((one - 192) << 8) + *held.get(at + 1)? as usize + 192,
                at + 2,
            ),
            _ => (
                u32::from_be_bytes([
                    *held.get(at + 1)?,
                    *held.get(at + 2)?,
                    *held.get(at + 3)?,
                    *held.get(at + 4)?,
                ]) as usize,
                at + 5,
            ),
        };
        if len == 0 {
            return None;
        }
        let kind = *held.get(from)? & 0x7f;
        let body = held.get(from + 1..from + len)?;
        if kind == 16 && body.len() == 8 {
            return Some(hex(body));
        }
        if kind == 33 && body.len() > 8 {
            return Some(hex(&body[body.len() - 8..]));
        }
        at = from + len;
    }
    None
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02X}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::tests::{made, private_for, scratch, vault};

    /// A detached signature `gpg` made, and the key it says made it.
    const BY_GPG: &str = "-----BEGIN PGP SIGNATURE-----

iJEEABYKADkWIQQ0G7WdWlXbFXz4qwYjsPsqRNKM7QUCaqsllBsUgAAAAAAEAA5t
YW51MiwyLjUrMS4xMiwwLDMACgkQI7D7KkTSjO33AAD/fJc7m42O/fWhEkACYFDJ
VDIcABdLs/cVieI07HJkB3UBAM4GspmQ/ODrCP9dBl7gBmuPELJXFGqXwp6Ao5zN
TOIB
=AKTD
-----END PGP SIGNATURE-----";

    #[test]
    fn an_openpgp_signature_says_which_key_made_it() {
        assert_eq!(openpgp_issuer(BY_GPG).as_deref(), Some("23B0FB2A44D28CED"));
        assert!(openpgp_issuer("-----BEGIN PGP SIGNATURE-----\n\nnot base64 at all\n").is_none());
    }

    #[test]
    fn the_key_this_app_keeps_is_made_once_and_then_kept() {
        let data = private_for(&scratch("kept"));
        let first = keep(&data).expect("a key");
        let again = keep(&data).expect("the same key");
        assert_eq!(
            first.fingerprint(HashAlg::Sha256),
            again.fingerprint(HashAlg::Sha256)
        );
        let public = fs::read_to_string(data.join(KEPT_KEY_PUBLIC)).expect("the public half");
        assert_eq!(
            PublicKey::from_openssh(&public)
                .expect("a key")
                .fingerprint(HashAlg::Sha256),
            first.fingerprint(HashAlg::Sha256)
        );
        assert!(public.starts_with("ssh-ed25519 "));
    }

    #[test]
    fn a_folder_vouches_for_what_it_vouched_for_before() {
        let root = scratch("vouching");
        let data = private_for(&root);
        fs::create_dir_all(root.join(".sloppy")).expect("the folder");
        let somebody = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).expect("a key");
        fs::write(
            root.join(ALLOWED_SIGNERS),
            format!(
                "# somebody wrote this\nnot a line this reads\nada@example.invalid {}\n",
                somebody.public_key().to_openssh().expect("the public half")
            ),
        )
        .expect("what the folder vouches for");

        let kept = keep(&data).expect("a key");
        vouch_for(&root, kept.public_key()).expect("vouching");
        vouch_for(&root, kept.public_key()).expect("vouching twice");

        let held = vouched(&fs::read_to_string(root.join(ALLOWED_SIGNERS)).expect("the file"));
        assert_eq!(held.len(), 2);
        assert!(held.contains(&somebody.public_key().fingerprint(HashAlg::Sha256)));
        assert!(held.contains(&kept.fingerprint(HashAlg::Sha256)));
    }

    #[test]
    fn a_key_a_person_named_signs_and_a_locked_one_says_what_to_do() {
        let root = vault();
        let data = private_for(&root);
        let theirs = scratch("their-keys");
        let at = theirs.join("id_ed25519");
        let key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).expect("a key");
        fs::write(
            &at,
            key.to_openssh(LineEnding::LF).expect("the key").as_bytes(),
        )
        .expect("their key file");

        let named = SigningConfig::Ssh {
            key: SshKey::File {
                path: at.to_string_lossy().into_owned(),
            },
            public_key: None,
        };
        let kept = crate::history::at(&root).expect("the repository");
        let repo = kept.repo();
        write(repo, &root, &data, &named).expect("the choice");
        assert!(matches!(
            read(repo, &data).expect("how it signs"),
            SigningConfig::Ssh {
                key: SshKey::File { .. },
                ..
            }
        ));
        drop(kept);

        let signed = made(&root, "A graph").signature.expect("a signature");
        assert_eq!(signed.by, key.fingerprint(HashAlg::Sha256).to_string());
        assert!(signed.verified);

        // A key nobody can open is a key nobody can sign with, and saying so is
        // the whole of what this device can do about it.
        let locked = std::process::Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "a passphrase", "-C", "", "-f"])
            .arg(theirs.join("locked"))
            .output();
        match locked {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => panic!("ssh-keygen: {error}"),
            Ok(held) => assert!(held.status.success()),
        }
        let kept = crate::history::at(&root).expect("the repository");
        let repo = kept.repo();
        assert_eq!(
            write(
                repo,
                &root,
                &data,
                &SigningConfig::Ssh {
                    key: SshKey::File {
                        path: theirs.join("locked").to_string_lossy().into_owned(),
                    },
                    public_key: None,
                },
            )
            .unwrap_err()
            .said(),
            "That key is locked with a passphrase, which Sloppy cannot ask for yet. Choose one without it, or let Sloppy keep a key for you."
        );
        // And the folder goes on signing with what it was already signing with.
        assert!(matches!(
            read(repo, &data).expect("how it signs"),
            SigningConfig::Ssh {
                key: SshKey::File { .. },
                ..
            }
        ));
    }

    /// A host asks a person for the public half, so that is the half their git
    /// config names as often as not — and a folder set up either way signs.
    #[test]
    fn a_key_named_by_either_half_signs_with_the_half_that_signs() {
        let theirs = scratch("their-public-half");
        let key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).expect("a key");
        let at = theirs.join("id_ed25519");
        fs::write(
            &at,
            key.to_openssh(LineEnding::LF).expect("the key").as_bytes(),
        )
        .expect("their key file");
        let public = theirs.join("id_ed25519.pub");
        write_public(&public, key.public_key()).expect("the half a host is given");

        for named in [public, at] {
            let root = vault();
            let data = private_for(&root);
            let kept = crate::history::at(&root).expect("the repository");
            let repo = kept.repo();
            write(
                repo,
                &root,
                &data,
                &SigningConfig::Ssh {
                    key: SshKey::File {
                        path: named.to_string_lossy().into_owned(),
                    },
                    public_key: None,
                },
            )
            .expect("the choice");
            drop(kept);

            let signed = made(&root, "A graph").signature.expect("a signature");
            assert_eq!(signed.by, key.fingerprint(HashAlg::Sha256).to_string());
            assert!(signed.verified);
        }
    }

    /// The claim is that the program a person's git config names is the one
    /// that signs, so the check is that program signing.
    #[test]
    fn a_folder_signs_with_the_program_git_config_names() {
        let gpg = std::process::Command::new("gpg").arg("--version").output();
        match gpg {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => panic!("gpg: {error}"),
            Ok(held) if !held.status.success() => return,
            Ok(_) => {}
        }
        let keys = scratch("their-openpgp");
        let program = keys.join("sign");
        fs::write(
            &program,
            format!(
                "#!/bin/sh\nGNUPGHOME={} exec gpg \"$@\"\n",
                keys.to_string_lossy()
            ),
        )
        .expect("the program");
        own_only(&program, 0o700).expect("something this can run");
        let made_key = std::process::Command::new(&program)
            .args([
                "--batch",
                "--passphrase",
                "",
                "--quick-generate-key",
                "Sloppy Test <test@example.invalid>",
                "ed25519",
                "sign",
                "never",
            ])
            .output()
            .expect("gpg");
        if !made_key.status.success() {
            return;
        }

        let root = vault();
        let data = private_for(&root);
        let kept = crate::history::at(&root).expect("the repository");
        let repo = kept.repo();
        write(
            repo,
            &root,
            &data,
            &SigningConfig::Openpgp {
                program: Some(program.to_string_lossy().into_owned()),
                key_id: None,
            },
        )
        .expect("the choice");
        drop(kept);

        let signed = made(&root, "A graph").signature.expect("a signature");
        assert_eq!(signed.by.len(), 16);
        // An openpgp key is not one this device can tell is what it claims.
        assert!(!signed.verified);
    }
}
