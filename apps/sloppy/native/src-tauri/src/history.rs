//! The commands behind `History` in `@sloppy/local`, which declares every act
//! and what its answer means — docs/ARCHITECTURE.md § "The vault's history".
//!
//! Each one takes the vault root and opens the repository keeping it: the one
//! the vault is inside, searched for no further up than the folder somebody
//! picked, and one made at the vault root where nothing there is keeping it.
//! The vault's path inside that repository is a prefix, and everything a person
//! is shown or commits here is under it.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chrono::{DateTime, SecondsFormat};
use git2::{
    build::CheckoutBuilder, BranchType, Config, ConfigLevel, DiffOptions, ErrorCode, Index,
    IndexAddOption, IndexConflict, ObjectType, Oid, Repository, RepositoryInitOptions,
    RepositoryOpenFlags, RepositoryState, ResetType, Signature, Sort, StatusOptions, TreeWalkMode,
    TreeWalkResult,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::draft::of_a_draft;
use crate::signing::{Signed, SigningConfig, Trust};
use crate::vault::{settled, FileError, Folders, Opened};

/// What a folder the app makes a repository is on.
const DEFAULT_BRANCH: &str = "main";

/// What `graph.json` is called — `GRAPH_FILE` in `@sloppy/vault`.
const GRAPH_FILE: &str = "graph.json";

/// Where a commit's author has no address of their own. Git will not record a
/// name without one.
const NO_ADDRESS: &str = "sloppy@localhost";

/// What this device begins a folder with — `GIT_DEFAULTS_FILE` in
/// `@sloppy/local`, in the same private data.
const GIT_DEFAULTS: &str = "git.json";

/// Where a container is told who its versions are by and how they are signed,
/// beside the repository rather than in its config: the repository is the
/// project's, and git reads its config for every commit the person makes on
/// their own code. A name or a signing key given to Sloppy here would sign
/// those too.
const TOLD: &str = "sloppy/config";

/// Where a container writes down the commit a merge it began is taking in. The
/// repository is the project's, so a merge in it is the person's own unless
/// this app says it began that one.
const MERGING: &str = "sloppy/merging";

/// What the folder is told not to keep — docs/ARCHITECTURE.md § "The vault's
/// history".
const IGNORED: [&str; 13] = [
    "identity.json",
    "identity.key",
    "sloppy-identity",
    "sloppy-identity*.json",
    "folders.json",
    "vaults.json",
    "git.json",
    "credentials.json",
    "signing.key",
    "signing.key.pub",
    "/.sloppy/bin.json",
    "/.sloppy/bin/",
    "/attached/",
];

/// An act the history would not take. What a person is told is the whole of it,
/// exactly as `HistoryError` in `@sloppy/local` promises.
#[derive(Debug)]
pub struct HistoryError(String);

impl HistoryError {
    pub(crate) fn new(said: impl Into<String>) -> Self {
        HistoryError(said.into())
    }

    /// What a person is told, and what `Serialize` hands the page.
    pub fn said(&self) -> &str {
        &self.0
    }
}

impl Serialize for HistoryError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.said())
    }
}

impl From<FileError> for HistoryError {
    fn from(error: FileError) -> Self {
        HistoryError::new(error.said())
    }
}

impl From<io::Error> for HistoryError {
    fn from(error: io::Error) -> Self {
        FileError::from(error).into()
    }
}

impl From<git2::Error> for HistoryError {
    fn from(_: git2::Error) -> Self {
        HistoryError::new("That did not work. Try again.")
    }
}

fn not_here() -> HistoryError {
    HistoryError::new("That is not one of the states this graph has been in.")
}

fn no_branch(name: &str) -> HistoryError {
    HistoryError::new(format!("There is nothing here called {name}."))
}

fn already_called(name: &str) -> HistoryError {
    HistoryError::new(format!("There is already one called {name}."))
}

fn wont_work(name: &str) -> HistoryError {
    HistoryError::new(format!("{name} will not work as a name. Try another."))
}

fn mid_merge() -> HistoryError {
    HistoryError::new("Finish the merge you are in the middle of first.")
}

fn uncommitted() -> HistoryError {
    HistoryError::new("Commit what you have written here first, or put it back the way it was.")
}

fn no_merge_here() -> HistoryError {
    HistoryError::new("There is no merge here to stop.")
}

fn nothing_to_start_from() -> HistoryError {
    HistoryError::new(
        "There is nothing here to branch off yet. Commit what is in this folder first.",
    )
}

/// The project's own files are settled where the person writes them, so a
/// refusal over one names that and not an act this app offers.
fn their_code_uncommitted() -> HistoryError {
    HistoryError::new(
        "This project has changes outside your notes. Keep or undo those where you write the code, then try again.",
    )
}

fn their_project_unfinished() -> HistoryError {
    HistoryError::new(
        "This project is in the middle of something else. Finish or stop it where you work on the code, then try again.",
    )
}

/// `Commit` in `@sloppy/local`. Every listing fills `signature` the same way,
/// so nothing there is a commit nobody signed rather than a listing that did
/// not look.
#[derive(Debug, Serialize)]
pub struct Commit {
    pub(crate) id: String,
    message: String,
    author: String,
    at: String,
    parents: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) signature: Option<Signed>,
}

/// `GraphCommit` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct GraphCommit {
    #[serde(flatten)]
    pub(crate) commit: Commit,
    pub(crate) refs: Vec<String>,
}

/// `CommitGraphPage` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct CommitGraphPage {
    pub(crate) commits: Vec<GraphCommit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
}

/// `GitUser` in `@sloppy/local`.
#[derive(Debug, Deserialize, PartialEq, Serialize)]
pub struct GitUser {
    name: String,
    email: String,
}

/// `CommitPage` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct CommitPage {
    commits: Vec<Commit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
}

/// `Branch` in `@sloppy/local`: a branch that follows none is level with
/// nothing rather than level with something, so both counts are absent there.
#[derive(Debug, Serialize)]
pub struct Branch {
    pub(crate) name: String,
    pub(crate) head: String,
    pub(crate) current: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) remote: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) upstream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) ahead: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) behind: Option<usize>,
}

impl Branch {
    fn here(name: &str, head: Oid, current: bool) -> Self {
        Branch {
            name: name.to_owned(),
            head: head.to_string(),
            current,
            remote: None,
            upstream: None,
            ahead: None,
            behind: None,
        }
    }
}

/// `HistoryStatus` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct Status {
    pub(crate) changed: Vec<String>,
    pub(crate) untracked: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) branch: Option<String>,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) upstream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) merging: Option<Merging>,
}

/// `HistoryStatus["merging"]` in `@sloppy/local`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Merging {
    pub(crate) taking: String,
    pub(crate) in_two_versions: Vec<String>,
}

/// `MergeResult` in `@sloppy/local`: `conflicts` is there exactly where nothing
/// was merged.
#[derive(Debug, Serialize)]
pub struct Merged {
    pub(crate) merged: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) conflicts: Option<Vec<String>>,
}

impl Merged {
    pub(crate) fn whole() -> Self {
        Merged {
            merged: true,
            conflicts: None,
        }
    }

    fn in_two_versions(conflicts: Vec<String>) -> Self {
        Merged {
            merged: false,
            conflicts: Some(conflicts),
        }
    }
}

/// `ConflictSide` in `@sloppy/local`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictSide {
    Mine,
    Theirs,
}

/// The repository keeping a vault, and where the vault is inside it. Every path
/// git spells — an index entry, a tree entry, a status — is from
/// {@link Kept::work}, and every path `History` in `@sloppy/local` spells is
/// from the vault root; `in_vault` and `from_vault` are the two ways across.
pub(crate) struct Kept {
    repo: Repository,
    /// The vault's path inside the working folder, spelled with `/` and with no
    /// slash at either end. Empty is a vault that is the working folder.
    prefix: String,
    work: PathBuf,
}

impl Kept {
    /// The whole of a repository, which is a vault that is its own.
    pub(crate) fn whole(repo: Repository, root: &Path) -> Self {
        Kept {
            repo,
            prefix: String::new(),
            work: root.to_path_buf(),
        }
    }

    /// The vault at `root` inside the repository found at `here`. Nothing where
    /// the repository keeps a folder the vault is not in.
    fn of(repo: Repository, root: &Path, here: &Path) -> Option<Self> {
        let Some(work) = repo.workdir() else {
            // A repository with no folder of its own is one a host keeps, and
            // there is nothing inside it for a vault to be a part of.
            return (here == root).then(|| Kept::whole(repo, root));
        };
        let work = settled(work);
        let prefix = root
            .strip_prefix(&work)
            .ok()?
            .components()
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        Some(Kept { repo, prefix, work })
    }

    pub(crate) fn repo(&self) -> &Repository {
        &self.repo
    }

    /// Whether the history holds more than the vault — the project's own code
    /// beside its notes, on the same branches and in the same commits.
    pub(crate) fn keeps_more_than_the_vault(&self) -> bool {
        !self.prefix.is_empty()
    }

    /// Where a file the repository spells as `path` is on the disk.
    fn file(&self, path: &str) -> PathBuf {
        self.work.join(path)
    }

    /// `path` as the vault spells it, and nothing where it is outside the
    /// vault — which is the person's own code, and none of this app's business.
    fn in_vault<'a>(&self, path: &'a str) -> Option<&'a str> {
        if self.prefix.is_empty() {
            return Some(path);
        }
        path.strip_prefix(&self.prefix)?.strip_prefix('/')
    }

    /// A path from the vault root as the repository spells it.
    fn spelled_here(&self, path: &str) -> String {
        if self.prefix.is_empty() {
            path.to_owned()
        } else {
            format!("{}/{path}", self.prefix)
        }
    }

    /// Where what this app is told about the folder is written, and nothing
    /// where that is the repository's own config.
    fn told_at(&self) -> Option<PathBuf> {
        self.keeps_more_than_the_vault()
            .then(|| self.repo.commondir().join(TOLD))
    }

    /// Where a merge this app began is written down, and nothing where the
    /// vault is the whole repository — there, every merge in it is this app's.
    fn ours_at(&self) -> Option<PathBuf> {
        self.keeps_more_than_the_vault()
            .then(|| self.repo.commondir().join(MERGING))
    }

    /// What the folder is set to, as every act here reads it.
    pub(crate) fn told(&self) -> Result<Told, HistoryError> {
        let ours = match self.told_at() {
            Some(at) if at.exists() => Some(Config::open(&at)?),
            _ => None,
        };
        Ok(Told {
            ours,
            git: self.repo.config()?,
        })
    }

    /// Where to write what somebody tells this app about the folder.
    pub(crate) fn tell(&self) -> Result<Config, HistoryError> {
        let Some(at) = self.told_at() else {
            return Ok(self.repo.config()?.open_level(ConfigLevel::Local)?);
        };
        if let Some(folder) = at.parent() {
            fs::create_dir_all(folder)?;
        }
        Ok(Config::open(&at)?)
    }

    /// What every act here is limited to, as git matches a path against one.
    fn only_the_vault(&self) -> String {
        if self.prefix.is_empty() {
            "*".to_owned()
        } else {
            format!("{}/*", self.prefix)
        }
    }

    /// Whether a path the repository spells is one the folder is told not to
    /// keep. The person's own code is never one of them.
    fn kept_out(&self, path: &str) -> bool {
        self.in_vault(path).is_some_and(kept_out)
    }

    /// The `IGNORED` lines as this repository reads them: pinned under the
    /// vault where the vault is a part of a bigger folder, so nothing named
    /// like one of ours in the person's own code is quietly dropped.
    fn ignored(&self) -> Vec<String> {
        if self.prefix.is_empty() {
            return IGNORED.iter().map(|line| (*line).to_owned()).collect();
        }
        IGNORED
            .iter()
            .map(|line| match line.strip_prefix('/') {
                Some(pinned) => format!("/{}/{pinned}", self.prefix),
                None => format!("/{}/**/{line}", self.prefix),
            })
            .collect()
    }
}

/// What a folder is set to: what somebody has told this app about it, and what
/// git says where they have told it nothing.
pub(crate) struct Told {
    ours: Option<Config>,
    git: Config,
}

impl Told {
    pub(crate) fn said(&self, key: &str) -> Option<String> {
        self.ours
            .as_ref()
            .and_then(|held| said(held, key))
            .or_else(|| said(&self.git, key))
    }

    pub(crate) fn on(&self, key: &str) -> bool {
        self.ours
            .as_ref()
            .and_then(|held| held.get_bool(key).ok())
            .or_else(|| self.git.get_bool(key).ok())
            .unwrap_or(false)
    }
}

/// The repository keeping the vault, made at the vault root where nothing above
/// it is keeping one, and keeping none of `IGNORED` either way.
pub(crate) fn at(vault: &Opened) -> Result<Kept, HistoryError> {
    let kept = match enclosing(vault) {
        Some(kept) => kept,
        None => Kept::whole(start(vault)?, vault),
    };
    keep_out(&kept)?;
    Ok(kept)
}

/// The repository the vault is inside, searched for from the vault root and no
/// further up than the folder somebody picked — so a graph inside a repository
/// nobody opened is still its own history.
fn enclosing(vault: &Opened) -> Option<Kept> {
    let root = settled(vault);
    let bound = settled(vault.within());
    let mut here: &Path = &root;
    loop {
        let ceiling: [&Path; 0] = [];
        if let Ok(repo) = Repository::open_ext(here, RepositoryOpenFlags::NO_SEARCH, ceiling) {
            if let Some(kept) = Kept::of(repo, &root, here) {
                return Some(kept);
            }
        }
        if here == bound {
            return None;
        }
        here = match here.parent() {
            Some(up) if up.starts_with(&bound) => up,
            _ => return None,
        };
    }
}

fn start(root: &Path) -> Result<Repository, HistoryError> {
    let mut how = RepositoryInitOptions::new();
    how.initial_head(DEFAULT_BRANCH);
    let repo = Repository::init_opts(root, &how)?;
    let ignore = root.join(".gitignore");
    if !ignore.exists() {
        fs::write(&ignore, IGNORED.join("\n") + "\n")?;
    }
    Ok(repo)
}

/// What the repository excludes for itself, so nothing untracked here is ever
/// offered to a commit. A `.gitignore` is a file the person wrote, and stays
/// theirs.
pub(crate) fn keep_out(kept: &Kept) -> Result<(), HistoryError> {
    let exclude = kept.repo().commondir().join("info").join("exclude");
    let held = fs::read_to_string(&exclude).unwrap_or_default();
    let lines = kept.ignored();
    let missing: Vec<&String> = lines
        .iter()
        .filter(|line| !held.lines().any(|one| one.trim() == line.as_str()))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let mut written = held;
    if !written.is_empty() && !written.ends_with('\n') {
        written.push('\n');
    }
    for line in missing {
        written.push_str(line);
        written.push('\n');
    }
    if let Some(folder) = exclude.parent() {
        fs::create_dir_all(folder)?;
    }
    fs::write(&exclude, written)?;
    Ok(())
}

/// Whether a path from the VAULT root is one of `IGNORED`, matched the way git
/// matches the lines these are written as: a bare name wherever it is, a
/// leading slash pinned to the vault root, a trailing one covering everything
/// under it.
fn kept_out(path: &str) -> bool {
    IGNORED.iter().any(|line| match line.strip_prefix('/') {
        Some(pinned) => match pinned.strip_suffix('/') {
            Some(folder) => path.starts_with(&format!("{folder}/")),
            None => path == pinned,
        },
        None => path
            .rsplit('/')
            .next()
            .is_some_and(|name| line_names(name, line)),
    })
}

/// Whether a name is the one an `IGNORED` line names, with `*` standing for any
/// run of characters as git's does. The lines carry at most one.
fn line_names(name: &str, line: &str) -> bool {
    match line.split_once('*') {
        Some((before, after)) => {
            name.len() >= before.len() + after.len()
                && name.starts_with(before)
                && name.ends_with(after)
        }
        None => name == line,
    }
}

/// What an exclude cannot do: a folder that was a repository before the app
/// opened it can already be tracking these, and nothing untracks a file by
/// ignoring it. The files stay where they are; only the history lets go.
fn let_go(kept: &Kept, index: &mut Index) -> Result<(), HistoryError> {
    let held: Vec<PathBuf> = index
        .iter()
        .filter_map(|entry| String::from_utf8(entry.path).ok())
        .filter(|path| kept.kept_out(path))
        .map(PathBuf::from)
        .collect();
    for path in held {
        index.remove_path(&path)?;
    }
    Ok(())
}

fn unborn(error: &git2::Error) -> bool {
    matches!(error.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound)
}

