//! The commands behind `History` in `@sloppy/local`, which declares every act
//! and what its answer means — docs/ARCHITECTURE.md § "The vault's history".
//!
//! Each one opens the repository at the folder that was picked and never one
//! above it, so a graph kept inside somebody else's repository is still its own
//! history, and a folder that is not a repository yet becomes one.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chrono::{DateTime, SecondsFormat};
use git2::{
    build::CheckoutBuilder, BranchType, Config, ConfigLevel, ErrorCode, Index, IndexAddOption,
    ObjectType, Oid, Repository, RepositoryInitOptions, RepositoryOpenFlags, Signature, Sort,
    StatusOptions, TreeWalkMode, TreeWalkResult,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::signing::{Signed, SigningConfig, Trust};
use crate::vault::{FileError, Folders};

/// What a folder the app makes a repository is on.
const DEFAULT_BRANCH: &str = "main";

/// What `graph.json` is called — `GRAPH_FILE` in `@sloppy/vault`.
const GRAPH_FILE: &str = "graph.json";

/// Where a commit's author has no address of their own. Git will not record a
/// name without one.
const NO_ADDRESS: &str = "sloppy@localhost";

/// What the folder is told not to keep — docs/ARCHITECTURE.md § "The vault's
/// history".
const IGNORED: [&str; 10] = [
    "identity.json",
    "identity.key",
    "folders.json",
    "vaults.json",
    "git.json",
    "credentials.json",
    "signing.key",
    "signing.key.pub",
    "/.sloppy/bin.json",
    "/.sloppy/bin/",
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

fn mid_merge() -> HistoryError {
    HistoryError::new("Finish the merge you are in the middle of first.")
}

fn uncommitted() -> HistoryError {
    HistoryError::new("Commit what you have written here first, or put it back the way it was.")
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
#[derive(Debug, Deserialize, Serialize)]
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

/// The repository the folder is, made into one where it is not one yet, and
/// keeping none of `IGNORED` either way.
pub(crate) fn at(root: &Path) -> Result<Repository, HistoryError> {
    let ceiling: [&Path; 0] = [];
    let repo = match Repository::open_ext(root, RepositoryOpenFlags::NO_SEARCH, ceiling) {
        Ok(repo) => repo,
        Err(error) if error.code() == ErrorCode::NotFound => start(root)?,
        Err(error) => return Err(error.into()),
    };
    keep_out(&repo)?;
    Ok(repo)
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
pub(crate) fn keep_out(repo: &Repository) -> Result<(), HistoryError> {
    let exclude = repo.commondir().join("info").join("exclude");
    let held = fs::read_to_string(&exclude).unwrap_or_default();
    let missing: Vec<&str> = IGNORED
        .iter()
        .copied()
        .filter(|line| !held.lines().any(|one| one.trim() == *line))
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

/// Whether a path in the index is one of `IGNORED`, matched the way git matches
/// the lines these are written as: a bare name wherever it is, a leading slash
/// pinned to the folder, a trailing one covering everything under it.
fn kept_out(path: &str) -> bool {
    IGNORED.iter().any(|line| match line.strip_prefix('/') {
        Some(pinned) => match pinned.strip_suffix('/') {
            Some(folder) => path.starts_with(&format!("{folder}/")),
            None => path == pinned,
        },
        None => path.rsplit('/').next() == Some(*line),
    })
}

/// What an exclude cannot do: a folder that was a repository before the app
/// opened it can already be tracking these, and nothing untracks a file by
/// ignoring it. The files stay where they are; only the history lets go.
fn let_go(index: &mut Index) -> Result<(), HistoryError> {
    let held: Vec<PathBuf> = index
        .iter()
        .filter_map(|entry| String::from_utf8(entry.path).ok())
        .filter(|path| kept_out(path))
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

/// Who a commit is by where nothing in git config says: what the graph says
/// its owner is called, and the identity it belongs to.
fn owner(root: &Path) -> (String, String) {
    let held = fs::read(root.join(GRAPH_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    // Git refuses a name or an address with an angle bracket or a newline in
    // it, and both of these are somebody's own words.
    let said = |key: &str| {
        held.as_ref()
            .and_then(|held| held.get(key))
            .and_then(|held| held.as_str())
            .map(str::trim)
            .filter(|held| !held.is_empty() && !held.contains(['<', '>', '\n']))
            .map(str::to_owned)
    };
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

/// Who the commits made here are by, read the way git reads it: this folder's
/// own config, then the person's own. Nothing where neither says.
pub fn git_user(root: &Path) -> Result<Option<GitUser>, HistoryError> {
    Ok(named(&at(root)?).map(|(name, email)| GitUser { name, email }))
}

fn named(repo: &Repository) -> Option<(String, String)> {
    let config = repo.config().ok()?;
    Some((said(&config, "user.name")?, said(&config, "user.email")?))
}

pub fn set_git_user(root: &Path, user: &GitUser) -> Result<(), HistoryError> {
    let repo = at(root)?;
    let mut config = repo.config()?.open_level(ConfigLevel::Local)?;
    config
        .set_str("user.name", user.name.trim())
        .and_then(|()| config.set_str("user.email", user.email.trim()))
        .map_err(|_| {
            HistoryError::new("That will not work as a name and an address. Try another.")
        })?;
    Ok(())
}

fn signature<'a>(repo: &Repository, root: &Path) -> Result<Signature<'a>, HistoryError> {
    let (name, address) = named(repo).unwrap_or_else(|| owner(root));
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

fn standing(repo: &Repository) -> Result<Status, HistoryError> {
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
    Ok(Status {
        changed,
        untracked,
        branch,
        ahead,
        behind,
        upstream,
    })
}

pub fn status(root: &Path) -> Result<Status, HistoryError> {
    standing(&at(root)?)
}

pub fn log(
    root: &Path,
    data: &Path,
    limit: i64,
    cursor: Option<&str>,
) -> Result<CommitPage, HistoryError> {
    let repo = at(root)?;
    let trust = Trust::of(root, data);
    let limit = limit.max(0) as usize;
    if head_commit(&repo)?.is_none() {
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
        commits.push(view(&repo, &repo.find_commit(id)?, &trust));
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
pub fn graph(
    root: &Path,
    data: &Path,
    limit: i64,
    cursor: Option<&str>,
) -> Result<CommitGraphPage, HistoryError> {
    let repo = at(root)?;
    let trust = Trust::of(root, data);
    let limit = limit.max(0) as usize;
    let named = names_at(&repo)?;

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
            commit: view(&repo, &repo.find_commit(id)?, &trust),
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
            held.entry(head).or_default().push(name.to_owned());
        }
    }
    for names in held.values_mut() {
        names.sort();
    }
    Ok(held)
}

pub fn commit(root: &Path, data: &Path, message: &str) -> Result<Option<Commit>, HistoryError> {
    let mut repo = at(root)?;
    let with = merging(&mut repo)?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(HistoryError::new(
            "Some of these are still here in two versions. Choose one of each and try again.",
        ));
    }
    let_go(&mut index)?;
    index.update_all(["*"], None)?;
    index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let written = index.write_tree()?;
    let head = head_commit(&repo)?;
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
    let made = record(&repo, root, data, message, &tree, &parents)?;
    repo.cleanup_state()?;
    let held = view(&repo, &repo.find_commit(made)?, &Trust::of(root, data));
    Ok(Some(held))
}

/// One commit, carrying a signature where this folder signs. A signed one is
/// written straight to the branch, because signing it is what makes the commit
/// rather than something done to one that is already there.
fn record(
    repo: &Repository,
    root: &Path,
    data: &Path,
    message: &str,
    tree: &git2::Tree<'_>,
    parents: &[&git2::Commit<'_>],
) -> Result<Oid, HistoryError> {
    let by = signature(repo, root)?;
    let held = repo.commit_create_buffer(&by, &by, message, tree, parents)?;
    let content = std::str::from_utf8(&held)
        .map_err(|_| HistoryError::new("That did not work. Try again."))?;
    let Some(armour) = crate::signing::sign(repo, data, content)? else {
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

pub fn branches(root: &Path) -> Result<Vec<Branch>, HistoryError> {
    let repo = at(root)?;
    let mut held = Vec::new();
    for found in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = found?;
        let (Some(name), Some(head)) = (branch.name()?, branch.get().target()) else {
            continue;
        };
        let mut one = Branch::here(name, head, branch.is_head());
        if let Some((ahead, behind, upstream)) = against(&repo, name) {
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

pub fn branch(root: &Path, name: &str) -> Result<Branch, HistoryError> {
    let repo = at(root)?;
    if repo.find_branch(name, BranchType::Local).is_ok() {
        return Err(already_called(name));
    }
    let Some(head) = head_commit(&repo)? else {
        return Err(HistoryError::new(
            "There is nothing here to branch off yet. Commit what is in this folder first.",
        ));
    };
    let made = repo
        .branch(name, &head, false)
        .map_err(|_| HistoryError::new(format!("{name} will not work as a name. Try another.")))?;
    Ok(Branch::here(name, head.id(), made.is_head()))
}

/// A branch at a commit somewhere back in the history. The folder stays where
/// it is.
pub fn branch_at(root: &Path, name: &str, commit: &str) -> Result<Branch, HistoryError> {
    let repo = at(root)?;
    if repo.find_branch(name, BranchType::Local).is_ok() {
        return Err(already_called(name));
    }
    let held = repo
        .revparse_single(commit)
        .and_then(|found| found.peel_to_commit())
        .map_err(|_| not_here())?;
    let made = repo
        .branch(name, &held, false)
        .map_err(|_| HistoryError::new(format!("{name} will not work as a name. Try another.")))?;
    Ok(Branch::here(name, held.id(), made.is_head()))
}

pub fn delete_branch(root: &Path, name: &str) -> Result<(), HistoryError> {
    let repo = at(root)?;
    let mut held = repo
        .find_branch(name, BranchType::Local)
        .map_err(|_| no_branch(name))?;
    if held.is_head() {
        return Err(HistoryError::new("That is the one you are working on."));
    }
    held.delete()?;
    Ok(())
}

pub fn signing(root: &Path, data: &Path) -> Result<SigningConfig, HistoryError> {
    crate::signing::read(&at(root)?, data)
}

pub fn set_signing(root: &Path, data: &Path, signing: &SigningConfig) -> Result<(), HistoryError> {
    crate::signing::write(&at(root)?, root, data, signing)
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

fn kept_out_in(tree: &git2::Tree<'_>, held: &mut BTreeSet<String>) -> Result<(), HistoryError> {
    tree.walk(TreeWalkMode::PreOrder, |folder, entry| {
        if entry.kind() == Some(ObjectType::Blob) {
            if let Some(name) = entry.name() {
                let path = format!("{folder}{name}");
                if kept_out(&path) {
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
fn kept_out_of(repo: &Repository, onto: Oid) -> Result<BTreeSet<String>, HistoryError> {
    let mut held = BTreeSet::new();
    kept_out_in(&repo.find_commit(onto)?.tree()?, &mut held)?;
    if let Some(at) = head_commit(repo)? {
        kept_out_in(&at.tree()?, &mut held)?;
    }
    for entry in repo.index()?.iter() {
        if let Ok(path) = String::from_utf8(entry.path) {
            if kept_out(&path) {
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
fn set_aside(repo: &Repository, root: &Path, onto: Oid) -> Result<Vec<Aside>, HistoryError> {
    let mut held = Vec::new();
    for path in kept_out_of(repo, onto)? {
        let file = root.join(&path);
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
fn put_back(repo: &Repository, root: &Path, held: Vec<Aside>) -> Result<(), HistoryError> {
    if held.is_empty() {
        return Ok(());
    }
    for (path, was) in held {
        let file = root.join(&path);
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
    let mut index = repo.index()?;
    let_go(&mut index)?;
    index.write()?;
    Ok(())
}

/// A file the folder holds that the state being laid down holds byte for byte
/// is not a file a checkout writes over — the bytes do not change. Only one the
/// history is not already keeping is let go of this way, so nothing a checkout
/// would leave alone is lost.
fn already_the_same(repo: &Repository, root: &Path, onto: Oid) -> Result<(), HistoryError> {
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
            if tracked.contains(&path) {
                return TreeWalkResult::Ok;
            }
            match (fs::read(root.join(&path)), repo.find_blob(entry.id())) {
                (Ok(here), Ok(blob)) if here == blob.content() => same.push(path),
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
    for path in same {
        fs::remove_file(root.join(path))?;
    }
    Ok(())
}

pub(crate) fn lay(repo: &Repository, root: &Path, onto: Oid) -> Result<(), HistoryError> {
    let tree = repo.find_object(onto, Some(ObjectType::Commit))?;
    already_the_same(repo, root, onto)?;
    let held = set_aside(repo, root, onto)?;
    let mut how = CheckoutBuilder::new();
    how.safe();
    let laid = repo
        .checkout_tree(&tree, Some(&mut how))
        .map_err(in_the_way);
    put_back(repo, root, held)?;
    laid
}

/// The commit a local branch is at, and nothing where there is no such branch.
fn branch_head(repo: &Repository, name: &str) -> Option<Oid> {
    repo.find_branch(name, BranchType::Local)
        .ok()
        .and_then(|branch| branch.get().target())
}

pub fn switch_to(root: &Path, name: &str) -> Result<(), HistoryError> {
    let mut repo = at(root)?;
    let Some(head) = branch_head(&repo, name) else {
        return Err(no_branch(name));
    };
    if merging(&mut repo)?.is_some() {
        return Err(mid_merge());
    }
    let held = standing(&repo)?;
    if held.branch.as_deref() == Some(name) {
        return Ok(());
    }
    if !held.changed.is_empty() {
        return Err(uncommitted());
    }
    lay(&repo, root, head)?;
    repo.set_head(&format!("refs/heads/{name}"))?;
    Ok(())
}

/// Every path a merge left in two versions, with this branch's own version of
/// each one written into the folder — docs/ARCHITECTURE.md § "The vault's
/// history".
fn one_version_each(
    repo: &Repository,
    root: &Path,
    index: &Index,
) -> Result<Vec<String>, HistoryError> {
    let mut held = Vec::new();
    for found in index.conflicts()? {
        let found = found?;
        let spelled = found
            .our
            .as_ref()
            .or(found.their.as_ref())
            .or(found.ancestor.as_ref())
            .and_then(|entry| String::from_utf8(entry.path.clone()).ok());
        let Some(path) = spelled else { continue };
        let file = root.join(&path);
        match &found.our {
            Some(ours) => {
                if let Some(folder) = file.parent() {
                    fs::create_dir_all(folder)?;
                }
                fs::write(&file, repo.find_blob(ours.id)?.content())?;
            }
            None => match fs::remove_file(&file) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                other => other?,
            },
        }
        held.push(path);
    }
    held.sort();
    Ok(held)
}

pub fn merge_in(root: &Path, data: &Path, name: &str) -> Result<Merged, HistoryError> {
    let mut repo = at(root)?;
    let Some(head) = branch_head(&repo, name) else {
        return Err(no_branch(name));
    };
    if on(&repo)? == Some(name.to_owned()) {
        return Err(HistoryError::new("That is the one you are working on."));
    }
    merge_commit(&mut repo, root, data, head, name)
}

/// Take a commit into the one the folder is on, whether it is a branch here or
/// what a remote had when this folder last heard — `called` is what the commit
/// a settled merge makes says it took in.
pub(crate) fn merge_commit(
    repo: &mut Repository,
    root: &Path,
    data: &Path,
    head: Oid,
    name: &str,
) -> Result<Merged, HistoryError> {
    if merging(repo)?.is_some() {
        return Err(mid_merge());
    }
    let repo = &*repo;
    let theirs = repo.find_annotated_commit(head)?;
    let held = standing(repo)?;
    let Some(mine) = head_commit(repo)? else {
        return Err(HistoryError::new(
            "There is nothing here to merge into yet. Commit what is in this folder first.",
        ));
    };
    if !held.changed.is_empty() {
        return Err(uncommitted());
    }
    let Some(on) = held.branch else {
        return Err(HistoryError::new(
            "This folder is not on a branch, so there is nowhere to merge into.",
        ));
    };

    let (reading, _) = repo.merge_analysis(&[&theirs])?;
    if reading.is_up_to_date() {
        return Ok(Merged::whole());
    }
    if reading.is_fast_forward() {
        lay(repo, root, theirs.id())?;
        repo.reference(
            &format!("refs/heads/{on}"),
            theirs.id(),
            true,
            &format!("merge {name}"),
        )?;
        return Ok(Merged::whole());
    }

    let held = set_aside(repo, root, theirs.id())?;
    let mut how = CheckoutBuilder::new();
    how.safe();
    let taken = repo
        .merge(&[&theirs], None, Some(&mut how))
        .map_err(in_the_way);
    put_back(repo, root, held)?;
    taken?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Ok(Merged::in_two_versions(one_version_each(
            repo, root, &index,
        )?));
    }
    let tree = repo.find_tree(index.write_tree()?)?;
    index.write()?;
    let taken = repo.find_commit(theirs.id())?;
    record(
        repo,
        root,
        data,
        &format!("Merge {name}"),
        &tree,
        &[&mine, &taken],
    )?;
    repo.cleanup_state()?;
    Ok(Merged::whole())
}

pub fn settle(root: &Path, path: &str, side: ConflictSide) -> Result<(), HistoryError> {
    let repo = at(root)?;
    let mut index = repo.index()?;
    let held = index
        .conflicts()?
        .flatten()
        .find(|found| {
            [&found.our, &found.their, &found.ancestor]
                .iter()
                .filter_map(|entry| entry.as_ref())
                .any(|entry| entry.path == path.as_bytes())
        })
        .ok_or_else(|| HistoryError::new("That is not one of the ones in two versions."))?;
    let chosen = match side {
        ConflictSide::Mine => held.our,
        ConflictSide::Theirs => held.their,
    };
    let file = root.join(path);
    match chosen {
        Some(entry) => {
            if let Some(folder) = file.parent() {
                fs::create_dir_all(folder)?;
            }
            fs::write(&file, repo.find_blob(entry.id)?.content())?;
            index.remove_path(Path::new(path))?;
            index.add_path(Path::new(path))?;
        }
        None => {
            match fs::remove_file(&file) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                other => other?,
            }
            index.remove_path(Path::new(path))?;
        }
    }
    index.write()?;
    Ok(())
}

pub fn read_at(root: &Path, commit: &str) -> Result<BTreeMap<String, String>, HistoryError> {
    let repo = at(root)?;
    let held = repo
        .revparse_single(commit)
        .and_then(|found| found.peel_to_commit())
        .map_err(|_| not_here())?;
    let mut vault = BTreeMap::new();
    let mut failed = None;
    held.tree()?.walk(TreeWalkMode::PreOrder, |folder, entry| {
        if entry.kind() != Some(ObjectType::Blob) {
            return TreeWalkResult::Ok;
        }
        let Some(name) = entry.name() else {
            return TreeWalkResult::Ok;
        };
        match repo.find_blob(entry.id()) {
            Ok(blob) => {
                vault.insert(format!("{folder}{name}"), BASE64.encode(blob.content()));
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
        None => Ok(vault),
    }
}

pub fn head(root: &Path) -> Result<Option<String>, HistoryError> {
    Ok(head_commit(&at(root)?)?.map(|held| held.id().to_string()))
}

fn opened(folders: &State<'_, Folders>, root: &str) -> Result<PathBuf, HistoryError> {
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

    pub(crate) fn scratch(name: &str) -> PathBuf {
        on_its_own();
        let at = std::env::temp_dir().join(format!(
            "sloppy-history-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&at);
        fs::create_dir_all(&at).expect("a scratch folder");
        crate::vault::settled(&at)
    }

    /// A folder with a graph in it, as the app writes one.
    pub(crate) fn vault() -> PathBuf {
        let root = scratch("vault");
        write(
            &root,
            GRAPH_FILE,
            r#"{"format":1,"graph":"G","name":"Notes","owner":"did:syr:zOwner","owner_name":"Ada"}"#,
        );
        root
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

    pub(crate) fn made(root: &Path, message: &str) -> Commit {
        commit(root, &private_for(root), message)
            .expect("the commit")
            .expect("a commit")
    }

    /// What a folder holds beside the graph that no commit of it may carry.
    pub(crate) fn beside_the_graph(root: &Path) {
        write(root, "identity.json", "{}");
        write(root, "identity.key", "a seed");
        write(root, "folders.json", "[]");
        write(root, "vaults.json", "[]");
        write(root, "git.json", "{}");
        write(root, "credentials.json", "[]");
        write(root, "signing.key", "a key");
        write(root, ".sloppy/bin.json", "{}");
        write(root, ".sloppy/bin/note.md", "thrown away");
    }

    fn kept(root: &Path) -> Vec<String> {
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
        let root = around.join("graph");
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
        let folders = Folders::new(scratch("data")).expect("the private data");
        folders.pick(root.clone()).expect("picking the folder");
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
        assert_eq!(
            ask("history_signing", serde_json::json!({ "root": spelled }))
                .expect("how it signs")
                .deserialize::<serde_json::Value>()
                .expect("what the page is handed"),
            serde_json::json!({ "kind": "ssh", "key": { "kind": "kept" } })
        );

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
            .pick(arriving.clone())
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
            },
        )
        .expect("the choice");
        assert!(matches!(
            signing(&root, &data).expect("how it signs"),
            SigningConfig::Ssh {
                key: crate::signing::SshKey::Kept
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
            },
        )
        .expect("the choice");
        let signed = made(&root, "A graph");

        let repo = at(&root).expect("the repository");
        let (armour, content) = repo
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

    #[test]
    fn a_file_outside_the_folder_is_not_one_a_conflict_can_be_settled_over() {
        let root = vault();
        let folders = Folders::new(scratch("data")).expect("the private data");
        folders.pick(root.clone()).expect("picking the folder");

        assert!(matches!(
            folders.within(&root.to_string_lossy(), "../elsewhere.md"),
            Err(FileError::Outside)
        ));
    }
}