pub(crate) fn head_commit(repo: &Repository) -> Result<Option<git2::Commit<'_>>, HistoryError> {
    match repo.head() {
        Ok(head) => Ok(Some(head.peel_to_commit()?)),
        Err(error) if unborn(&error) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// The branch the folder is on, and nothing where it is on a commit of its own.
/// A repository with no commits in it yet is still on the branch its first one
/// will be.
pub(crate) fn on(repo: &Repository) -> Result<Option<String>, HistoryError> {
    match repo.head() {
        Ok(head) => Ok(head
            .is_branch()
            .then(|| head.shorthand().map(str::to_owned))
            .flatten()),
        Err(error) if unborn(&error) => Ok(repo
            .find_reference("HEAD")
            .ok()
            .and_then(|head| head.symbolic_target().map(str::to_owned))
            .and_then(|target| target.strip_prefix("refs/heads/").map(str::to_owned))),
        Err(error) => Err(error.into()),
    }
}

/// How far a branch is from the one it follows, and which that is. Nothing
/// where it follows none, which is not the same as being level with something.
fn against(repo: &Repository, branch: &str) -> Option<(usize, usize, String)> {
    let held = repo.find_branch(branch, BranchType::Local).ok()?;
    let upstream = held.upstream().ok()?;
    let named = upstream.name().ok()??.to_owned();
    let (mine, theirs) = (held.get().target()?, upstream.get().target()?);
    let (ahead, behind) = repo.graph_ahead_behind(mine, theirs).ok()?;
    Some((ahead, behind, named))
}

/// The commit the folder is in the middle of merging in, where it is.
fn merging(repo: &mut Repository) -> Result<Option<Oid>, HistoryError> {
    let mut found = None;
    match repo.mergehead_foreach(|id| {
        found = Some(*id);
        true
    }) {
        Ok(()) => Ok(found),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// A container's repository is the project's, and a rebase, a cherry-pick, a
/// revert or a bisect the person began is held in the repository itself: an act
/// that moves the folder would walk through what they are in the middle of, and
/// finishing one clears it away. So every such act is refused for as long as the
/// repository is in the middle of anything but a merge this app began. A vault
/// that is the whole repository is this app's alone and is never refused here.
fn theirs_unfinished(kept: &Kept, with: Option<Oid>) -> Option<HistoryError> {
    if !kept.keeps_more_than_the_vault() {
        return None;
    }
    match kept.repo().state() {
        RepositoryState::Clean => None,
        RepositoryState::Merge if with.is_some_and(|head| ours_to_finish(kept, head)) => None,
        _ => Some(their_project_unfinished()),
    }
}

/// Whether the merge the folder is in the middle of is the one this app began:
/// the commit it took in is what it wrote down.
fn ours_to_finish(kept: &Kept, head: Oid) -> bool {
    let Some(at) = kept.ours_at() else {
        return true;
    };
    fs::read_to_string(at).is_ok_and(|held| held.trim() == head.to_string())
}

fn began_a_merge(kept: &Kept, head: Oid) -> Result<(), HistoryError> {
    let Some(at) = kept.ours_at() else {
        return Ok(());
    };
    if let Some(folder) = at.parent() {
        fs::create_dir_all(folder)?;
    }
    fs::write(at, head.to_string())?;
    Ok(())
}

/// What a merge this app began leaves behind, cleared once it is settled and
/// never for what the person is in the middle of themselves.
fn finished_the_merge(kept: &Kept) -> Result<(), HistoryError> {
    if let Some(at) = kept.ours_at() {
        match fs::remove_file(at) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            other => other?,
        }
    }
    kept.repo().cleanup_state()?;
    Ok(())
}

/// Git refuses a name or an address with an angle bracket or a newline in it,
/// and every one of these is somebody's own words.
fn spelled(held: Option<&serde_json::Value>, key: &str) -> Option<String> {
    held.and_then(|held| held.get(key))
        .and_then(|held| held.as_str())
        .map(str::trim)
        .filter(|held| !held.is_empty() && !held.contains(['<', '>', '\n']))
        .map(str::to_owned)
}

/// Who a commit is by where nothing in git config says: what the graph says
/// its owner is called, and the identity it belongs to.
fn owner(root: &Path) -> (String, String) {
    let held = fs::read(root.join(GRAPH_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    let said = |key: &str| spelled(held.as_ref(), key);
    let did = said("owner");
    let name = said("owner_name")
        .or_else(|| did.clone())
        .unwrap_or_else(|| "Sloppy".to_owned());
    (name, did.unwrap_or_else(|| NO_ADDRESS.to_owned()))
}

fn said(config: &Config, key: &str) -> Option<String> {
    config
        .get_string(key)
        .ok()
        .map(|held| held.trim().to_owned())
        .filter(|held| !held.is_empty())
}

/// Who the commits made here are by, read the way git reads it: what this
/// folder is set to, then the person's own. Nothing where neither says.
pub fn git_user(vault: &Opened) -> Result<Option<GitUser>, HistoryError> {
    Ok(named(&at(vault)?.told()?).map(|(name, email)| GitUser { name, email }))
}

fn named(told: &Told) -> Option<(String, String)> {
    Some((told.said("user.name")?, told.said("user.email")?))
}

/// Who this device says its commits are by, where it has been told at all.
fn device_user(data: &Path) -> Option<GitUser> {
    let held: serde_json::Value = fs::read(data.join(GIT_DEFAULTS))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())?;
    let user = held.get("user");
    Some(GitUser {
        name: spelled(user, "name")?,
        email: spelled(user, "email")?,
    })
}

/// A folder nobody has named an author in takes this device's default the first
/// time it commits — docs/ARCHITECTURE.md § "The vault's history".
fn begun(kept: &Kept, data: &Path) -> Result<(), HistoryError> {
    if named(&kept.told()?).is_some() {
        return Ok(());
    }
    let Some(user) = device_user(data) else {
        return Ok(());
    };
    let mut config = kept.tell()?;
    config.set_str("user.name", &user.name)?;
    config.set_str("user.email", &user.email)?;
    Ok(())
}

pub fn set_git_user(vault: &Opened, user: &GitUser) -> Result<(), HistoryError> {
    let kept = at(vault)?;
    let mut config = kept.tell()?;
    config
        .set_str("user.name", user.name.trim())
        .and_then(|()| config.set_str("user.email", user.email.trim()))
        .map_err(|_| {
            HistoryError::new("That will not work as a name and an address. Try another.")
        })?;
    Ok(())
}

fn signature<'a>(kept: &Kept, root: &Path) -> Result<Signature<'a>, HistoryError> {
    let (name, address) = named(&kept.told()?).unwrap_or_else(|| owner(root));
    Signature::now(&name, &address)
        .map_err(|_| HistoryError::new("That will not work as a name and an address. Try another."))
}

/// A commit's time, at the width `Timestamp` in `@sloppy/types` is pinned to.
fn moment(seconds: i64) -> String {
    DateTime::from_timestamp(seconds, 0)
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn view(repo: &Repository, commit: &git2::Commit<'_>, trust: &Trust) -> Commit {
    let by = commit.author();
    Commit {
        signature: crate::signing::signature_of(repo, commit.id(), trust),
        id: commit.id().to_string(),
        message: commit.message().unwrap_or_default().to_owned(),
        author: by
            .name()
            .or_else(|| by.email())
            .unwrap_or_default()
            .to_owned(),
        at: moment(commit.time().seconds()),
        parents: commit.parent_ids().map(|id| id.to_string()).collect(),
    }
}

/// What a person is shown of the folder: the vault and nothing else, so a
/// listing in a project's container never shows the person's own code.
fn standing(kept: &Kept, taking: Option<Oid>) -> Result<Status, HistoryError> {
    let repo = kept.repo();
    let mut how = StatusOptions::new();
    how.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false);
    let held = repo.statuses(Some(&mut how))?;
    let mut changed = Vec::new();
    let mut untracked = Vec::new();
    for entry in held.iter() {
        let Some(path) = entry.path() else { continue };
        let Some(path) = kept.in_vault(path) else {
            continue;
        };
        if kept_out(path) {
            continue;
        }
        if entry.status() == git2::Status::WT_NEW {
            untracked.push(path.to_owned());
        } else if !entry.status().is_empty() {
            changed.push(path.to_owned());
        }
    }
    changed.sort();
    untracked.sort();
    let branch = on(repo)?;
    let followed = branch.as_deref().and_then(|name| against(repo, name));
    let (ahead, behind, upstream) = match followed {
        Some((ahead, behind, upstream)) => (ahead, behind, Some(upstream)),
        None => (0, 0, None),
    };
    let merging = match taking {
        Some(head) => Some(Merging {
            taking: head.to_string(),
            in_two_versions: still_in_two(kept)?,
        }),
        None => None,
    };
    Ok(Status {
        changed,
        untracked,
        branch,
        ahead,
        behind,
        upstream,
        merging,
    })
}

/// Every path the merge in progress has left in two versions, from the vault
/// root — what {@link one_version_each} answered as the merge was made, read
/// off the repository rather than remembered.
fn still_in_two(kept: &Kept) -> Result<Vec<String>, HistoryError> {
    let mut held = Vec::new();
    for found in kept.repo().index()?.conflicts()? {
        let Some(path) = conflicted_path(&found?) else {
            continue;
        };
        if let Some(inside) = kept.in_vault(&path) {
            held.push(inside.to_owned());
        }
    }
    held.sort();
    Ok(held)
}

/// What a conflict is about, as the repository spells it: whichever of the
/// three sides is there, since any one of them may be the side that took the
/// file away.
fn conflicted_path(found: &IndexConflict) -> Option<String> {
    found
        .our
        .as_ref()
        .or(found.their.as_ref())
        .or(found.ancestor.as_ref())
        .and_then(|entry| String::from_utf8(entry.path.clone()).ok())
}

/// What has been written since the commit the folder is on, and so what an act
/// that lays a commit down would write over. The whole folder is looked at
/// rather than the vault, because a checkout lays down every path a commit
/// carries.
enum Unsettled {
    Nothing,
    Notes,
    TheirCode,
}

impl Unsettled {
    fn refusal(self) -> Option<HistoryError> {
        match self {
            Unsettled::Nothing => None,
            Unsettled::Notes => Some(uncommitted()),
            Unsettled::TheirCode => Some(their_code_uncommitted()),
        }
    }
}

fn unsettled(kept: &Kept) -> Result<Unsettled, HistoryError> {
    let mut how = StatusOptions::new();
    how.include_untracked(false)
        .include_ignored(false)
        .include_unmodified(false);
    let held = kept.repo().statuses(Some(&mut how))?;
    let mut found = Unsettled::Nothing;
    for entry in held.iter() {
        let Some(path) = entry.path() else { continue };
        if entry.status().is_empty() || kept.kept_out(path) {
            continue;
        }
        if kept.in_vault(path).is_none() {
            return Ok(Unsettled::TheirCode);
        }
        found = Unsettled::Notes;
    }
    Ok(found)
}

pub fn status(vault: &Opened) -> Result<Status, HistoryError> {
    let mut kept = at(vault)?;
    let with = merging(&mut kept.repo)?;
    let ours = with.filter(|_| theirs_unfinished(&kept, with).is_none());
    standing(&kept, ours)
}

/// Whether a commit carries the vault at a state none of what it springs from
/// had it at — what a listing of the vault's own versions is limited to.
fn touched(kept: &Kept, commit: &git2::Commit<'_>) -> Result<bool, HistoryError> {
    if kept.prefix.is_empty() {
        return Ok(true);
    }
    let held = at_prefix(kept, commit)?;
    if commit.parent_count() == 0 {
        return Ok(held.is_some());
    }
    for parent in commit.parents() {
        if at_prefix(kept, &parent)? == held {
            return Ok(false);
        }
    }
    Ok(true)
}

/// What the vault is, as one id, in the state a commit carries — nothing where
/// that commit carries no vault at all.
fn at_prefix(kept: &Kept, commit: &git2::Commit<'_>) -> Result<Option<Oid>, HistoryError> {
    match commit.tree()?.get_path(Path::new(&kept.prefix)) {
        Ok(entry) => Ok(Some(entry.id())),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn log(
    vault: &Opened,
    data: &Path,
    limit: i64,
    cursor: Option<&str>,
) -> Result<CommitPage, HistoryError> {
    let kept = at(vault)?;
    let repo = kept.repo();
    let trust = Trust::of(vault, data);
    let limit = limit.max(0) as usize;
    if head_commit(repo)?.is_none() {
        return Ok(CommitPage {
            commits: Vec::new(),
            cursor: None,
        });
    }
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    walk.push_head()?;

    let mut reached = cursor.is_none();
    let mut commits = Vec::new();
    let mut next = None;
    for id in walk {
        let id = id?;
        let held = repo.find_commit(id)?;
        if !touched(&kept, &held)? {
            continue;
        }
        if !reached {
            if Some(id.to_string().as_str()) != cursor {
                continue;
            }
            reached = true;
        }
        if commits.len() == limit {
            next = Some(id.to_string());
            break;
        }
        commits.push(view(repo, &held, &trust));
    }
    if !reached {
        return Err(not_here());
    }
    Ok(CommitPage {
        commits,
        cursor: next,
    })
}

/// Every commit this folder knows, across its branches and the ones it last
/// heard a remote had, with the names at each — `graph` in `@sloppy/local`.
///
/// This is the folder's whole picture, where {@link log} is the vault's own
/// line: a branch is at a commit whether or not that commit wrote in the vault,
/// and a picture missing the commit a branch is at would draw a branch at
/// nothing.
pub fn graph(
    vault: &Opened,
    data: &Path,
    limit: i64,
    cursor: Option<&str>,
) -> Result<CommitGraphPage, HistoryError> {
    let kept = at(vault)?;
    let repo = kept.repo();
    let trust = Trust::of(vault, data);
    let limit = limit.max(0) as usize;
    let named = names_at(repo)?;

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    for head in named.keys() {
        walk.push(*head)?;
    }

    let mut reached = cursor.is_none();
    let mut commits = Vec::new();
    let mut next = None;
    for id in walk {
        let id = id?;
        if !reached {
            if Some(id.to_string().as_str()) != cursor {
                continue;
            }
            reached = true;
        }
        if commits.len() == limit {
            next = Some(id.to_string());
            break;
        }
        commits.push(GraphCommit {
            commit: view(repo, &repo.find_commit(id)?, &trust),
            refs: named.get(&id).cloned().unwrap_or_default(),
        });
    }
    if !reached {
        return Err(not_here());
    }
    Ok(CommitGraphPage {
        commits,
        cursor: next,
    })
}

/// Which branches are at which commit: one kept here by its own name, one kept
/// somewhere else as `<remote>/<name>`. What a remote calls its own default is
/// that remote's business rather than a branch anybody is at.
fn names_at(repo: &Repository) -> Result<BTreeMap<Oid, Vec<String>>, HistoryError> {
    let mut held: BTreeMap<Oid, Vec<String>> = BTreeMap::new();
    for kind in [BranchType::Local, BranchType::Remote] {
        for found in repo.branches(Some(kind))? {
            let (branch, _) = found?;
            let (Some(name), Some(head)) = (branch.name()?, branch.get().target()) else {
                continue;
            };
            if kind == BranchType::Remote && name.ends_with("/HEAD") {
                continue;
            }
            if kind == BranchType::Local && of_a_draft(name) {
                continue;
            }
            held.entry(head).or_default().push(name.to_owned());
        }
    }
    for names in held.values_mut() {
        names.sort();
    }
    Ok(held)
}

pub fn commit(vault: &Opened, data: &Path, message: &str) -> Result<Option<Commit>, HistoryError> {
    let mut kept = at(vault)?;
    let with = merging(&mut kept.repo)?;
    if let Some(why) = theirs_unfinished(&kept, with) {
        return Err(why);
    }
    let repo = kept.repo();
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(HistoryError::new(
            "Some of these are still here in two versions. Choose one of each and try again.",
        ));
    }
    let_go(&kept, &mut index)?;
    let only = kept.only_the_vault();
    index.update_all([&only], None)?;
    index.add_all([&only], IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let head = head_commit(repo)?;
    // A merge is settled whole or not at all, so the commit that finishes one
    // carries everything it merged; anything else carries the vault alone.
    let written = match with {
        Some(_) => index.write_tree()?,
        None => the_vault_alone(&kept, &mut index, head.as_ref())?,
    };
    if with.is_none() {
        if let Some(at) = &head {
            if at.tree_id() == written {
                return Ok(None);
            }
        }
    }
    let tree = repo.find_tree(written)?;
    let taken = match with {
        Some(id) => Some(repo.find_commit(id)?),
        None => None,
    };
    let mut parents: Vec<&git2::Commit<'_>> = Vec::new();
    if let Some(one) = head.as_ref() {
        parents.push(one);
    }
    if let Some(one) = taken.as_ref() {
        parents.push(one);
    }
    let made = record(&kept, vault, data, message, &tree, &parents)?;
    if with.is_some() {
        finished_the_merge(&kept)?;
    }
    let held = view(repo, &repo.find_commit(made)?, &Trust::of(vault, data));
    Ok(Some(held))
}

/// The state a commit of the vault carries: everything the folder is on, with
/// the vault as it is now written over it. **A commit Sloppy makes stages only
/// paths under the vault** — docs/ARCHITECTURE.md § "The vault's history" — so
/// code the person has staged themselves is not carried off in a commit of
/// their notes.
fn the_vault_alone(
    kept: &Kept,
    index: &mut Index,
    head: Option<&git2::Commit<'_>>,
) -> Result<Oid, HistoryError> {
    if kept.prefix.is_empty() {
        return Ok(index.write_tree()?);
    }
    let mut building = Index::new()?;
    if let Some(at) = head {
        building.read_tree(&at.tree()?)?;
        building.remove_dir(Path::new(&kept.prefix), 0)?;
    }
    for entry in index.iter() {
        let Ok(path) = String::from_utf8(entry.path.clone()) else {
            continue;
        };
        if kept.in_vault(&path).is_some() {
            building.add(&entry)?;
        }
    }
    Ok(building.write_tree_to(kept.repo())?)
}

/// One commit, carrying a signature where this folder signs. A signed one is
/// written straight to the branch, because signing it is what makes the commit
/// rather than something done to one that is already there.
///
/// A signature that cannot be made here — a program this machine has not got, a
/// key it cannot open — leaves the commit unsigned rather than losing what
/// somebody wrote, and a listing says which commits carry one.
fn record(
    kept: &Kept,
    root: &Path,
    data: &Path,
    message: &str,
    tree: &git2::Tree<'_>,
    parents: &[&git2::Commit<'_>],
) -> Result<Oid, HistoryError> {
    begun(kept, data)?;
    let repo = kept.repo();
    let by = signature(kept, root)?;
    let held = repo.commit_create_buffer(&by, &by, message, tree, parents)?;
    let content = std::str::from_utf8(&held)
        .map_err(|_| HistoryError::new("That did not work. Try again."))?;
    let Some(armour) = crate::signing::sign(kept, data, content).unwrap_or(None) else {
        return Ok(repo.commit(Some("HEAD"), &by, &by, message, tree, parents)?);
    };
    let made = repo.commit_signed(content, &armour, None)?;
    match repo.find_reference("HEAD")?.symbolic_target() {
        Some(target) => {
            let target = target.to_owned();
            repo.reference(&target, made, true, message)?;
        }
        None => repo.set_head_detached(made)?,
    }
    Ok(made)
}

pub fn branches(vault: &Opened) -> Result<Vec<Branch>, HistoryError> {
    let kept = at(vault)?;
    let repo = kept.repo();
    let mut held = Vec::new();
    for found in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = found?;
        let (Some(name), Some(head)) = (branch.name()?, branch.get().target()) else {
            continue;
        };
        if of_a_draft(name) {
            continue;
        }
        let mut one = Branch::here(name, head, branch.is_head());
        if let Some((ahead, behind, upstream)) = against(repo, name) {
            one.upstream = Some(upstream);
            one.ahead = Some(ahead);
            one.behind = Some(behind);
        }
        held.push(one);
    }
    for found in repo.branches(Some(BranchType::Remote))? {
        let (branch, _) = found?;
        let (Some(name), Some(head)) = (branch.name()?, branch.get().target()) else {
            continue;
        };
        if name.ends_with("/HEAD") {
            continue;
        }
        let mut one = Branch::here(name, head, false);
        one.remote = name.split('/').next().map(str::to_owned);
        held.push(one);
    }
    Ok(held)
}

pub fn branch(vault: &Opened, name: &str) -> Result<Branch, HistoryError> {
    if of_a_draft(name) {
        return Err(wont_work(name));
    }
    let kept = at(vault)?;
    let repo = kept.repo();
    if repo.find_branch(name, BranchType::Local).is_ok() {
        return Err(already_called(name));
    }
    let Some(head) = head_commit(repo)? else {
        return Err(nothing_to_start_from());
    };
    let made = repo
        .branch(name, &head, false)
        .map_err(|_| wont_work(name))?;
    Ok(Branch::here(name, head.id(), made.is_head()))
}

/// A branch at a commit somewhere back in the history. The folder stays where
/// it is.
pub fn branch_at(vault: &Opened, name: &str, commit: &str) -> Result<Branch, HistoryError> {
    if of_a_draft(name) {
        return Err(wont_work(name));
    }
    let kept = at(vault)?;
    let repo = kept.repo();
    if repo.find_branch(name, BranchType::Local).is_ok() {
        return Err(already_called(name));
    }
    let held = repo
        .revparse_single(commit)
        .and_then(|found| found.peel_to_commit())
        .map_err(|_| not_here())?;
    let made = repo
        .branch(name, &held, false)
        .map_err(|_| wont_work(name))?;
    Ok(Branch::here(name, held.id(), made.is_head()))
}

pub fn delete_branch(vault: &Opened, name: &str) -> Result<(), HistoryError> {
    if of_a_draft(name) {
        return Err(no_branch(name));
    }
    let kept = at(vault)?;
    let repo = kept.repo();
    let mut held = repo
        .find_branch(name, BranchType::Local)
        .map_err(|_| no_branch(name))?;
    if held.is_head() {
        return Err(HistoryError::new("That is the one you are working on."));
    }
    held.delete()?;
    Ok(())
}

pub fn signing(vault: &Opened, data: &Path) -> Result<SigningConfig, HistoryError> {
    crate::signing::read(&at(vault)?.told()?, data)
}

pub fn set_signing(
    vault: &Opened,
    data: &Path,
    signing: &SigningConfig,
) -> Result<(), HistoryError> {
    crate::signing::write(&at(vault)?, vault, data, signing)
}

/// What a checkout that carries unkept writing along would have written over:
/// a file the person has written, whether the history is keeping it or not.
fn written_over(error: git2::Error) -> HistoryError {
    if error.code() == ErrorCode::Conflict {
        HistoryError::new(
            "Some of what you have written here would be written over. Keep it first, then try again.",
        )
    } else {
        error.into()
    }
}

/// What a checkout would have written over. The folder is somebody's own, so
/// what is in the way is theirs to move.
fn in_the_way(error: git2::Error) -> HistoryError {
    if error.code() == ErrorCode::Conflict {
        HistoryError::new(
            "Something here that the history is not keeping would be written over. Move it out of this folder first.",
        )
    } else {
        error.into()
    }
}

fn kept_out_in(
    kept: &Kept,
    tree: &git2::Tree<'_>,
    held: &mut BTreeSet<String>,
) -> Result<(), HistoryError> {
    tree.walk(TreeWalkMode::PreOrder, |folder, entry| {
        if entry.kind() == Some(ObjectType::Blob) {
            if let Some(name) = entry.name() {
                let path = format!("{folder}{name}");
                if kept.kept_out(&path) {
                    held.insert(path);
                }
            }
        }
        TreeWalkResult::Ok
    })?;
    Ok(())
}

/// Every path a checkout could write or take away that the history has let go
/// of: what the state being laid down carries, what the folder is on now, and
/// what it is still tracking.
fn kept_out_of(kept: &Kept, onto: Oid) -> Result<BTreeSet<String>, HistoryError> {
    let repo = kept.repo();
    let mut held = BTreeSet::new();
    kept_out_in(kept, &repo.find_commit(onto)?.tree()?, &mut held)?;
    if let Some(at) = head_commit(repo)? {
        kept_out_in(kept, &at.tree()?, &mut held)?;
    }
    for entry in repo.index()?.iter() {
        if let Ok(path) = String::from_utf8(entry.path) {
            if kept.kept_out(&path) {
                held.insert(path);
            }
        }
    }
    Ok(held)
}

/// A file kept out of the history, and what the folder holds in it — nothing
/// where it holds none.
type Aside = (String, Option<Vec<u8>>);

/// The folder's own copies of these, taken out of the checkout's way and held
/// as they are now. A state somebody committed themselves can carry an older
/// bin, and laying that one over the live one hands back addresses this graph
/// has spent — docs/ARCHITECTURE.md § "The vault's history".
fn set_aside(kept: &Kept, onto: Oid) -> Result<Vec<Aside>, HistoryError> {
    let mut held = Vec::new();
    for path in kept_out_of(kept, onto)? {
        let file = kept.file(&path);
        let was = match fs::read(&file) {
            Ok(bytes) => {
                fs::remove_file(&file)?;
                Some(bytes)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        held.push((path, was));
    }
    Ok(held)
}

/// The folder back the way it was, whether the checkout went through or not,
/// and the index let go of these again so nothing it laid down is tracked here.
fn put_back(kept: &Kept, held: Vec<Aside>) -> Result<(), HistoryError> {
    if held.is_empty() {
        return Ok(());
    }
    for (path, was) in held {
        let file = kept.file(&path);
        match was {
            Some(bytes) => {
                if let Some(folder) = file.parent() {
                    fs::create_dir_all(folder)?;
                }
                fs::write(&file, bytes)?;
            }
            None => match fs::remove_file(&file) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                other => other?,
            },
        }
    }
    let mut index = kept.repo().index()?;
    let_go(kept, &mut index)?;
    index.write()?;
    Ok(())
}

/// A file the folder holds that the state being laid down holds byte for byte
/// is not a file a checkout writes over — the bytes do not change. Only one the
/// history is not already keeping is let go of this way, so nothing a checkout
/// would leave alone is lost; what is kept out of the history is `set_aside`'s.
/// The bytes come back as they were, for a checkout that is refused after all.
fn already_the_same(kept: &Kept, onto: Oid) -> Result<Vec<Aside>, HistoryError> {
    let repo = kept.repo();
    let tracked: BTreeSet<String> = repo
        .index()?
        .iter()
        .filter_map(|entry| String::from_utf8(entry.path).ok())
        .collect();
    let mut same = Vec::new();
    let mut failed = None;
    repo.find_commit(onto)?
        .tree()?
        .walk(TreeWalkMode::PreOrder, |folder, entry| {
            if entry.kind() != Some(ObjectType::Blob) {
                return TreeWalkResult::Ok;
            }
            let Some(name) = entry.name() else {
                return TreeWalkResult::Ok;
            };
            let path = format!("{folder}{name}");
            if tracked.contains(&path) || kept.kept_out(&path) {
                return TreeWalkResult::Ok;
            }
            match (fs::read(kept.file(&path)), repo.find_blob(entry.id())) {
                (Ok(here), Ok(blob)) if here == blob.content() => same.push((path, here)),
                (_, Err(error)) => {
                    failed = Some(error);
                    return TreeWalkResult::Abort;
                }
                _ => {}
            }
            TreeWalkResult::Ok
        })?;
    if let Some(error) = failed {
        return Err(error.into());
    }
    let mut held = Vec::new();
    for (path, was) in same {
        fs::remove_file(kept.file(&path))?;
        held.push((path, Some(was)));
    }
    Ok(held)
}

/// What laying a state over the folder may write over, and so what it refuses.
pub(crate) enum WritesOver {
    /// Nothing the history is not keeping.
    NothingUnkept,
    /// Nothing the person has written, whether the history is keeping it or not.
    NothingWritten,
    /// Everything here, folder and index alike — what takes a half-settled merge
    /// away.
    Everything,
}

/// A checkout that leaves alone whatever the history is not keeping.
fn safely(repo: &Repository, at: &git2::Object<'_>) -> Result<(), git2::Error> {
    let mut how = CheckoutBuilder::new();
    how.safe();
    repo.checkout_tree(at, Some(&mut how))
}

pub(crate) fn lay(kept: &Kept, onto: Oid, over: WritesOver) -> Result<(), HistoryError> {
    let repo = kept.repo();
    let at = repo.find_object(onto, Some(ObjectType::Commit))?;
    let same = already_the_same(kept, onto)?;
    let held = set_aside(kept, onto)?;
    let laid = match over {
        WritesOver::Everything => repo.reset(&at, ResetType::Hard, None).map_err(Into::into),
        WritesOver::NothingUnkept => safely(repo, &at).map_err(in_the_way),
        WritesOver::NothingWritten => safely(repo, &at).map_err(written_over),
    };
    put_back(kept, held)?;
    // A checkout that wrote them is a checkout that went through; one that was
    // refused leaves the folder holding everything it held before.
    if laid.is_err() {
        put_back(kept, same)?;
    }
    laid
}

/// The commit a local branch is at, and nothing where there is no such branch.
fn branch_head(repo: &Repository, name: &str) -> Option<Oid> {
    repo.find_branch(name, BranchType::Local)
        .ok()
        .and_then(|branch| branch.get().target())
}

pub fn switch_to(vault: &Opened, name: &str) -> Result<(), HistoryError> {
    if of_a_draft(name) {
        return Err(no_branch(name));
    }
    let mut kept = at(vault)?;
    let Some(head) = branch_head(kept.repo(), name) else {
        return Err(no_branch(name));
    };
    let with = merging(&mut kept.repo)?;
    if let Some(why) = theirs_unfinished(&kept, with) {
        return Err(why);
    }
    if with.is_some() {
        return Err(mid_merge());
    }
    if on(kept.repo())?.as_deref() == Some(name) {
        return Ok(());
    }
    if let Some(why) = unsettled(&kept)?.refusal() {
        return Err(why);
    }
    lay(&kept, head, WritesOver::NothingUnkept)?;
    kept.repo().set_head(&format!("refs/heads/{name}"))?;
    Ok(())
}

/// The folder becomes that version and is on no line afterwards —
/// `History.standOn` in `@sloppy/local` says what `carrying` means.
pub fn stand_on(vault: &Opened, commit: &str, carrying: bool) -> Result<(), HistoryError> {
    let mut kept = at(vault)?;
    let onto = kept
        .repo()
        .revparse_single(commit)
        .and_then(|found| found.peel_to_commit())
        .map_err(|_| not_here())?
        .id();
    let with = merging(&mut kept.repo)?;
    if let Some(why) = theirs_unfinished(&kept, with) {
        return Err(why);
    }
    if with.is_some() {
        return Err(mid_merge());
    }
    if !carrying {
        if let Some(why) = unsettled(&kept)?.refusal() {
            return Err(why);
        }
    }
    lay(
        &kept,
        onto,
        if carrying {
            WritesOver::NothingWritten
        } else {
            WritesOver::NothingUnkept
        },
    )?;
    kept.repo().set_head_detached(onto)?;
    Ok(())
}

/// A line starting where the folder stands, with the folder moved onto it and
/// not a file touched, so it is taken while the folder holds unkept writing.
pub fn line_here(vault: &Opened, name: &str) -> Result<Branch, HistoryError> {
    if of_a_draft(name) {
        return Err(wont_work(name));
    }
    let mut kept = at(vault)?;
    let with = merging(&mut kept.repo)?;
    if let Some(why) = theirs_unfinished(&kept, with) {
        return Err(why);
    }
    let repo = kept.repo();
    if repo.find_branch(name, BranchType::Local).is_ok() {
        return Err(already_called(name));
    }
    let Some(head) = head_commit(repo)? else {
        return Err(nothing_to_start_from());
    };
    repo.branch(name, &head, false)
        .map_err(|_| wont_work(name))?;
    repo.set_head(&format!("refs/heads/{name}"))?;
    Ok(Branch::here(name, head.id(), true))
}

/// A line called something else, with the folder on it under the new name where
/// it was on it.
pub fn rename_line(vault: &Opened, from: &str, to: &str) -> Result<Branch, HistoryError> {
    if of_a_draft(from) {
        return Err(no_branch(from));
    }
    if of_a_draft(to) {
        return Err(wont_work(to));
    }
    let kept = at(vault)?;
    let repo = kept.repo();
    if repo.find_branch(to, BranchType::Local).is_ok() {
        return Err(already_called(to));
    }
    let mut held = repo
        .find_branch(from, BranchType::Local)
        .map_err(|_| no_branch(from))?;
    held.rename(to, false).map_err(|_| wont_work(to))?;
    let Some(head) = branch_head(repo, to) else {
        return Err(no_branch(to));
    };
    Ok(Branch::here(to, head, on(repo)?.as_deref() == Some(to)))
}

/// The folder as it was before the merge began — `History.abandonMerge` in
/// `@sloppy/local`.
pub fn abandon_merge(vault: &Opened) -> Result<(), HistoryError> {
    let mut kept = at(vault)?;
    let with = merging(&mut kept.repo)?;
    if let Some(why) = theirs_unfinished(&kept, with) {
        return Err(why);
    }
    if !with.is_some_and(|head| ours_to_finish(&kept, head)) {
        return Err(no_merge_here());
    }
    let Some(mine) = head_commit(kept.repo())?.map(|held| held.id()) else {
        return Err(no_merge_here());
    };
    lay(&kept, mine, WritesOver::Everything)?;
    finished_the_merge(&kept)?;
    Ok(())
}

/// Every path a merge left in two versions, with this branch's own version of
/// each one written into the folder — docs/ARCHITECTURE.md § "The vault's
/// history".
fn one_version_each(kept: &Kept, index: &Index) -> Result<Vec<String>, HistoryError> {
    let mut held = Vec::new();
    for found in index.conflicts()? {
        let found = found?;
        let Some(path) = conflicted_path(&found) else {
            continue;
        };
        let file = kept.file(&path);
        match &found.our {
            Some(ours) => {
                if let Some(folder) = file.parent() {
                    fs::create_dir_all(folder)?;
                }
                fs::write(&file, kept.repo().find_blob(ours.id)?.content())?;
            }
            None => match fs::remove_file(&file) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                other => other?,
            },
        }
        if let Some(inside) = kept.in_vault(&path) {
            held.push(inside.to_owned());
        }
    }
    held.sort();
    Ok(held)
}

pub fn merge_in(vault: &Opened, data: &Path, name: &str) -> Result<Merged, HistoryError> {
    if of_a_draft(name) {
        return Err(no_branch(name));
    }
    let mut kept = at(vault)?;
    let Some(head) = branch_head(kept.repo(), name) else {
        return Err(no_branch(name));
    };
    if on(kept.repo())? == Some(name.to_owned()) {
        return Err(HistoryError::new("That is the one you are working on."));
    }
    merge_commit(&mut kept, vault, data, head, name)
}

/// Take a commit into the one the folder is on, whether it is a branch here or
/// what a remote had when this folder last heard — `name` is what the commit a
/// settled merge makes says it took in.
pub(crate) fn merge_commit(
    kept: &mut Kept,
    vault: &Opened,
    data: &Path,
    head: Oid,
    name: &str,
) -> Result<Merged, HistoryError> {
    let with = merging(&mut kept.repo)?;
    if let Some(why) = theirs_unfinished(kept, with) {
        return Err(why);
    }
    if with.is_some() {
        return Err(mid_merge());
    }
    let kept = &*kept;
    let repo = kept.repo();
    let theirs = repo.find_annotated_commit(head)?;
    let Some(mine) = head_commit(repo)? else {
        return Err(HistoryError::new(
            "There is nothing here to merge into yet. Commit what is in this folder first.",
        ));
    };
    if let Some(why) = unsettled(kept)?.refusal() {
        return Err(why);
    }
    let Some(branch) = on(repo)? else {
        return Err(HistoryError::new(
            "This folder is not on a branch, so there is nowhere to merge into.",
        ));
    };

    let (reading, _) = repo.merge_analysis(&[&theirs])?;
    if reading.is_up_to_date() {
        return Ok(Merged::whole());
    }
    if reading.is_fast_forward() {
        lay(kept, theirs.id(), WritesOver::NothingUnkept)?;
        repo.reference(
            &format!("refs/heads/{branch}"),
            theirs.id(),
            true,
            &format!("merge {name}"),
        )?;
        return Ok(Merged::whole());
    }
    settleable(kept, &mine, head)?;

    let held = set_aside(kept, theirs.id())?;
    let mut how = CheckoutBuilder::new();
    how.safe();
    let taken = repo
        .merge(&[&theirs], None, Some(&mut how))
        .map_err(in_the_way);
    put_back(kept, held)?;
    taken?;
    began_a_merge(kept, theirs.id())?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Ok(Merged::in_two_versions(one_version_each(kept, &index)?));
    }
    let tree = repo.find_tree(index.write_tree()?)?;
    index.write()?;
    let taken = repo.find_commit(theirs.id())?;
    record(
        kept,
        vault,
        data,
        &format!("Merge {name}"),
        &tree,
        &[&mine, &taken],
    )?;
    finished_the_merge(kept)?;
    Ok(Merged::whole())
}

/// A merge is refused BEFORE the folder is touched where it would leave the
/// person's own code in two versions: settling those is work they do where they
/// write the code, and a surface showing the vault alone could not even tell
/// them what is waiting. Worked out on the two states rather than in the folder,
/// so a merge refused this way leaves nothing half done.
fn settleable(kept: &Kept, mine: &git2::Commit<'_>, theirs: Oid) -> Result<(), HistoryError> {
    if kept.prefix.is_empty() {
        return Ok(());
    }
    let repo = kept.repo();
    let merged = repo.merge_commits(mine, &repo.find_commit(theirs)?, None)?;
    if !merged.has_conflicts() {
        return Ok(());
    }
    let outside = merged.conflicts()?.flatten().any(|found| {
        [&found.our, &found.their, &found.ancestor]
            .iter()
            .filter_map(|entry| entry.as_ref())
            .filter_map(|entry| String::from_utf8(entry.path.clone()).ok())
            .any(|path| kept.in_vault(&path).is_none())
    });
    if outside {
        return Err(HistoryError::new(
            "These two versions of the project disagree about files outside your notes. Settle those where you work on the code, then try again.",
        ));
    }
    Ok(())
}

pub fn settle(vault: &Opened, path: &str, side: ConflictSide) -> Result<(), HistoryError> {
    let mut kept = at(vault)?;
    let with = merging(&mut kept.repo)?;
    if let Some(why) = theirs_unfinished(&kept, with) {
        return Err(why);
    }
    let repo = kept.repo();
    let spelled = kept.spelled_here(path);
    let at = Path::new(&spelled);
    let mut index = repo.index()?;
    let held = index
        .conflicts()?
        .flatten()
        .find(|found| {
            [&found.our, &found.their, &found.ancestor]
                .iter()
                .filter_map(|entry| entry.as_ref())
                .any(|entry| entry.path == spelled.as_bytes())
        })
        .ok_or_else(|| HistoryError::new("That is not one of the ones in two versions."))?;
    let chosen = match side {
        ConflictSide::Mine => held.our,
        ConflictSide::Theirs => held.their,
    };
    let file = kept.file(&spelled);
    match chosen {
        Some(entry) => {
            if let Some(folder) = file.parent() {
                fs::create_dir_all(folder)?;
            }
            fs::write(&file, repo.find_blob(entry.id)?.content())?;
            index.remove_path(at)?;
            index.add_path(at)?;
        }
        None => {
            match fs::remove_file(&file) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                other => other?,
            }
            index.remove_path(at)?;
        }
    }
    index.write()?;
    Ok(())
}

pub fn read_at(vault: &Opened, commit: &str) -> Result<BTreeMap<String, String>, HistoryError> {
    let kept = at(vault)?;
    let repo = kept.repo();
    let held = repo
        .revparse_single(commit)
        .and_then(|found| found.peel_to_commit())
        .map_err(|_| not_here())?;
    let mut inside = BTreeMap::new();
    let mut failed = None;
    held.tree()?.walk(TreeWalkMode::PreOrder, |folder, entry| {
        if entry.kind() != Some(ObjectType::Blob) {
            return TreeWalkResult::Ok;
        }
        let Some(name) = entry.name() else {
            return TreeWalkResult::Ok;
        };
        let path = format!("{folder}{name}");
        let Some(at) = kept.in_vault(&path) else {
            return TreeWalkResult::Ok;
        };
        match repo.find_blob(entry.id()) {
            Ok(blob) => {
                inside.insert(at.to_owned(), BASE64.encode(blob.content()));
                TreeWalkResult::Ok
            }
            Err(error) => {
                failed = Some(error);
                TreeWalkResult::Abort
            }
        }
    })?;
    match failed {
        Some(error) => Err(error.into()),
        None => Ok(inside),
    }
}

pub fn head(vault: &Opened) -> Result<Option<String>, HistoryError> {
    Ok(head_commit(at(vault)?.repo())?.map(|held| held.id().to_string()))
}

/// Which of `paths` a commit made after `commit` has touched, on the branch the
/// folder is on. **These paths are from the root of what the history is
/// keeping** — the project root for a container, the vault root for a folder
/// that is its own repository — which is where an anchor into code is spelled
/// from; `History.changedSince` in `@sloppy/local` says the same.
pub fn changed_since(
    vault: &Opened,
    commit: &str,
    paths: &[String],
) -> Result<Vec<String>, HistoryError> {
    let kept = at(vault)?;
    let repo = kept.repo();
    let since = repo
        .revparse_single(commit)
        .and_then(|found| found.peel_to_commit())
        .map_err(|_| not_here())?;
    let mut asked: Vec<&str> = Vec::new();
    for path in paths {
        if !asked.contains(&path.as_str()) {
            asked.push(path);
        }
    }
    if asked.is_empty() || head_commit(repo)?.is_none() {
        return Ok(Vec::new());
    }
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    walk.hide(since.id())?;
    let mut moved: BTreeSet<&str> = BTreeSet::new();
    for id in walk {
        if moved.len() == asked.len() {
            break;
        }
        let held = repo.find_commit(id?)?;
        let was = match held.parent(0) {
            Ok(parent) => Some(parent.tree()?),
            Err(_) => None,
        };
        let mut how = DiffOptions::new();
        for path in &asked {
            how.pathspec(*path);
        }
        let diff = repo.diff_tree_to_tree(was.as_ref(), Some(&held.tree()?), Some(&mut how))?;
        for change in diff.deltas() {
            for file in [change.old_file().path(), change.new_file().path()] {
                let Some(file) = file.and_then(Path::to_str) else {
                    continue;
                };
                for path in &asked {
                    if file == *path || file.starts_with(&format!("{path}/")) {
                        moved.insert(path);
                    }
                }
            }
        }
    }
    Ok(asked
        .into_iter()
        .filter(|path| moved.contains(path))
        .map(str::to_owned)
        .collect())
}

fn opened(folders: &State<'_, Folders>, root: &str) -> Result<Opened, HistoryError> {
    Ok(folders.opened(root)?)
}

/// Where the key this app signs with is, which is nowhere a vault can reach.
fn private(folders: &State<'_, Folders>) -> PathBuf {
    PathBuf::from(folders.data_path())
}

#[tauri::command]
pub fn history_status(folders: State<'_, Folders>, root: String) -> Result<Status, HistoryError> {
    status(&opened(&folders, &root)?)
}

#[tauri::command]
pub fn history_log(
    folders: State<'_, Folders>,
    root: String,
    limit: i64,
    cursor: Option<String>,
) -> Result<CommitPage, HistoryError> {
    log(
        &opened(&folders, &root)?,
        &private(&folders),
        limit,
        cursor.as_deref(),
    )
}

#[tauri::command]
pub fn history_graph(
    folders: State<'_, Folders>,
    root: String,
    limit: i64,
    cursor: Option<String>,
) -> Result<CommitGraphPage, HistoryError> {
    graph(
        &opened(&folders, &root)?,
        &private(&folders),
        limit,
        cursor.as_deref(),
    )
}

#[tauri::command]
pub fn history_commit(
    folders: State<'_, Folders>,
    root: String,
    message: String,
) -> Result<Option<Commit>, HistoryError> {
    commit(&opened(&folders, &root)?, &private(&folders), &message)
}

#[tauri::command]
pub fn history_branches(
    folders: State<'_, Folders>,
    root: String,
) -> Result<Vec<Branch>, HistoryError> {
    branches(&opened(&folders, &root)?)
}

#[tauri::command]
pub fn history_branch(
    folders: State<'_, Folders>,
    root: String,
    name: String,
) -> Result<Branch, HistoryError> {
    branch(&opened(&folders, &root)?, &name)
}

#[tauri::command]
pub fn history_branch_at(
    folders: State<'_, Folders>,
    root: String,
    name: String,
    commit: String,
) -> Result<Branch, HistoryError> {
    branch_at(&opened(&folders, &root)?, &name, &commit)
}

#[tauri::command]
pub fn history_delete_branch(
    folders: State<'_, Folders>,
    root: String,
    name: String,
) -> Result<(), HistoryError> {
    delete_branch(&opened(&folders, &root)?, &name)
}

#[tauri::command]
pub fn history_git_user(
    folders: State<'_, Folders>,
    root: String,
) -> Result<Option<GitUser>, HistoryError> {
    git_user(&opened(&folders, &root)?)
}

#[tauri::command]
pub fn history_set_git_user(
    folders: State<'_, Folders>,
    root: String,
    user: GitUser,
) -> Result<(), HistoryError> {
    set_git_user(&opened(&folders, &root)?, &user)
}

#[tauri::command]
pub fn history_signing(
    folders: State<'_, Folders>,
    root: String,
) -> Result<SigningConfig, HistoryError> {
    signing(&opened(&folders, &root)?, &private(&folders))
}

#[tauri::command]
pub fn history_set_signing(
    folders: State<'_, Folders>,
    root: String,
    signing: SigningConfig,
) -> Result<(), HistoryError> {
    set_signing(&opened(&folders, &root)?, &private(&folders), &signing)
}

#[tauri::command]
pub fn history_switch(
    folders: State<'_, Folders>,
    root: String,
    name: String,
) -> Result<(), HistoryError> {
    switch_to(&opened(&folders, &root)?, &name)
}

#[tauri::command]
pub fn history_stand_on(
    folders: State<'_, Folders>,
    root: String,
    commit: String,
    carrying: bool,
) -> Result<(), HistoryError> {
    stand_on(&opened(&folders, &root)?, &commit, carrying)
}

#[tauri::command]
pub fn history_line_here(
    folders: State<'_, Folders>,
    root: String,
    name: String,
) -> Result<Branch, HistoryError> {
    line_here(&opened(&folders, &root)?, &name)
}

#[tauri::command]
pub fn history_rename_line(
    folders: State<'_, Folders>,
    root: String,
    from: String,
    to: String,
) -> Result<Branch, HistoryError> {
    rename_line(&opened(&folders, &root)?, &from, &to)
}

#[tauri::command]
pub fn history_abandon_merge(
    folders: State<'_, Folders>,
    root: String,
) -> Result<(), HistoryError> {
    abandon_merge(&opened(&folders, &root)?)
}

#[tauri::command]
pub fn history_merge(
    folders: State<'_, Folders>,
    root: String,
    name: String,
) -> Result<Merged, HistoryError> {
    merge_in(&opened(&folders, &root)?, &private(&folders), &name)
}

#[tauri::command]
pub fn history_resolve(
    folders: State<'_, Folders>,
    root: String,
    path: String,
    side: ConflictSide,
) -> Result<(), HistoryError> {
    // Where the page says the file is, checked here rather than taken on its
    // word.
    folders.within(&root, &path)?;
    settle(&opened(&folders, &root)?, &path, side)
}

#[tauri::command]
pub fn history_read_at(
    folders: State<'_, Folders>,
    root: String,
    commit: String,
) -> Result<BTreeMap<String, String>, HistoryError> {
    read_at(&opened(&folders, &root)?, &commit)
}

#[tauri::command]
pub fn history_head(
    folders: State<'_, Folders>,
    root: String,
) -> Result<Option<String>, HistoryError> {
    head(&opened(&folders, &root)?)
}

#[tauri::command]
pub fn history_changed_since(
    folders: State<'_, Folders>,
    root: String,
    commit: String,
    paths: Vec<String>,
) -> Result<Vec<String>, HistoryError> {
    changed_since(&opened(&folders, &root)?, &commit, &paths)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT: AtomicU32 = AtomicU32::new(0);

    /// Every test reads git config, and the person running it has one. What a
    /// folder says for itself is what these are about, so the levels above it
    /// are pointed at nothing.
    fn on_its_own() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            let nowhere = std::env::temp_dir().join(format!(
                "sloppy-no-config-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&nowhere).expect("a folder with no config in it");
            for level in [
                git2::ConfigLevel::System,
                git2::ConfigLevel::XDG,
                git2::ConfigLevel::Global,
                git2::ConfigLevel::ProgramData,
            ] {
                unsafe {
                    git2::opts::set_search_path(level, &nowhere).expect("no config up there");
                }
            }
        });
    }

    /// This app's own private data for a folder a test made, beside it rather
    /// than in it — the way the app keeps the two apart.
    pub(crate) fn private_for(root: &Path) -> PathBuf {
        let at = root.with_extension("data");
        fs::create_dir_all(&at).expect("the private data");
        at
    }

    /// What the vault inside a project's root folder is called —
    /// `CONTAINER_DIR` in `@sloppy/local`.
    pub(crate) const CONTAINER: &str = ".sloppy";

    pub(crate) fn scratch(name: &str) -> Opened {
        on_its_own();
        let at = std::env::temp_dir().join(format!(
            "sloppy-history-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&at);
        fs::create_dir_all(&at).expect("a scratch folder");
        Opened::own(&settled(&at))
    }

    /// A folder with a graph in it, as the app writes one.
    pub(crate) fn vault() -> Opened {
        let root = scratch("vault");
        write(
            &root,
            GRAPH_FILE,
            r#"{"format":1,"graph":"G","name":"Notes","owner":"did:syr:zOwner","owner_name":"Ada"}"#,
        );
        root
    }

    /// A project's container: the vault at `.sloppy/` inside the folder
    /// somebody picked, which is the project's own root.
    pub(crate) fn container(project: &Path) -> Opened {
        let root = project.join(CONTAINER);
        fs::create_dir_all(&root).expect("the container");
        let held = Opened::inside(&root, project);
        write(
            &held,
            GRAPH_FILE,
            r#"{"format":1,"graph":"G","name":"Notes","owner":"did:syr:zOwner","project":".."}"#,
        );
        held
    }

    pub(crate) fn write(root: &Path, path: &str, held: &str) {
        let at = root.join(path);
        if let Some(folder) = at.parent() {
            fs::create_dir_all(folder).expect("the folder");
        }
        fs::write(at, held).expect("the file");
    }

    pub(crate) fn read(root: &Path, path: &str) -> String {
        fs::read_to_string(root.join(path)).expect("the file")
    }

    pub(crate) fn made(root: &Opened, message: &str) -> Commit {
        commit(root, &private_for(root), message)
            .expect("the commit")
            .expect("a commit")
    }

    /// What a folder holds beside the graph that no commit of it may carry.
    pub(crate) fn beside_the_graph(root: &Path) {
        write(root, "identity.json", "{}");
        write(root, "identity.key", "a seed");
        write(root, "sloppy-identity.json", "{}");
        write(root, "folders.json", "[]");
        write(root, "vaults.json", "[]");
        write(root, "git.json", "{}");
        write(root, "credentials.json", "[]");
        write(root, "signing.key", "a key");
        write(root, ".sloppy/bin.json", "{}");
        write(root, ".sloppy/bin/note.md", "thrown away");
    }

    fn kept(root: &Opened) -> Vec<String> {
        read_at(root, "HEAD")
            .expect("the commit's vault")
            .into_keys()
            .collect()
    }

    #[test]
    fn a_folder_that_is_not_a_repository_becomes_one_that_keeps_no_identity() {
        let root = vault();
        beside_the_graph(&root);
        write(&root, "notes/a.md", "one");

        let held = status(&root).expect("the status");
        assert_eq!(held.branch.as_deref(), Some(DEFAULT_BRANCH));
        assert_eq!(held.ahead, 0);
        assert!(held.changed.is_empty());
        assert_eq!(held.untracked, vec![".gitignore", GRAPH_FILE, "notes/a.md"]);

        made(&root, "A graph");
        assert_eq!(kept(&root), [".gitignore", GRAPH_FILE, "notes/a.md"]);
    }

    #[test]
    fn a_folder_with_an_ignore_of_its_own_keeps_it_and_still_commits_no_identity() {
        let root = vault();
        write(&root, ".gitignore", "drafts/\n");
        beside_the_graph(&root);
        write(&root, "notes/a.md", "one");

        made(&root, "A graph");
        assert_eq!(read(&root, ".gitignore"), "drafts/\n");
        assert_eq!(kept(&root), [".gitignore", GRAPH_FILE, "notes/a.md"]);
    }

    #[test]
    fn a_folder_that_was_already_a_repository_commits_no_identity_either() {
        let root = scratch("theirs");
        Repository::init(&root).expect("their repository");
        write(&root, GRAPH_FILE, "{}");
        beside_the_graph(&root);
        write(&root, "notes/a.md", "one");

        made(&root, "A graph");
        assert_eq!(kept(&root), [GRAPH_FILE, "notes/a.md"]);
        assert!(!root.join(".gitignore").exists());
    }

    /// Everything in the folder, committed by the person themselves with their
    /// own git, which never heard of what the app keeps out.
    fn theirs(root: &Path, message: &str) {
        let repo = Repository::open(root).expect("their repository");
        let mut index = repo.index().expect("their index");
        index
            .add_all(["*"], IndexAddOption::FORCE, None)
            .expect("everything staged");
        index.write().expect("their index");
        let tree = repo
            .find_tree(index.write_tree().expect("their tree"))
            .expect("their tree");
        let by = Signature::now("Ada", "ada@example.com").expect("their signature");
        let head = head_commit(&repo).expect("their head");
        let parents: Vec<&git2::Commit<'_>> = head.iter().collect();
        repo.commit(Some("HEAD"), &by, &by, message, &tree, &parents)
            .expect("their commit");
    }

    #[test]
    fn a_repository_that_was_already_keeping_the_identity_stops_keeping_it() {
        let root = scratch("kept");
        Repository::init(&root).expect("their repository");
        write(&root, GRAPH_FILE, "{}");
        beside_the_graph(&root);
        write(&root, "notes/a.md", "one");
        theirs(&root, "Everything I had");
        assert!(kept(&root).contains(&".sloppy/bin.json".to_owned()));

        write(&root, "notes/a.md", "one, changed");
        made(&root, "A note");

        assert_eq!(kept(&root), [GRAPH_FILE, "notes/a.md"]);
        assert!(status(&root).expect("the status").changed.is_empty());
        for one in [
            "identity.json",
            "identity.key",
            "sloppy-identity.json",
            "folders.json",
            "vaults.json",
            "git.json",
            "credentials.json",
            "signing.key",
            ".sloppy/bin.json",
            ".sloppy/bin/note.md",
        ] {
            assert!(root.join(one).exists(), "{one} is still in the folder");
        }
    }

    #[test]
    fn a_copy_of_an_identity_saved_into_the_folder_never_reaches_a_commit() {
        let root = scratch("carried");
        Repository::init(&root).expect("their repository");
        write(&root, GRAPH_FILE, "{}");
        write(&root, "notes/a.md", "one");
        let copies = [
            "sloppy-identity.json",
            "sloppy-identity 2.json",
            "sloppy-identity",
            "notes/sloppy-identity.json",
        ];
        for one in copies {
            write(&root, one, "{\"key\":\"a key\"}");
        }
        theirs(&root, "Everything I had");
        assert!(kept(&root).contains(&"sloppy-identity.json".to_owned()));

        write(&root, "notes/a.md", "one, changed");
        made(&root, "A note");

        assert_eq!(kept(&root), [GRAPH_FILE, "notes/a.md"]);
        let held = status(&root).expect("the status");
        assert!(held.changed.is_empty() && held.untracked.is_empty());
        for one in copies {
            assert!(root.join(one).exists(), "{one} is gone from the folder");
        }
    }

    #[test]
    fn a_switch_lays_down_no_copy_of_an_identity_a_state_was_keeping() {
        let root = scratch("carried-switch");
        Repository::init(&root).expect("their repository");
        write(&root, GRAPH_FILE, "{}");
        write(&root, "notes/a.md", "one");
        write(&root, "sloppy-identity.json", "the copy by then");
        theirs(&root, "Everything I had");
        let on = status(&root)
            .expect("the status")
            .branch
            .expect("the branch they were on");
        branch(&root, "later").expect("the branch");

        write(&root, "notes/a.md", "one, changed");
        made(&root, "A note");
        write(&root, "sloppy-identity.json", "the copy now");

        switch_to(&root, "later").expect("the switch");
        assert_eq!(read(&root, "sloppy-identity.json"), "the copy now");
        switch_to(&root, &on).expect("back");
        assert_eq!(read(&root, "sloppy-identity.json"), "the copy now");
    }

    #[test]
    fn a_switch_onto_a_state_that_kept_the_bin_leaves_the_live_one_alone() {
        let root = scratch("switched");
        Repository::init(&root).expect("their repository");
        write(&root, GRAPH_FILE, "{}");
        write(&root, "notes/a.md", "one");
        write(&root, ".sloppy/bin.json", "the addresses spent by then");
        write(&root, "identity.key", "the seed by then");
        theirs(&root, "Everything I had");
        let on = status(&root)
            .expect("the status")
            .branch
            .expect("the branch they were on");
        branch(&root, "later").expect("the branch");

        write(&root, "notes/a.md", "one, changed");
        made(&root, "A note");
        write(&root, ".sloppy/bin.json", "one more address spent");
        write(&root, "identity.key", "the seed now");

        switch_to(&root, "later").expect("the switch");
        assert_eq!(read(&root, ".sloppy/bin.json"), "one more address spent");
        assert_eq!(read(&root, "identity.key"), "the seed now");
        let held = status(&root).expect("the status");
        assert_eq!(held.branch.as_deref(), Some("later"));
        assert!(held.changed.is_empty());

        switch_to(&root, &on).expect("back");
        assert_eq!(read(&root, ".sloppy/bin.json"), "one more address spent");
        assert_eq!(read(&root, "identity.key"), "the seed now");
    }

    #[test]
    fn a_merge_of_a_state_that_kept_the_bin_leaves_the_live_one_alone() {
        let root = vault();
        made(&root, "A graph");
        branch(&root, "later").expect("the branch");

        switch_to(&root, "later").expect("the switch");
        write(&root, ".sloppy/bin.json", "the addresses spent by then");
        write(&root, "notes/b.md", "theirs");
        theirs(&root, "Everything I had");

        switch_to(&root, "main").expect("back");
        write(&root, ".sloppy/bin.json", "one more address spent");
        write(&root, "notes/a.md", "mine");
        made(&root, "My note");

        assert!(
            merge_in(&root, &private_for(&root), "later")
                .expect("the merge")
                .merged
        );
        assert_eq!(read(&root, ".sloppy/bin.json"), "one more address spent");
        assert_eq!(read(&root, "notes/b.md"), "theirs");
        assert!(!kept(&root).contains(&".sloppy/bin.json".to_owned()));
        assert!(status(&root).expect("the status").changed.is_empty());
    }

    #[test]
    fn a_folder_inside_somebody_elses_repository_is_still_its_own_history() {
        let around = scratch("around");
        Repository::init(&around).expect("their repository");
        let root = Opened::own(&around.join("graph"));
        fs::create_dir_all(&root).expect("the folder");
        write(&root, GRAPH_FILE, "{}");

        made(&root, "A graph");
        assert!(root.join(".git").exists());
        assert_eq!(
            read_at(&root, "HEAD")
                .expect("the vault")
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            vec![".gitignore".to_owned(), GRAPH_FILE.to_owned()]
        );
    }

    #[test]
    fn what_is_written_and_what_is_not_kept_are_told_apart() {
        let root = vault();
        made(&root, "A graph");
        write(&root, "notes/a.md", "one");
        made(&root, "A note");

        write(&root, "notes/a.md", "one, changed");
        write(&root, "notes/b.md", "two");
        write(&root, ".sloppy/bin.json", "{}");
        fs::remove_file(root.join(GRAPH_FILE)).expect("the graph goes");

        let held = status(&root).expect("the status");
        assert_eq!(held.changed, vec![GRAPH_FILE, "notes/a.md"]);
        assert_eq!(held.untracked, vec!["notes/b.md"]);
    }

    /// What this device was told to begin a folder with, as `@sloppy/local`
    /// writes it into the private data.
    fn device_was_told(data: &Path, name: &str, email: &str) {
        fs::create_dir_all(data).expect("the private data");
        fs::write(
            data.join(GIT_DEFAULTS),
            format!(r#"{{"user":{{"name":"{name}","email":"{email}"}}}}"#),
        )
        .expect("what this device was told");
    }

    #[test]
    fn a_folder_that_names_nobody_takes_this_devices_default_when_it_first_commits() {
        let root = vault();
        device_was_told(&private_for(&root), "Grace Hopper", "grace@example.com");

        assert_eq!(made(&root, "A graph").author, "Grace Hopper");
        assert_eq!(
            git_user(&root).expect("who this folder's versions are by"),
            Some(GitUser {
                name: "Grace Hopper".to_owned(),
                email: "grace@example.com".to_owned(),
            })
        );
    }

    #[test]
    fn a_folder_that_names_somebody_keeps_them_and_one_told_nothing_falls_back_to_the_owner() {
        let named = vault();
        device_was_told(&private_for(&named), "Grace Hopper", "grace@example.com");
        set_git_user(
            &named,
            &GitUser {
                name: "Bee Kirkwood".to_owned(),
                email: "bee@example.com".to_owned(),
            },
        )
        .expect("who this folder's versions are by");
        assert_eq!(made(&named, "A graph").author, "Bee Kirkwood");

        let untold = vault();
        assert_eq!(made(&untold, "A graph").author, "Ada");
        assert!(git_user(&untold)
            .expect("who its versions are by")
            .is_none());
    }

    /// A folder set up on a computer that has the program, opened on one that
    /// has not, is still a folder somebody is writing in.
    #[test]
    fn a_version_that_cannot_be_signed_is_kept_unsigned_rather_than_refused() {
        let root = vault();
        let data = private_for(&root);
        let missing = root.join("not-a-program");
        {
            let kept = at(&root).expect("the repository");
            let mut config = kept
                .repo()
                .config()
                .expect("the config")
                .open_level(ConfigLevel::Local)
                .expect("its own");
            config.set_str("gpg.format", "openpgp").expect("how");
            config
                .set_str("gpg.program", &missing.to_string_lossy())
                .expect("what signs");
            config
                .set_bool("commit.gpgsign", true)
                .expect("that it does");
        }

        write(&root, "notes/a.md", "one");
        let held = made(&root, "A note");
        assert!(held.signature.is_none());
        assert!(kept(&root).contains(&"notes/a.md".to_owned()));
        // The setting is the folder's and stays for wherever that program is.
        assert!(matches!(
            signing(&root, &data).expect("how it signs"),
            SigningConfig::Openpgp { .. }
        ));
    }

    /// Choosing is where a person can do something about it, so that is where
    /// a program this machine has not got is refused.
    #[test]
    fn a_program_this_machine_has_not_got_is_refused_while_it_is_being_chosen() {
        let root = vault();
        let data = private_for(&root);
        let missing = root.join("not-a-program");

        assert_eq!(
            set_signing(
                &root,
                &data,
                &SigningConfig::Openpgp {
                    program: Some(missing.to_string_lossy().into_owned()),
                    key_id: None,
                },
            )
            .unwrap_err()
            .said(),
            format!(
                "Sloppy could not run {}. Check that it is installed.",
                missing.to_string_lossy()
            )
        );
        assert!(matches!(
            signing(&root, &data).expect("how it signs"),
            SigningConfig::None
        ));

        // A path with something at it this machine still cannot run is the same
        // answer: a folder, or a file without the bit that makes it a program.
        let folder = root.join("not-a-program-either");
        fs::create_dir_all(&folder).expect("the folder");
        assert_eq!(
            set_signing(
                &root,
                &data,
                &SigningConfig::Openpgp {
                    program: Some(folder.to_string_lossy().into_owned()),
                    key_id: None,
                },
            )
            .unwrap_err()
            .said(),
            format!(
                "Sloppy could not run {}. Check that it is installed.",
                folder.to_string_lossy()
            )
        );
        assert!(matches!(
            signing(&root, &data).expect("how it signs"),
            SigningConfig::None
        ));
    }

    /// A checkout the folder refuses leaves nothing of somebody's behind: what
    /// was moved out of its way is where it was.
    #[test]
    fn a_refused_checkout_puts_back_what_it_moved() {
        let root = vault();
        made(&root, "A graph");
        branch(&root, "later").expect("the branch");
        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/a.md", "theirs");
        write(&root, "notes/b.md", "two");
        made(&root, "Their notes");
        switch_to(&root, "main").expect("back");

        write(&root, "notes/a.md", "mine");
        write(&root, "notes/b.md", "two");

        assert_eq!(
            switch_to(&root, "later").unwrap_err().said(),
            "Something here that the history is not keeping would be written over. Move it out of this folder first."
        );
        assert_eq!(read(&root, "notes/a.md"), "mine");
        assert_eq!(read(&root, "notes/b.md"), "two");
        assert_eq!(
            status(&root).expect("the status").branch.as_deref(),
            Some("main")
        );
    }

    #[test]
    fn standing_on_a_version_writes_the_folder_as_it_was() {
        let root = vault();
        write(&root, "notes/a.md", "was");
        let first = made(&root, "A note");
        write(&root, "notes/a.md", "is");
        write(&root, "notes/b.md", "later");
        made(&root, "Another note");

        stand_on(&root, &first.id, false).expect("the stand");

        assert_eq!(read(&root, "notes/a.md"), "was");
        assert!(!root.join("notes/b.md").exists());
        assert_eq!(head(&root).expect("the version"), Some(first.id.clone()));

        let standing = status(&root).expect("the status");
        assert!(standing.branch.is_none());
        assert_eq!((standing.ahead, standing.behind), (0, 0));
        assert!(standing.upstream.is_none());
        assert!(standing.merging.is_none());
        assert!(standing.changed.is_empty() && standing.untracked.is_empty());
        assert!(branches(&root)
            .expect("the lines")
            .iter()
            .all(|one| !one.current));

        assert_eq!(
            stand_on(&root, "0000000000000000000000000000000000000000", false)
                .unwrap_err()
                .said(),
            "That is not one of the states this graph has been in."
        );
    }

    #[test]
    fn a_refused_stand_leaves_every_file_where_it_was() {
        let root = vault();
        write(&root, "notes/a.md", "was");
        let first = made(&root, "A note");
        write(&root, "notes/a.md", "is");
        made(&root, "Another note");
        write(&root, "notes/a.md", "and now this");

        assert_eq!(
            stand_on(&root, &first.id, false).unwrap_err().said(),
            "Commit what you have written here first, or put it back the way it was."
        );
        assert_eq!(read(&root, "notes/a.md"), "and now this");
        assert_eq!(
            status(&root).expect("the status").branch.as_deref(),
            Some(DEFAULT_BRANCH)
        );

        // Carrying it along is refused only by what that version has otherwise,
        // and leaves the folder alone just the same.
        assert_eq!(
            stand_on(&root, &first.id, true).unwrap_err().said(),
            "Some of what you have written here would be written over. Keep it first, then try again."
        );
        assert_eq!(read(&root, "notes/a.md"), "and now this");
        assert_eq!(
            status(&root).expect("the status").branch.as_deref(),
            Some(DEFAULT_BRANCH)
        );
    }

    #[test]
    fn a_stand_carrying_unkept_writing_takes_it_along() {
        let root = vault();
        write(&root, "notes/a.md", "was");
        let first = made(&root, "A note");
        write(&root, "notes/b.md", "later");
        made(&root, "Another note");

        write(&root, "notes/a.md", "written and not kept");
        write(&root, "notes/c.md", "nothing is keeping this");

        stand_on(&root, &first.id, true).expect("the stand");

        assert_eq!(read(&root, "notes/a.md"), "written and not kept");
        assert_eq!(read(&root, "notes/c.md"), "nothing is keeping this");
        assert!(!root.join("notes/b.md").exists());
        assert!(status(&root).expect("the status").branch.is_none());
    }

    /// `.sloppy/bin.json` carries every address this graph has spent, so a
    /// version that carries an older one never lands on it — docs/ARCHITECTURE.md
    /// § "The vault's history".
    #[test]
    fn standing_on_a_version_leaves_what_is_kept_out_of_the_history_alone() {
        let root = scratch("stand-aside");
        Repository::init(&root).expect("their repository");
        write(&root, GRAPH_FILE, "{}");
        beside_the_graph(&root);
        write(&root, "notes/a.md", "was");
        theirs(&root, "Everything I had");
        let first = head(&root).expect("the version").expect("a version");

        write(&root, "notes/a.md", "is");
        made(&root, "A note");
        write(&root, ".sloppy/bin.json", r#"{"spent":["1a","1b"]}"#);
        write(&root, ".sloppy/bin/note.md", "still in the bin");
        write(&root, "identity.key", "the seed this device holds");

        stand_on(&root, &first, false).expect("the stand");

        assert_eq!(read(&root, "notes/a.md"), "was");
        assert_eq!(read(&root, ".sloppy/bin.json"), r#"{"spent":["1a","1b"]}"#);
        assert_eq!(read(&root, ".sloppy/bin/note.md"), "still in the bin");
        assert_eq!(read(&root, "identity.key"), "the seed this device holds");
    }

    /// A line opens where the folder stands without a file moving, which is what
    /// lets it open on the first write rather than at the stand.
    #[test]
    fn a_line_opened_where_the_folder_stands_touches_no_file() {
        let root = vault();
        write(&root, "notes/a.md", "was");
        let first = made(&root, "A note");
        write(&root, "notes/a.md", "is");
        let second = made(&root, "Another note");

        stand_on(&root, &first.id, false).expect("the stand");
        write(&root, "notes/a.md", "written while standing here");

        let line = line_here(&root, "from-9f3c1a2b").expect("the line");
        assert_eq!(line.name, "from-9f3c1a2b");
        assert_eq!(line.head, first.id);
        assert!(line.current);

        assert_eq!(read(&root, "notes/a.md"), "written while standing here");
        let standing = status(&root).expect("the status");
        assert_eq!(standing.branch.as_deref(), Some("from-9f3c1a2b"));
        assert_eq!(standing.changed, vec!["notes/a.md"]);

        assert_eq!(
            line_here(&root, "from-9f3c1a2b").unwrap_err().said(),
            "There is already one called from-9f3c1a2b."
        );

        // And what is written there is kept on the new line, leaving the one it
        // sprang from where it was.
        let here = made(&root, "Written here");
        assert_eq!(here.parents, vec![first.id]);
        let lines = branches(&root).expect("the lines");
        let opened = lines
            .iter()
            .find(|one| one.name == "from-9f3c1a2b")
            .expect("the line opened here");
        assert_eq!(opened.head, here.id);
        assert!(opened.current);
        let from = lines
            .iter()
            .find(|one| one.name == DEFAULT_BRANCH)
            .expect("the line it sprang from");
        assert_eq!(from.head, second.id);
        assert!(!from.current);
    }

    #[test]
    fn a_line_renamed_takes_the_folder_with_it() {
        let root = vault();
        made(&root, "A graph");
        branch(&root, "later").expect("the line");

        let renamed = rename_line(&root, DEFAULT_BRANCH, "trunk").expect("the rename");
        assert_eq!(renamed.name, "trunk");
        assert!(renamed.current);
        assert_eq!(
            status(&root).expect("the status").branch.as_deref(),
            Some("trunk")
        );

        assert_eq!(
            rename_line(&root, "later", "trunk").unwrap_err().said(),
            "There is already one called trunk."
        );
        assert_eq!(
            rename_line(&root, "nowhere", "elsewhere")
                .unwrap_err()
                .said(),
            "There is nothing here called nowhere."
        );
        assert_eq!(
            rename_line(&root, "trunk", "a..b").unwrap_err().said(),
            "a..b will not work as a name. Try another."
        );
        assert_eq!(
            status(&root).expect("the status").branch.as_deref(),
            Some("trunk")
        );

        // One the folder is not on is renamed where it is, and the folder stays
        // where it is.
        let moved = rename_line(&root, "later", "sooner").expect("the rename");
        assert!(!moved.current);
        assert_eq!(
            status(&root).expect("the status").branch.as_deref(),
            Some("trunk")
        );
    }

    #[test]
    fn stopping_a_merge_leaves_the_folder_as_it_was_before_it() {
        let root = vault();
        write(&root, "notes/a.md", "was");
        let first = made(&root, "A note");
        branch(&root, "later").expect("the line");

        write(&root, "notes/a.md", "mine");
        let mine = made(&root, "My way");
        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/a.md", "theirs");
        write(&root, "notes/b.md", "only on their line");
        made(&root, "Their way");
        switch_to(&root, DEFAULT_BRANCH).expect("back");

        assert_eq!(
            abandon_merge(&root).unwrap_err().said(),
            "There is no merge here to stop."
        );

        merge_in(&root, &private_for(&root), "later").expect("the merge");
        settle(&root, "notes/a.md", ConflictSide::Theirs).expect("the choice");
        assert_eq!(read(&root, "notes/b.md"), "only on their line");
        assert_eq!(
            stand_on(&root, &first.id, false).unwrap_err().said(),
            "Finish the merge you are in the middle of first."
        );

        abandon_merge(&root).expect("the stop");

        assert_eq!(read(&root, "notes/a.md"), "mine");
        assert!(!root.join("notes/b.md").exists());
        let standing = status(&root).expect("the status");
        assert!(standing.merging.is_none());
        assert_eq!(standing.branch.as_deref(), Some(DEFAULT_BRANCH));
        assert!(standing.changed.is_empty() && standing.untracked.is_empty());
        assert_eq!(head(&root).expect("the version"), Some(mine.id));

        // And the folder is somewhere a person writes again.
        write(&root, "notes/c.md", "after");
        made(&root, "After all that");
    }

    /// Going back to before a merge is the one act that writes over whatever is
    /// here, so what a bare reset would hand back is an older bin.
    #[test]
    fn stopping_a_merge_leaves_what_is_kept_out_of_the_history_alone() {
        let root = scratch("stop-aside");
        Repository::init(&root).expect("their repository");
        write(&root, GRAPH_FILE, "{}");
        beside_the_graph(&root);
        write(&root, "notes/a.md", "was");
        theirs(&root, "Everything I had");
        let theirs_line = status(&root)
            .expect("the status")
            .branch
            .expect("the line their repository is on");

        branch(&root, "later").expect("the line");
        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/a.md", "theirs");
        theirs(&root, "Their way");
        switch_to(&root, &theirs_line).expect("back");
        write(&root, "notes/a.md", "mine");
        theirs(&root, "My way");

        merge_in(&root, &private_for(&root), "later").expect("the merge");
        write(&root, ".sloppy/bin.json", r#"{"spent":["1a","1b"]}"#);
        write(&root, "identity.key", "the seed this device holds");

        abandon_merge(&root).expect("the stop");

        assert_eq!(read(&root, "notes/a.md"), "mine");
        assert_eq!(read(&root, ".sloppy/bin.json"), r#"{"spent":["1a","1b"]}"#);
        assert_eq!(read(&root, "identity.key"), "the seed this device holds");
    }

    #[test]
    fn a_commit_is_by_whoever_the_graph_says_owns_it() {
        let root = vault();
        let first = made(&root, "A graph");
        assert_eq!(first.author, "Ada");
        assert_eq!(first.message, "A graph");
        assert!(first.parents.is_empty());
        assert!(first.at.ends_with('Z') && first.at.len() == "2026-01-01T00:00:00.000Z".len());

        write(
            &root,
            GRAPH_FILE,
            r#"{"format":1,"graph":"G","name":"Notes","owner":"did:syr:zOwner"}"#,
        );
        let next = made(&root, "No name on it");
        assert_eq!(next.author, "did:syr:zOwner");
        assert_eq!(next.parents, vec![first.id]);
    }

    #[test]
    fn a_commit_with_nothing_new_in_it_is_not_made() {
        let root = vault();
        made(&root, "A graph");
        assert!(commit(&root, &private_for(&root), "Again")
            .expect("the commit")
            .is_none());

        write(&root, "notes/a.md", "one");
        assert!(commit(&root, &private_for(&root), "A note")
            .expect("the commit")
            .is_some());
    }

    #[test]
    fn a_listing_reads_newest_first_and_carries_on_where_it_left_off() {
        let root = vault();
        let mut ids = Vec::new();
        for one in ["A graph", "A note", "Another"] {
            write(&root, &format!("notes/{one}.md"), one);
            ids.push(made(&root, one).id);
        }
        ids.reverse();

        let page = log(&root, &private_for(&root), 2, None).expect("the first page");
        assert_eq!(
            page.commits
                .iter()
                .map(|one| one.id.clone())
                .collect::<Vec<_>>(),
            ids[..2]
        );
        assert_eq!(page.cursor.as_deref(), Some(ids[2].as_str()));

        let rest = log(&root, &private_for(&root), 2, page.cursor.as_deref()).expect("the rest");
        assert_eq!(
            rest.commits
                .iter()
                .map(|one| one.id.clone())
                .collect::<Vec<_>>(),
            ids[2..]
        );
        assert!(rest.cursor.is_none());

        assert_eq!(
            log(
                &root,
                &private_for(&root),
                2,
                Some("0123456789abcdef0123456789abcdef01234567")
            )
            .unwrap_err()
            .said(),
            "That is not one of the states this graph has been in."
        );
    }

    #[test]
    fn a_listing_of_a_folder_with_no_commits_in_it_is_empty() {
        let root = vault();
        assert!(log(&root, &private_for(&root), 10, None)
            .expect("the listing")
            .commits
            .is_empty());
        assert!(head(&root).expect("the head").is_none());
        assert!(branches(&root).expect("the branches").is_empty());
    }

    #[test]
    fn a_branch_is_made_at_the_commit_the_folder_is_on() {
        let root = vault();
        assert_eq!(
            branch(&root, "later").unwrap_err().said(),
            "There is nothing here to branch off yet. Commit what is in this folder first."
        );

        let first = made(&root, "A graph");
        let made_branch = branch(&root, "later").expect("the branch");
        assert_eq!(made_branch.head, first.id);
        assert!(!made_branch.current);
        assert_eq!(
            branch(&root, "later").unwrap_err().said(),
            "There is already one called later."
        );

        let held = branches(&root).expect("the branches");
        assert_eq!(held.len(), 2);
        assert!(held.iter().any(|one| one.name == "main" && one.current));
        assert!(held.iter().any(|one| one.name == "later" && !one.current));
    }

    #[test]
    fn the_folder_moves_onto_a_branch_and_back() {
        let root = vault();
        made(&root, "A graph");
        branch(&root, "later").expect("the branch");
        switch_to(&root, "later").expect("the switch");
        assert_eq!(
            status(&root).expect("the status").branch.as_deref(),
            Some("later")
        );

        write(&root, "notes/a.md", "one");
        made(&root, "A note");
        switch_to(&root, "main").expect("back");
        assert!(!root.join("notes/a.md").exists());
        assert!(status(&root).expect("the status").changed.is_empty());
        switch_to(&root, "main").expect("the one it is on");

        assert_eq!(
            switch_to(&root, "nowhere").unwrap_err().said(),
            "There is nothing here called nowhere."
        );
    }

    #[test]
    fn a_switch_that_would_lose_writing_is_refused_and_the_status_holds_what_it_is() {
        let root = vault();
        made(&root, "A graph");
        branch(&root, "later").expect("the branch");
        for one in ["a", "b"] {
            write(&root, &format!("notes/{one}.md"), one);
        }
        made(&root, "Two notes");
        for one in ["a", "b"] {
            write(&root, &format!("notes/{one}.md"), "changed");
        }

        assert_eq!(
            switch_to(&root, "later").unwrap_err().said(),
            "Commit what you have written here first, or put it back the way it was."
        );
        assert_eq!(
            status(&root).expect("the status").changed,
            vec!["notes/a.md", "notes/b.md"]
        );
    }

    #[test]
    fn a_branch_nothing_else_moved_on_is_taken_whole() {
        let root = vault();
        made(&root, "A graph");
        branch(&root, "later").expect("the branch");
        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/a.md", "one");
        let ahead = made(&root, "A note");
        switch_to(&root, "main").expect("back");

        let held = merge_in(&root, &private_for(&root), "later").expect("the merge");
        assert!(held.merged);
        assert_eq!(
            head(&root).expect("the head").as_deref(),
            Some(ahead.id.as_str())
        );
        assert_eq!(read(&root, "notes/a.md"), "one");
        let held = status(&root).expect("the status");
        assert_eq!(held.branch.as_deref(), Some("main"));
        assert!(held.changed.is_empty());

        assert!(
            merge_in(&root, &private_for(&root), "later")
                .expect("nothing left")
                .merged
        );
        assert_eq!(
            merge_in(&root, &private_for(&root), "main")
                .unwrap_err()
                .said(),
            "That is the one you are working on."
        );
    }

    #[test]
    fn two_branches_that_wrote_different_notes_are_merged_into_one_commit() {
        let root = vault();
        made(&root, "A graph");
        branch(&root, "later").expect("the branch");
        write(&root, "notes/a.md", "mine");
        made(&root, "My note");

        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/b.md", "theirs");
        let theirs = made(&root, "Their note");
        switch_to(&root, "main").expect("back");

        assert!(
            merge_in(&root, &private_for(&root), "later")
                .expect("the merge")
                .merged
        );
        assert_eq!(read(&root, "notes/a.md"), "mine");
        assert_eq!(read(&root, "notes/b.md"), "theirs");

        let page = log(&root, &private_for(&root), 1, None).expect("the listing");
        assert_eq!(page.commits[0].message, "Merge later");
        assert_eq!(page.commits[0].parents.len(), 2);
        assert!(page.commits[0].parents.contains(&theirs.id));
        assert!(status(&root).expect("the status").changed.is_empty());
    }

    #[test]
    fn a_note_both_sides_wrote_is_answered_and_left_in_one_version() {
        let root = vault();
        write(&root, "notes/a.md", "was");
        made(&root, "A note");
        branch(&root, "later").expect("the branch");

        write(&root, "notes/a.md", "mine");
        made(&root, "My way");
        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/a.md", "theirs");
        let theirs = made(&root, "Their way");
        switch_to(&root, "main").expect("back");

        let held = merge_in(&root, &private_for(&root), "later").expect("the merge");
        assert!(!held.merged);
        assert_eq!(
            held.conflicts.as_deref(),
            Some(["notes/a.md".to_owned()].as_slice())
        );
        assert_eq!(read(&root, "notes/a.md"), "mine");

        assert_eq!(
            commit(&root, &private_for(&root), "Too soon")
                .unwrap_err()
                .said(),
            "Some of these are still here in two versions. Choose one of each and try again."
        );
        assert_eq!(
            merge_in(&root, &private_for(&root), "later")
                .unwrap_err()
                .said(),
            "Finish the merge you are in the middle of first."
        );
        assert_eq!(
            switch_to(&root, "later").unwrap_err().said(),
            "Finish the merge you are in the middle of first."
        );
        assert_eq!(
            settle(&root, "notes/b.md", ConflictSide::Mine)
                .unwrap_err()
                .said(),
            "That is not one of the ones in two versions."
        );

        settle(&root, "notes/a.md", ConflictSide::Theirs).expect("the choice");
        assert_eq!(read(&root, "notes/a.md"), "theirs");

        let finished = made(&root, "Merge later");
        assert_eq!(finished.parents.len(), 2);
        assert!(finished.parents.contains(&theirs.id));
        assert!(status(&root).expect("the status").changed.is_empty());
        assert!(commit(&root, &private_for(&root), "Again")
            .expect("nothing left")
            .is_none());
    }

    #[test]
    fn the_merge_in_the_middle_is_read_off_the_folder() {
        let root = vault();
        write(&root, "notes/a.md", "was");
        made(&root, "A note");
        branch(&root, "later").expect("the branch");

        write(&root, "notes/a.md", "mine");
        made(&root, "My way");
        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/a.md", "theirs");
        let theirs = made(&root, "Their way");
        switch_to(&root, "main").expect("back");

        assert!(status(&root).expect("the status").merging.is_none());
        merge_in(&root, &private_for(&root), "later").expect("the merge");

        let held = status(&root)
            .expect("the status")
            .merging
            .expect("mid-merge");
        assert_eq!(held.taking, theirs.id);
        assert_eq!(held.in_two_versions, vec!["notes/a.md".to_owned()]);

        settle(&root, "notes/a.md", ConflictSide::Theirs).expect("the choice");
        let held = status(&root)
            .expect("the status")
            .merging
            .expect("mid-merge");
        assert_eq!(held.taking, theirs.id);
        assert!(held.in_two_versions.is_empty());

        made(&root, "Merge later");
        assert!(status(&root).expect("the status").merging.is_none());
    }

    #[test]
    fn a_note_one_side_took_away_and_the_other_wrote_is_settled_either_way() {
        let root = vault();
        write(&root, "notes/a.md", "was");
        made(&root, "A note");
        branch(&root, "later").expect("the branch");

        fs::remove_file(root.join("notes/a.md")).expect("it goes");
        made(&root, "It goes");
        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/a.md", "theirs");
        made(&root, "Their way");
        switch_to(&root, "main").expect("back");

        let held = merge_in(&root, &private_for(&root), "later").expect("the merge");
        assert_eq!(
            held.conflicts.as_deref(),
            Some(["notes/a.md".to_owned()].as_slice())
        );
        assert!(!root.join("notes/a.md").exists());

        settle(&root, "notes/a.md", ConflictSide::Mine).expect("the choice");
        assert!(!root.join("notes/a.md").exists());
        let finished = made(&root, "Merge later");
        assert_eq!(finished.parents.len(), 2);
        assert!(!read_at(&root, &finished.id)
            .expect("the vault")
            .contains_key("notes/a.md"));
    }

    #[test]
    fn a_past_state_is_read_whole_and_the_folder_stays_where_it_is() {
        let root = vault();
        write(&root, "notes/a.md", "one");
        write(&root, "media/p.png", "a picture");
        let first = made(&root, "A note");

        write(&root, "notes/a.md", "one, changed");
        fs::remove_file(root.join("media/p.png")).expect("it goes");
        let next = made(&root, "Changed");

        let was = read_at(&root, &first.id).expect("the first vault");
        assert_eq!(was.get("notes/a.md"), Some(&BASE64.encode("one")));
        assert_eq!(was.get("media/p.png"), Some(&BASE64.encode("a picture")));

        let now = read_at(&root, &next.id).expect("the second vault");
        assert_eq!(now.get("notes/a.md"), Some(&BASE64.encode("one, changed")));
        assert!(!now.contains_key("media/p.png"));

        assert_eq!(read(&root, "notes/a.md"), "one, changed");
        assert_eq!(
            head(&root).expect("the head").as_deref(),
            Some(next.id.as_str())
        );
        assert_eq!(
            read_at(&root, "not a commit").unwrap_err().said(),
            "That is not one of the states this graph has been in."
        );
    }

    /// The acts as the page calls them, so a command that is not registered, or
    /// whose arguments the page spells differently, fails here rather than in
    /// somebody's hands.
    #[test]
    fn the_acts_cross_the_bridge_as_the_page_spells_them() {
        use tauri::ipc::{CallbackFn, InvokeBody};
        use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
        use tauri::webview::InvokeRequest;
        use tauri::Manager as _;

        let root = vault();
        let folders = Folders::new(scratch("data").to_path_buf()).expect("the private data");
        folders
            .pick(root.to_path_buf())
            .expect("picking the folder");
        let spelled = root.to_string_lossy().into_owned();

        let app = mock_builder()
            .invoke_handler(crate::commands())
            .build(mock_context(noop_assets()))
            .expect("an app");
        app.manage(folders);
        let page = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("a page");

        let ask = |cmd: &str, args: serde_json::Value| {
            tauri::test::get_ipc_response(
                &page,
                InvokeRequest {
                    cmd: cmd.into(),
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: InvokeBody::Json(args),
                    headers: Default::default(),
                    invoke_key: INVOKE_KEY.to_string(),
                },
            )
        };

        let first = ask(
            "history_commit",
            serde_json::json!({ "root": spelled, "message": "A graph" }),
        )
        .expect("the commit")
        .deserialize::<serde_json::Value>()
        .expect("what the page is handed");
        assert_eq!(first["author"], "Ada");

        assert_eq!(
            ask("history_head", serde_json::json!({ "root": spelled }))
                .expect("the head")
                .deserialize::<Option<String>>()
                .expect("what the page is handed"),
            Some(first["id"].as_str().expect("an id").to_owned())
        );

        let held = ask("history_status", serde_json::json!({ "root": spelled }))
            .expect("the status")
            .deserialize::<serde_json::Value>()
            .expect("what the page is handed");
        assert_eq!(held["branch"], "main");
        assert_eq!(held["ahead"], 0);
        assert_eq!(held["behind"], 0);
        assert!(held.get("upstream").is_none());
        assert_eq!(held["changed"], serde_json::json!([]));

        assert!(ask(
            "history_branch",
            serde_json::json!({ "root": spelled, "name": "later" })
        )
        .is_ok());
        assert!(ask(
            "history_switch",
            serde_json::json!({ "root": spelled, "name": "later" })
        )
        .is_ok());
        assert_eq!(
            ask(
                "history_merge",
                serde_json::json!({ "root": spelled, "name": "main" })
            )
            .expect("the merge")
            .deserialize::<serde_json::Value>()
            .expect("what the page is handed"),
            serde_json::json!({ "merged": true })
        );
        assert!(ask(
            "history_log",
            serde_json::json!({ "root": spelled, "limit": 10, "cursor": null })
        )
        .is_ok());
        assert!(ask(
            "history_read_at",
            serde_json::json!({ "root": spelled, "commit": "HEAD" })
        )
        .is_ok());
        assert_eq!(
            ask(
                "history_resolve",
                serde_json::json!({ "root": spelled, "path": "notes/a.md", "side": "mine" })
            )
            .unwrap_err(),
            serde_json::json!("That is not one of the ones in two versions.")
        );

        let drawn = ask(
            "history_graph",
            serde_json::json!({ "root": spelled, "limit": 10, "cursor": null }),
        )
        .expect("the picture")
        .deserialize::<serde_json::Value>()
        .expect("what the page is handed");
        assert_eq!(
            drawn["commits"][0]["refs"],
            serde_json::json!(["later", "main"])
        );
        assert!(drawn["commits"][0]["id"].is_string());
        assert!(drawn["commits"][0].get("signature").is_none());

        assert_eq!(
            ask(
                "history_set_git_user",
                serde_json::json!({
                    "root": spelled,
                    "user": { "name": "Grace", "email": "grace@example.com" }
                })
            )
            .expect("the user")
            .deserialize::<serde_json::Value>()
            .expect("what the page is handed"),
            serde_json::Value::Null
        );
        assert_eq!(
            ask("history_git_user", serde_json::json!({ "root": spelled }))
                .expect("the user")
                .deserialize::<serde_json::Value>()
                .expect("what the page is handed"),
            serde_json::json!({ "name": "Grace", "email": "grace@example.com" })
        );

        assert_eq!(
            ask("history_signing", serde_json::json!({ "root": spelled }))
                .expect("how it signs")
                .deserialize::<serde_json::Value>()
                .expect("what the page is handed"),
            serde_json::json!({ "kind": "none" })
        );
        assert!(ask(
            "history_set_signing",
            serde_json::json!({ "root": spelled, "signing": { "kind": "ssh", "key": { "kind": "kept" } } })
        )
        .is_ok());
        let signs = ask("history_signing", serde_json::json!({ "root": spelled }))
            .expect("how it signs")
            .deserialize::<serde_json::Value>()
            .expect("what the page is handed");
        assert_eq!(signs["kind"], "ssh");
        assert_eq!(signs["key"], serde_json::json!({ "kind": "kept" }));
        // Settings offers this to copy, so it crosses under the name the page
        // reads it by.
        assert!(signs["publicKey"]
            .as_str()
            .expect("the half a host is given")
            .starts_with("ssh-ed25519 "));

        let first = first["id"].as_str().expect("an id").to_owned();
        assert!(ask(
            "history_branch_at",
            serde_json::json!({ "root": spelled, "name": "from-then", "commit": first })
        )
        .is_ok());
        assert!(ask(
            "history_delete_branch",
            serde_json::json!({ "root": spelled, "name": "from-then" })
        )
        .is_ok());

        let there = scratch("host");
        let kept = Repository::init_bare(&there).expect("a place to keep it");
        // The branch a host answers with is the one this folder is on by then.
        kept.set_head("refs/heads/later").expect("what it is on");
        let url = there.to_string_lossy().into_owned();
        assert!(ask(
            "history_add_remote",
            serde_json::json!({ "root": spelled, "name": "origin", "url": url })
        )
        .is_ok());
        assert_eq!(
            ask("history_remotes", serde_json::json!({ "root": spelled }))
                .expect("the remotes")
                .deserialize::<serde_json::Value>()
                .expect("what the page is handed"),
            serde_json::json!([{ "name": "origin", "url": url }])
        );
        assert!(ask(
            "history_rename_remote",
            serde_json::json!({ "root": spelled, "name": "origin", "to": "mine" })
        )
        .is_ok());
        assert!(ask(
            "history_set_remote_url",
            serde_json::json!({ "root": spelled, "name": "mine", "url": url })
        )
        .is_ok());
        assert!(ask(
            "history_push",
            serde_json::json!({ "root": spelled, "remote": "mine", "credential": null })
        )
        .is_ok());
        assert!(ask(
            "history_fetch",
            serde_json::json!({
                "root": spelled,
                "remote": "mine",
                "credential": { "kind": "token", "username": "somebody", "token": "a token" }
            })
        )
        .is_ok());
        assert_eq!(
            ask(
                "history_pull",
                serde_json::json!({
                    "root": spelled,
                    "remote": null,
                    "credential": { "kind": "ssh", "key": { "kind": "file", "path": "/keys/id_ed25519" } }
                })
            )
            .expect("the pull")
            .deserialize::<serde_json::Value>()
            .expect("what the page is handed"),
            serde_json::json!({ "merged": true })
        );

        let arriving = scratch("arriving");
        app.state::<Folders>()
            .pick(arriving.to_path_buf())
            .expect("picking the folder");
        assert!(ask(
            "files_clone",
            serde_json::json!({
                "url": url,
                "into": arriving.to_string_lossy(),
                "credential": null
            })
        )
        .is_ok());
        assert!(arriving.join(GRAPH_FILE).exists());
        assert!(ask(
            "history_remove_remote",
            serde_json::json!({ "root": spelled, "name": "mine" })
        )
        .is_ok());

        assert_eq!(
            ask(
                "history_rename_line",
                serde_json::json!({ "root": spelled, "from": "later", "to": "sooner" })
            )
            .expect("the rename")
            .deserialize::<serde_json::Value>()
            .expect("what the page is handed"),
            serde_json::json!({ "name": "sooner", "head": first, "current": true })
        );
        assert!(ask(
            "history_stand_on",
            serde_json::json!({ "root": spelled, "commit": "HEAD", "carrying": false })
        )
        .is_ok());
        assert!(
            ask("history_status", serde_json::json!({ "root": spelled }))
                .expect("the status")
                .deserialize::<serde_json::Value>()
                .expect("what the page is handed")
                .get("branch")
                .is_none()
        );
        assert_eq!(
            ask(
                "history_line_here",
                serde_json::json!({ "root": spelled, "name": "from-now" })
            )
            .expect("the line")
            .deserialize::<serde_json::Value>()
            .expect("what the page is handed"),
            serde_json::json!({ "name": "from-now", "head": first, "current": true })
        );
        assert_eq!(
            ask(
                "history_abandon_merge",
                serde_json::json!({ "root": spelled })
            )
            .unwrap_err(),
            serde_json::json!("There is no merge here to stop.")
        );

        // A folder nobody opened has no history here, whatever the page asks of
        // it.
        let elsewhere = scratch("elsewhere").to_string_lossy().into_owned();
        for (cmd, args) in [
            ("history_status", serde_json::json!({ "root": elsewhere })),
            ("history_head", serde_json::json!({ "root": elsewhere })),
            (
                "history_commit",
                serde_json::json!({ "root": elsewhere, "message": "Theirs" }),
            ),
        ] {
            assert_eq!(
                ask(cmd, args).unwrap_err(),
                serde_json::json!("That folder is not open. Choose it to open the graph in it.")
            );
        }
        assert!(!PathBuf::from(&elsewhere).join(".git").exists());
    }

    #[test]
    fn the_commits_are_by_the_git_user_this_folder_names() {
        let root = vault();
        assert!(git_user(&root).expect("the user").is_none());
        assert_eq!(made(&root, "A graph").author, "Ada");

        set_git_user(
            &root,
            &GitUser {
                name: "Grace".into(),
                email: "grace@example.com".into(),
            },
        )
        .expect("the user");
        let held = git_user(&root).expect("the user").expect("somebody");
        assert_eq!(
            (held.name.as_str(), held.email.as_str()),
            ("Grace", "grace@example.com")
        );

        write(&root, "notes/a.md", "one");
        assert_eq!(made(&root, "A note").author, "Grace");
    }

    /// Settings shows the kept key's public half for a person to paste where
    /// their host wants it, and the only place it can come from is here.
    #[test]
    fn the_kept_key_comes_back_with_the_half_a_host_is_given() {
        let root = vault();
        let data = private_for(&root);
        set_signing(
            &root,
            &data,
            &SigningConfig::Ssh {
                key: crate::signing::SshKey::Kept,
                public_key: None,
            },
        )
        .expect("the choice");

        let SigningConfig::Ssh { key, public_key } = signing(&root, &data).expect("how it signs")
        else {
            panic!("the key this app keeps");
        };
        assert!(matches!(key, crate::signing::SshKey::Kept));
        let shown = public_key.expect("the half a host is given");
        assert!(shown.starts_with("ssh-ed25519 "));
        assert_eq!(shown.lines().count(), 1);

        // A key somebody else named is a key this app has no half to hand out.
        let theirs = scratch("a-named-key").join("id_ed25519");
        fs::copy(data.join("signing.key"), &theirs).expect("their key");
        set_signing(
            &root,
            &data,
            &SigningConfig::Ssh {
                key: crate::signing::SshKey::File {
                    path: theirs.to_string_lossy().into_owned(),
                },
                public_key: None,
            },
        )
        .expect("the choice");
        assert!(matches!(
            signing(&root, &data).expect("how it signs"),
            SigningConfig::Ssh {
                key: crate::signing::SshKey::File { .. },
                public_key: None
            }
        ));
    }

    #[test]
    fn a_commit_signed_with_the_key_this_app_keeps_says_so_in_every_listing() {
        let root = vault();
        let data = private_for(&root);
        assert!(matches!(
            signing(&root, &data).expect("how it signs"),
            SigningConfig::None
        ));
        made(&root, "A graph");

        set_signing(
            &root,
            &data,
            &SigningConfig::Ssh {
                key: crate::signing::SshKey::Kept,
                public_key: None,
            },
        )
        .expect("the choice");
        assert!(matches!(
            signing(&root, &data).expect("how it signs"),
            SigningConfig::Ssh {
                key: crate::signing::SshKey::Kept,
                ..
            }
        ));
        write(&root, "notes/a.md", "one");
        let signed = made(&root, "A note");

        let held = signed.signature.expect("a signature");
        assert!(held.by.starts_with("SHA256:"));
        assert!(held.verified);

        let page = log(&root, &data, 2, None).expect("the listing");
        assert_eq!(
            page.commits[0].signature.as_ref().map(|one| one.verified),
            Some(true)
        );
        // The one made before the folder signed carries nothing, and that is
        // not this listing failing to look.
        assert!(page.commits[1].signature.is_none());

        let drawn = graph(&root, &data, 2, None).expect("the picture");
        assert_eq!(
            drawn.commits[0]
                .commit
                .signature
                .as_ref()
                .map(|one| one.by.clone()),
            Some(held.by.clone())
        );

        // A commit whose key this device cannot tell is what it claims is said
        // to be signed all the same.
        fs::remove_file(root.join(".sloppy/allowed_signers")).expect("what the folder vouched for");
        let elsewhere = private_for(&scratch("another-device"));
        let page = log(&root, &elsewhere, 1, None).expect("the listing");
        let held = page.commits[0].signature.as_ref().expect("a signature");
        assert!(held.by.starts_with("SHA256:"));
        assert!(!held.verified);
    }

    /// The claim is that somebody's own tools agree with what this one wrote,
    /// so the check is somebody's own tool.
    #[test]
    fn a_signature_this_app_made_is_one_ssh_agrees_with() {
        let root = vault();
        let data = private_for(&root);
        set_signing(
            &root,
            &data,
            &SigningConfig::Ssh {
                key: crate::signing::SshKey::Kept,
                public_key: None,
            },
        )
        .expect("the choice");
        let signed = made(&root, "A graph");

        let kept = at(&root).expect("the repository");
        let (armour, content) = kept
            .repo()
            .extract_signature(&Oid::from_str(&signed.id).expect("an id"), None)
            .expect("a signature");
        let beside = scratch("checked");
        fs::write(beside.join("sig"), &*armour).expect("the signature");
        fs::write(beside.join("content"), &*content).expect("what was signed");

        let asked = std::process::Command::new("ssh-keygen")
            .args(["-Y", "verify", "-n", "git", "-I", "sloppy"])
            .arg("-f")
            .arg(root.join(".sloppy/allowed_signers"))
            .arg("-s")
            .arg(beside.join("sig"))
            .stdin(std::process::Stdio::from(
                fs::File::open(beside.join("content")).expect("what was signed"),
            ))
            .output();
        let held = match asked {
            Ok(held) => held,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return,
            Err(error) => panic!("ssh-keygen: {error}"),
        };
        assert!(
            held.status.success(),
            "{}{}",
            String::from_utf8_lossy(&held.stdout),
            String::from_utf8_lossy(&held.stderr)
        );
    }

    #[test]
    fn the_picture_of_the_history_carries_every_branch_and_what_is_at_it() {
        let root = vault();
        let data = private_for(&root);
        let first = made(&root, "A graph");
        branch(&root, "later").expect("the branch");
        switch_to(&root, "later").expect("the switch");
        write(&root, "notes/a.md", "one");
        let theirs = made(&root, "A note");
        switch_to(&root, "main").expect("back");
        write(&root, "notes/b.md", "two");
        let mine = made(&root, "Another note");

        let held = graph(&root, &data, 10, None).expect("the picture");
        let ids: Vec<&str> = held
            .commits
            .iter()
            .map(|one| one.commit.id.as_str())
            .collect();
        assert_eq!(ids.len(), 3);
        assert!(ids.contains(&mine.id.as_str()) && ids.contains(&theirs.id.as_str()));
        // Never a commit above what it springs from.
        assert_eq!(ids[2], first.id);
        let at_head: Vec<&[String]> = held.commits.iter().map(|one| one.refs.as_slice()).collect();
        assert_eq!(
            held.commits
                .iter()
                .find(|one| one.commit.id == mine.id)
                .expect("mine")
                .refs,
            vec!["main".to_owned()]
        );
        assert_eq!(
            held.commits
                .iter()
                .find(|one| one.commit.id == theirs.id)
                .expect("theirs")
                .refs,
            vec!["later".to_owned()]
        );
        assert!(at_head.iter().any(|refs| refs.is_empty()));
        assert!(held.cursor.is_none());

        let page = graph(&root, &data, 2, None).expect("the first page");
        assert_eq!(page.commits.len(), 2);
        let rest = graph(&root, &data, 2, page.cursor.as_deref()).expect("the rest");
        assert_eq!(rest.commits.len(), 1);
        assert_eq!(rest.commits[0].commit.id, first.id);
        assert_eq!(
            graph(
                &root,
                &data,
                1,
                Some("0123456789abcdef0123456789abcdef01234567")
            )
            .unwrap_err()
            .said(),
            "That is not one of the states this graph has been in."
        );
    }

    #[test]
    fn a_branch_is_made_back_in_the_history_and_taken_away_again() {
        let root = vault();
        let first = made(&root, "A graph");
        write(&root, "notes/a.md", "one");
        made(&root, "A note");

        let made_branch = branch_at(&root, "from-then", &first.id).expect("the branch");
        assert_eq!(made_branch.head, first.id);
        assert!(!made_branch.current);
        assert_eq!(
            status(&root).expect("the status").branch.as_deref(),
            Some("main")
        );
        assert_eq!(
            branch_at(&root, "from-then", &first.id).unwrap_err().said(),
            "There is already one called from-then."
        );
        assert_eq!(
            branch_at(&root, "elsewhere", "not a commit")
                .unwrap_err()
                .said(),
            "That is not one of the states this graph has been in."
        );

        assert_eq!(
            delete_branch(&root, "main").unwrap_err().said(),
            "That is the one you are working on."
        );
        assert_eq!(
            delete_branch(&root, "nowhere").unwrap_err().said(),
            "There is nothing here called nowhere."
        );
        delete_branch(&root, "from-then").expect("it goes");
        assert!(branches(&root)
            .expect("the branches")
            .iter()
            .all(|one| one.name != "from-then"));
    }

    // ── A project's container ────────────────────────────────────────────────

    /// A project with a repository of its own, and the container inside it:
    /// what the app opens when somebody opens the project's root folder.
    pub(crate) fn project(name: &str) -> (Opened, Opened) {
        let root = scratch(name);
        let mut how = RepositoryInitOptions::new();
        how.initial_head(DEFAULT_BRANCH);
        Repository::init_opts(&root, &how).expect("their repository");
        write(&root, "src/a.ts", "one");
        let held = container(&root);
        (root, held)
    }

    /// A commit the person makes themselves, of the paths they name — the
    /// history a project already has, which Sloppy did not write.
    pub(crate) fn their_commit(root: &Path, paths: &[&str], message: &str) -> String {
        let repo = Repository::open(root).expect("their repository");
        let mut index = repo.index().expect("the index");
        for path in paths {
            index.add_path(Path::new(path)).expect("what they staged");
        }
        index.write().expect("their index");
        let tree = repo
            .find_tree(index.write_tree().expect("a tree"))
            .expect("the tree");
        let by = Signature::now("Ada", "ada@example.com").expect("a name");
        let was = head_commit(&repo).expect("the head");
        let parents: Vec<&git2::Commit<'_>> = was.iter().collect();
        repo.commit(Some("HEAD"), &by, &by, message, &tree, &parents)
            .expect("their commit")
            .to_string()
    }

    /// What the person does in their own repository with their own git, which
    /// is how a state this app never begins gets into a test. The levels above
    /// the folder are pointed at nothing, as they are for every other test.
    fn their_git(root: &Path, args: &[&str]) -> std::process::Output {
        std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Ada",
                "-c",
                "user.email=ada@example.com",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(root)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("their git")
    }

    /// Where git holds what a rebase the person is in the middle of still has
    /// to do, whichever way their git goes about one.
    fn mid_rebase_at(root: &Path) -> PathBuf {
        [".git/rebase-merge", ".git/rebase-apply"]
            .iter()
            .map(|at| root.join(at))
            .find(|at| at.exists())
            .expect("a rebase in the middle")
    }

    /// Two versions of the project's own code, with the second stopped part way
    /// through a rebase onto the first and the folder settled — what an act
    /// that lays a commit down would otherwise walk straight past.
    fn their_rebase(root: &Path) -> PathBuf {
        their_git(root, &["branch", "theirs"]);
        write(root, "src/b.ts", "mine");
        their_commit(root, &["src/b.ts"], "My code");
        their_git(root, &["checkout", "theirs"]);
        write(root, "src/c.ts", "theirs");
        their_commit(root, &["src/c.ts"], "Their code");
        their_git(root, &["rebase", "--exec", "false", DEFAULT_BRANCH]);
        mid_rebase_at(root)
    }

    /// The repository is the project's, and what it is in the middle of is the
    /// person's own work, held in the repository itself.
    #[test]
    fn a_project_in_the_middle_of_a_rebase_is_left_alone() {
        let (root, held) = project("mid-rebase");
        their_commit(&root, &["src/a.ts"], "The code");
        write(&held, "notes/a.md", "one");
        let note = made(&held, "A note");
        branch(&held, "later").expect("a branch");
        let rebase = their_rebase(&root);

        write(&held, "notes/b.md", "two");
        assert_eq!(
            commit(&held, &private_for(&held), "Another note")
                .unwrap_err()
                .said(),
            "This project is in the middle of something else. Finish or stop it where you work on the code, then try again."
        );
        assert_eq!(
            switch_to(&held, "later").unwrap_err().said(),
            "This project is in the middle of something else. Finish or stop it where you work on the code, then try again."
        );
        assert_eq!(
            stand_on(&held, &note.id, false).unwrap_err().said(),
            "This project is in the middle of something else. Finish or stop it where you work on the code, then try again."
        );
        assert_eq!(
            line_here(&held, "from-then").unwrap_err().said(),
            "This project is in the middle of something else. Finish or stop it where you work on the code, then try again."
        );

        // What the rebase still has to do is where git left it, and the note
        // nobody could commit is still here to commit later.
        assert!(rebase.exists());
        let repo = Repository::open(&root).expect("their repository");
        assert_ne!(repo.state(), RepositoryState::Clean);
        assert_eq!(read(&held, "notes/b.md"), "two");
    }

    /// A merge in a container is the person's own unless this app began it, and
    /// finishing one is not something this app does to somebody's repository.
    #[test]
    fn a_merge_the_person_began_themselves_is_not_one_a_commit_finishes() {
        let (root, held) = project("their-merge");
        their_commit(&root, &["src/a.ts"], "The code");
        write(&held, "notes/a.md", "one");
        made(&held, "A note");

        their_git(&root, &["branch", "theirs"]);
        write(&root, "src/b.ts", "mine");
        their_commit(&root, &["src/b.ts"], "My code");
        their_git(&root, &["checkout", "theirs"]);
        write(&root, "src/c.ts", "theirs");
        their_commit(&root, &["src/c.ts"], "Their code");
        their_git(&root, &["checkout", DEFAULT_BRANCH]);
        their_git(&root, &["merge", "--no-commit", "--no-ff", "theirs"]);
        assert!(root.join(".git").join("MERGE_HEAD").exists());

        assert!(status(&held).expect("the status").merging.is_none());

        write(&held, "notes/b.md", "two");
        assert_eq!(
            commit(&held, &private_for(&held), "Another note")
                .unwrap_err()
                .said(),
            "This project is in the middle of something else. Finish or stop it where you work on the code, then try again."
        );
        // Nor one this app stops: what the person began is theirs to finish.
        assert_eq!(
            abandon_merge(&held).unwrap_err().said(),
            "This project is in the middle of something else. Finish or stop it where you work on the code, then try again."
        );
        assert!(root.join(".git").join("MERGE_HEAD").exists());
        assert_eq!(read(&root, "src/c.ts"), "theirs");
    }

    #[test]
    fn a_container_uses_the_projects_repository_and_commits_only_the_notes() {
        let (root, held) = project("container");
        their_commit(&root, &["src/a.ts"], "The code");
        write(&held, "notes/a.md", "why it is like this");
        write(&root, "src/b.ts", "two");

        // What a person is shown of the folder is the vault and nothing else.
        let standing = status(&held).expect("the status");
        assert_eq!(standing.untracked, vec![GRAPH_FILE, "notes/a.md"]);
        assert!(standing.changed.is_empty());

        made(&held, "The notes");
        assert!(!root.join(CONTAINER).join(".git").exists());
        assert_eq!(kept(&held), [GRAPH_FILE, "notes/a.md"]);

        // The person's own code is neither carried off nor left behind.
        let whole = read_at(&Opened::own(&root), "HEAD").expect("the whole commit");
        assert!(whole.contains_key("src/a.ts"));
        assert!(!whole.contains_key("src/b.ts"));
        assert_eq!(read(&root, "src/b.ts"), "two");
    }

    #[test]
    fn a_commit_of_the_notes_leaves_what_the_person_staged_where_it_was() {
        let (root, held) = project("staged");
        their_commit(&root, &["src/a.ts"], "The code");
        write(&root, "src/a.ts", "rewritten");
        let repo = Repository::open(&root).expect("their repository");
        let mut index = repo.index().expect("the index");
        index
            .add_path(Path::new("src/a.ts"))
            .expect("what they staged");
        index.write().expect("their index");

        write(&held, "notes/a.md", "why it is like this");
        made(&held, "The notes");

        let whole = read_at(&Opened::own(&root), "HEAD").expect("the whole commit");
        assert_eq!(
            whole.get("src/a.ts").map(String::as_str),
            Some(BASE64.encode("one").as_str())
        );
        // And it is still staged, for the person to commit themselves.
        let standing = status(&Opened::own(&root)).expect("the whole status");
        assert_eq!(standing.changed, vec!["src/a.ts"]);
    }

    #[test]
    fn the_versions_listed_are_the_ones_that_wrote_in_the_vault() {
        let (root, held) = project("listing");
        their_commit(&root, &["src/a.ts"], "The code");
        write(&held, "notes/a.md", "one");
        made(&held, "A note");
        write(&root, "src/b.ts", "two");
        their_commit(&root, &["src/b.ts"], "More code");

        let listed = log(&held, &private_for(&held), 10, None).expect("the versions");
        let said: Vec<&str> = listed
            .commits
            .iter()
            .map(|one| one.message.as_str())
            .collect();
        assert_eq!(said, ["A note"]);

        // The picture of the whole history is the folder's, so a branch is
        // never drawn at a commit that is not in it.
        let drawn = graph(&held, &private_for(&held), 10, None).expect("the picture");
        assert_eq!(drawn.commits.len(), 3);
    }

    #[test]
    fn what_the_folder_keeps_out_is_pinned_under_the_container() {
        let (root, held) = project("kept-out");
        beside_the_graph(&held);
        write(&held, "notes/a.md", "one");
        write(&root, "credentials.json", "the project's own");
        made(&held, "The notes");

        assert_eq!(kept(&held), [GRAPH_FILE, "notes/a.md"]);
        let repo = Repository::open(&root).expect("their repository");
        assert!(repo
            .status_should_ignore(Path::new(".sloppy/credentials.json"))
            .expect("what it keeps out"));
        assert!(repo
            .status_should_ignore(Path::new(".sloppy/notes/identity.json"))
            .expect("what it keeps out"));
        // What the person calls their own files is theirs, whatever we call
        // ours.
        assert!(!repo
            .status_should_ignore(Path::new("credentials.json"))
            .expect("what it keeps out"));
    }

    #[test]
    fn a_vault_nobody_opened_the_project_for_is_its_own_repository() {
        let root = scratch("unpicked");
        Repository::init(&root).expect("their repository");
        write(&root, "src/a.ts", "one");
        let inside = container(&root);
        // The folder somebody picked is the vault itself, so nothing above it
        // is even looked at.
        let alone = Opened::own(&inside);

        write(&alone, "notes/a.md", "one");
        made(&alone, "A graph");
        assert!(inside.join(".git").exists());
        assert_eq!(kept(&alone), [".gitignore", GRAPH_FILE, "notes/a.md"]);
        let whole = read_at(&Opened::own(&root), "HEAD");
        assert!(whole.is_err(), "the project has no commits of its own");
    }

    #[test]
    fn what_has_moved_under_a_note_is_answered_in_the_projects_own_paths() {
        let (root, held) = project("moved");
        let before = their_commit(&root, &["src/a.ts"], "The code");
        write(&root, "src/deep/c.ts", "three");
        write(&root, "docs/why.md", "because");
        their_commit(&root, &["src/deep/c.ts", "docs/why.md"], "More code");

        let asked = [
            "src/a.ts".to_owned(),
            "src/deep/c.ts".to_owned(),
            "src".to_owned(),
            "README.md".to_owned(),
            "src/a.ts".to_owned(),
        ];
        assert_eq!(
            changed_since(&held, &before, &asked).expect("what has moved"),
            ["src/deep/c.ts", "src"]
        );

        let now = head(&held).expect("the head").expect("a commit");
        assert!(changed_since(&held, &now, &asked)
            .expect("what has moved")
            .is_empty());
        assert_eq!(
            changed_since(&held, "0000000000000000000000000000000000000000", &asked)
                .unwrap_err()
                .said(),
            "That is not one of the states this graph has been in."
        );
    }

    #[test]
    fn a_merge_the_project_cannot_settle_inside_the_notes_is_refused_whole() {
        let (root, held) = project("two-versions");
        their_commit(&root, &["src/a.ts"], "The code");
        write(&held, "notes/a.md", "one");
        made(&held, "A note");
        branch(&held, "theirs").expect("a branch");

        switch_to(&held, "theirs").expect("onto it");
        write(&root, "src/a.ts", "their way");
        their_commit(&root, &["src/a.ts"], "Their code");
        switch_to(&held, DEFAULT_BRANCH).expect("back");
        write(&root, "src/a.ts", "my way");
        their_commit(&root, &["src/a.ts"], "My code");

        assert_eq!(
            merge_in(&held, &private_for(&held), "theirs")
                .unwrap_err()
                .said(),
            "These two versions of the project disagree about files outside your notes. Settle those where you work on the code, then try again."
        );
        // Refused before the folder was touched: nothing is half merged.
        assert_eq!(read(&root, "src/a.ts"), "my way");
        assert!(!root.join(".git").join("MERGE_HEAD").exists());
    }

    /// What the person is told has to be something they can go and do. In a
    /// project, settling the code is not one of the acts this app offers.
    #[test]
    fn an_act_refused_over_the_projects_own_files_says_where_they_are_settled() {
        let (root, held) = project("in-the-way");
        their_commit(&root, &["src/a.ts"], "The code");
        write(&held, "notes/a.md", "one");
        made(&held, "A note");
        branch(&held, "later").expect("a branch");

        write(&root, "src/a.ts", "rewritten");
        assert_eq!(
            switch_to(&held, "later").unwrap_err().said(),
            "This project has changes outside your notes. Keep or undo those where you write the code, then try again."
        );
        assert_eq!(
            merge_in(&held, &private_for(&held), "later")
                .unwrap_err()
                .said(),
            "This project has changes outside your notes. Keep or undo those where you write the code, then try again."
        );

        // A note written since the last version is settled here, so that is
        // what the person is asked for.
        their_commit(&root, &["src/a.ts"], "Their rewrite");
        write(&held, "notes/a.md", "two");
        assert_eq!(
            switch_to(&held, "later").unwrap_err().said(),
            "Commit what you have written here first, or put it back the way it was."
        );
    }

    /// The repository is the project's, and git reads its config for every
    /// commit the person makes on their own code.
    #[test]
    fn what_a_container_is_told_never_reaches_the_projects_own_config() {
        let (root, held) = project("told");
        let data = private_for(&held);
        their_commit(&root, &["src/a.ts"], "The code");

        set_git_user(
            &held,
            &GitUser {
                name: "Ada".to_owned(),
                email: "ada@example.com".to_owned(),
            },
        )
        .expect("who its versions are by");
        set_signing(
            &held,
            &data,
            &SigningConfig::Ssh {
                key: crate::signing::SshKey::Kept,
                public_key: None,
            },
        )
        .expect("how it signs");

        let theirs = Config::open(&root.join(".git").join("config")).expect("their config");
        for key in [
            "user.name",
            "user.email",
            "commit.gpgsign",
            "gpg.format",
            "user.signingkey",
            "gpg.ssh.allowedSignersFile",
        ] {
            assert!(
                theirs.get_string(key).is_err(),
                "the project's own config says {key}"
            );
        }

        // And the container still signs and names its own versions.
        write(&held, "notes/a.md", "one");
        let made = made(&held, "A note");
        assert_eq!(made.author, "Ada");
        assert!(made.signature.expect("a signature").verified);
        assert_eq!(
            git_user(&held).expect("the user").expect("somebody").name,
            "Ada"
        );
    }

    /// A vault of its own is the only folder in a repository, so what it is
    /// told is what the repository says.
    #[test]
    fn a_vault_of_its_own_is_still_told_in_the_repositorys_config() {
        let root = vault();
        set_git_user(
            &root,
            &GitUser {
                name: "Ada".to_owned(),
                email: "ada@example.com".to_owned(),
            },
        )
        .expect("who its versions are by");

        let held = Config::open(&root.join(".git").join("config")).expect("its config");
        assert_eq!(held.get_string("user.name").expect("a name"), "Ada");
    }

    /// Nobody has to tell Sloppy twice what git already knows about the person.
    #[test]
    fn a_container_nobody_has_named_takes_the_name_the_project_is_committed_under() {
        let (root, held) = project("their-name");
        {
            let repo = Repository::open(&root).expect("their repository");
            let mut config = repo
                .config()
                .expect("their config")
                .open_level(ConfigLevel::Local)
                .expect("their own");
            config.set_str("user.name", "Grace").expect("their name");
            config
                .set_str("user.email", "grace@example.com")
                .expect("their address");
        }

        assert_eq!(
            git_user(&held).expect("the user").expect("somebody").name,
            "Grace"
        );
        write(&held, "notes/a.md", "one");
        assert_eq!(made(&held, "A note").author, "Grace");
    }

    #[test]
    fn two_versions_of_a_note_in_a_container_are_settled_by_its_own_path() {
        let (root, held) = project("settling");
        their_commit(&root, &["src/a.ts"], "The code");
        write(&held, "notes/a.md", "one");
        made(&held, "A note");
        branch(&held, "theirs").expect("a branch");

        switch_to(&held, "theirs").expect("onto it");
        write(&held, "notes/a.md", "their way");
        made(&held, "Their note");
        switch_to(&held, DEFAULT_BRANCH).expect("back");
        write(&held, "notes/a.md", "my way");
        made(&held, "My note");

        let two = merge_in(&held, &private_for(&held), "theirs").expect("the merge");
        assert_eq!(
            two.conflicts.as_deref(),
            Some(["notes/a.md".to_owned()].as_slice())
        );
        assert_eq!(read(&held, "notes/a.md"), "my way");
        settle(&held, "notes/a.md", ConflictSide::Theirs).expect("their version");
        assert_eq!(read(&held, "notes/a.md"), "their way");
        made(&held, "Merge theirs");
        assert_eq!(kept(&held), [GRAPH_FILE, "notes/a.md"]);

        // A merge this app began and settled leaves the repository holding
        // nothing about it, and the folder moves again.
        let repo = Repository::open(&root).expect("their repository");
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert!(!repo.commondir().join(MERGING).exists());
        switch_to(&held, "theirs").expect("onto it");
    }

    #[test]
    fn a_file_outside_the_folder_is_not_one_a_conflict_can_be_settled_over() {
        let root = vault();
        let folders = Folders::new(scratch("data").to_path_buf()).expect("the private data");
        folders
            .pick(root.to_path_buf())
            .expect("picking the folder");

        assert!(matches!(
            folders.within(&root.to_string_lossy(), "../elsewhere.md"),
            Err(FileError::Outside)
        ));
    }
}
