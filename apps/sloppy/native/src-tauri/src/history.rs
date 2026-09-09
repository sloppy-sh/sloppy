//! The commands behind `History` in `@sloppy/local`, which declares every act
//! and what its answer means — docs/ARCHITECTURE.md § "The vault's history".
//!
//! Each one opens the repository at the folder that was picked and never one
//! above it, so a graph kept inside somebody else's repository is still its own
//! history, and a folder that is not a repository yet becomes one.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chrono::{DateTime, SecondsFormat};
use git2::{
    build::CheckoutBuilder, BranchType, ErrorCode, Index, IndexAddOption, ObjectType, Oid,
    Repository, RepositoryInitOptions, RepositoryOpenFlags, Signature, Sort, StatusOptions,
    TreeWalkMode, TreeWalkResult,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::vault::{FileError, Folders};

/// What a folder the app makes a repository is on.
const DEFAULT_BRANCH: &str = "main";

/// What `graph.json` is called — `GRAPH_FILE` in `@sloppy/vault`.
const GRAPH_FILE: &str = "graph.json";

/// Where a commit's author has no address of their own. Git will not record a
/// name without one.
const NO_ADDRESS: &str = "sloppy@localhost";

/// What the folder is told not to keep, written once when the app makes it a
/// repository. The identity this device writes under is the device's and not
/// the graph's, and the bin's ledger of spent addresses only ever grows, so no
/// older state of the folder may hand one of those addresses back.
/// docs/ARCHITECTURE.md § "The vault's history".
const IGNORED: &str = "identity.json
identity.key
folders.json
/.sloppy/bin.json
/.sloppy/bin/
";

/// An act the history would not take. What a person is told is the whole of it,
/// exactly as `HistoryError` in `@sloppy/local` promises.
#[derive(Debug)]
pub struct HistoryError(String);

impl HistoryError {
    fn new(said: impl Into<String>) -> Self {
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

fn uncommitted(changed: &[String]) -> HistoryError {
    HistoryError::new(format!(
        "There is writing here that is not committed: {}. Commit it first, or put it back the way it was.",
        named(changed)
    ))
}

/// The paths a person is shown in a sentence: three of them, and a count for
/// whatever is left.
fn named(paths: &[String]) -> String {
    const SHOWN: usize = 3;
    let mut said: Vec<String> = paths.iter().take(SHOWN).cloned().collect();
    if paths.len() > SHOWN {
        said.push(format!("{} more", paths.len() - SHOWN));
    }
    match said.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    }
}

/// `Commit` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct Commit {
    id: String,
    message: String,
    author: String,
    at: String,
    parents: Vec<String>,
}

/// `CommitPage` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct CommitPage {
    commits: Vec<Commit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
}

/// `Branch` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct Branch {
    name: String,
    head: String,
    current: bool,
}

/// `HistoryStatus` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct Status {
    changed: Vec<String>,
    untracked: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    ahead: usize,
}

/// `MergeResult` in `@sloppy/local`: `conflicts` is there exactly where nothing
/// was merged.
#[derive(Debug, Serialize)]
pub struct Merged {
    merged: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflicts: Option<Vec<String>>,
}

impl Merged {
    fn whole() -> Self {
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

/// The repository the folder is, made into one where it is not one yet.
fn at(root: &Path) -> Result<Repository, HistoryError> {
    let ceiling: [&Path; 0] = [];
    match Repository::open_ext(root, RepositoryOpenFlags::NO_SEARCH, ceiling) {
        Ok(repo) => Ok(repo),
        Err(error) if error.code() == ErrorCode::NotFound => start(root),
        Err(error) => Err(error.into()),
    }
}

fn start(root: &Path) -> Result<Repository, HistoryError> {
    let mut how = RepositoryInitOptions::new();
    how.initial_head(DEFAULT_BRANCH);
    let repo = Repository::init_opts(root, &how)?;
    let ignore = root.join(".gitignore");
    if !ignore.exists() {
        fs::write(&ignore, IGNORED)?;
    }
    Ok(repo)
}

fn unborn(error: &git2::Error) -> bool {
    matches!(error.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound)
}

fn head_commit(repo: &Repository) -> Result<Option<git2::Commit<'_>>, HistoryError> {
    match repo.head() {
        Ok(head) => Ok(Some(head.peel_to_commit()?)),
        Err(error) if unborn(&error) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// The branch the folder is on, and nothing where it is on a commit of its own.
/// A repository with no commits in it yet is still on the branch its first one
/// will be.
fn on(repo: &Repository) -> Result<Option<String>, HistoryError> {
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

/// How far the branch is past whatever it tracks. Nobody sets one of those up
/// here, so this is a person's own git answering about their own remote.
fn ahead(repo: &Repository, branch: Option<&str>) -> usize {
    let Some(name) = branch else { return 0 };
    let Ok(branch) = repo.find_branch(name, BranchType::Local) else {
        return 0;
    };
    let Ok(upstream) = branch.upstream() else {
        return 0;
    };
    match (branch.get().target(), upstream.get().target()) {
        (Some(mine), Some(theirs)) => repo
            .graph_ahead_behind(mine, theirs)
            .map_or(0, |(ahead, _)| ahead),
        _ => 0,
    }
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

/// Who a commit is by: what the graph says its owner is called, and the
/// identity it belongs to where they have not said.
fn author(root: &Path) -> (String, String) {
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

fn signature(root: &Path) -> Result<Signature<'static>, HistoryError> {
    let (name, address) = author(root);
    Ok(Signature::now(&name, &address)?)
}

/// A commit's time, at the width `Timestamp` in `@sloppy/types` is pinned to.
fn moment(seconds: i64) -> String {
    DateTime::from_timestamp(seconds, 0)
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn view(commit: &git2::Commit<'_>) -> Commit {
    let by = commit.author();
    Commit {
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
        if entry.status() == git2::Status::WT_NEW {
            untracked.push(path.to_owned());
        } else if !entry.status().is_empty() {
            changed.push(path.to_owned());
        }
    }
    changed.sort();
    untracked.sort();
    let branch = on(repo)?;
    let ahead = ahead(repo, branch.as_deref());
    Ok(Status {
        changed,
        untracked,
        branch,
        ahead,
    })
}

pub fn status(root: &Path) -> Result<Status, HistoryError> {
    standing(&at(root)?)
}

pub fn log(root: &Path, limit: i64, cursor: Option<&str>) -> Result<CommitPage, HistoryError> {
    let repo = at(root)?;
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
        commits.push(view(&repo.find_commit(id)?));
    }
    if !reached {
        return Err(not_here());
    }
    Ok(CommitPage {
        commits,
        cursor: next,
    })
}

pub fn commit(root: &Path, message: &str) -> Result<Option<Commit>, HistoryError> {
    let mut repo = at(root)?;
    let with = merging(&mut repo)?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Err(HistoryError::new(
            "Some of these are still here in two versions. Choose one of each and try again.",
        ));
    }
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
    let by = signature(root)?;
    let made = repo.commit(Some("HEAD"), &by, &by, message, &tree, &parents)?;
    repo.cleanup_state()?;
    let held = view(&repo.find_commit(made)?);
    Ok(Some(held))
}

pub fn branches(root: &Path) -> Result<Vec<Branch>, HistoryError> {
    let repo = at(root)?;
    let mut held = Vec::new();
    for found in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = found?;
        let (Some(name), Some(head)) = (branch.name()?, branch.get().target()) else {
            continue;
        };
        held.push(Branch {
            name: name.to_owned(),
            head: head.to_string(),
            current: branch.is_head(),
        });
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
    Ok(Branch {
        name: name.to_owned(),
        head: head.id().to_string(),
        current: made.is_head(),
    })
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

fn lay(repo: &Repository, at: Oid) -> Result<(), HistoryError> {
    let tree = repo.find_object(at, Some(ObjectType::Commit))?;
    let mut how = CheckoutBuilder::new();
    how.safe();
    repo.checkout_tree(&tree, Some(&mut how))
        .map_err(in_the_way)
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
        return Err(uncommitted(&held.changed));
    }
    lay(&repo, head)?;
    repo.set_head(&format!("refs/heads/{name}"))?;
    Ok(())
}

/// Every path a merge left in two versions, with this branch's own version of
/// each one in the folder. No note is ever left holding both, because one that
/// does reads as neither — docs/ARCHITECTURE.md § "The vault's history".
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

pub fn merge_in(root: &Path, name: &str) -> Result<Merged, HistoryError> {
    let mut repo = at(root)?;
    let Some(head) = branch_head(&repo, name) else {
        return Err(no_branch(name));
    };
    if merging(&mut repo)?.is_some() {
        return Err(mid_merge());
    }
    let theirs = repo.find_annotated_commit(head)?;
    let held = standing(&repo)?;
    if held.branch.as_deref() == Some(name) {
        return Err(HistoryError::new("That is the one you are working on."));
    }
    let Some(mine) = head_commit(&repo)? else {
        return Err(HistoryError::new(
            "There is nothing here to merge into yet. Commit what is in this folder first.",
        ));
    };
    if !held.changed.is_empty() {
        return Err(uncommitted(&held.changed));
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
        lay(&repo, theirs.id())?;
        repo.reference(
            &format!("refs/heads/{on}"),
            theirs.id(),
            true,
            &format!("merge {name}"),
        )?;
        return Ok(Merged::whole());
    }

    let mut how = CheckoutBuilder::new();
    how.safe();
    repo.merge(&[&theirs], None, Some(&mut how))
        .map_err(in_the_way)?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Ok(Merged::in_two_versions(one_version_each(
            &repo, root, &index,
        )?));
    }
    let tree = repo.find_tree(index.write_tree()?)?;
    index.write()?;
    let taken = repo.find_commit(theirs.id())?;
    let by = signature(root)?;
    repo.commit(
        Some("HEAD"),
        &by,
        &by,
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

/// The folder a history command was handed, refused where nobody opened it.
fn opened(folders: &State<'_, Folders>, root: &str) -> Result<PathBuf, HistoryError> {
    Ok(folders.opened(root)?)
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
    log(&opened(&folders, &root)?, limit, cursor.as_deref())
}

#[tauri::command]
pub fn history_commit(
    folders: State<'_, Folders>,
    root: String,
    message: String,
) -> Result<Option<Commit>, HistoryError> {
    commit(&opened(&folders, &root)?, &message)
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
    merge_in(&opened(&folders, &root)?, &name)
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
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT: AtomicU32 = AtomicU32::new(0);

    fn scratch(name: &str) -> PathBuf {
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
    fn vault() -> PathBuf {
        let root = scratch("vault");
        write(
            &root,
            GRAPH_FILE,
            r#"{"format":1,"graph":"G","name":"Notes","owner":"did:syr:zOwner","owner_name":"Ada"}"#,
        );
        root
    }

    fn write(root: &Path, path: &str, held: &str) {
        let at = root.join(path);
        if let Some(folder) = at.parent() {
            fs::create_dir_all(folder).expect("the folder");
        }
        fs::write(at, held).expect("the file");
    }

    fn read(root: &Path, path: &str) -> String {
        fs::read_to_string(root.join(path)).expect("the file")
    }

    fn made(root: &Path, message: &str) -> Commit {
        commit(root, message)
            .expect("the commit")
            .expect("a commit")
    }

    #[test]
    fn a_folder_that_is_not_a_repository_becomes_one_that_keeps_no_identity() {
        let root = vault();
        write(&root, "identity.json", "{}");
        write(&root, "identity.key", "a seed");
        write(&root, "folders.json", "[]");
        write(&root, ".sloppy/bin.json", "{}");
        write(&root, ".sloppy/bin/note.md", "thrown away");
        write(&root, "notes/a.md", "one");

        let held = status(&root).expect("the status");
        assert_eq!(held.branch.as_deref(), Some(DEFAULT_BRANCH));
        assert_eq!(held.ahead, 0);
        assert!(held.changed.is_empty());
        assert_eq!(held.untracked, vec![".gitignore", GRAPH_FILE, "notes/a.md"]);

        made(&root, "A graph");
        let vault = read_at(&root, "HEAD").expect("the commit's vault");
        let mut kept: Vec<&String> = vault.keys().collect();
        kept.sort();
        assert_eq!(kept, vec![".gitignore", GRAPH_FILE, "notes/a.md"]);
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
        assert!(commit(&root, "Again").expect("the commit").is_none());

        write(&root, "notes/a.md", "one");
        assert!(commit(&root, "A note").expect("the commit").is_some());
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

        let page = log(&root, 2, None).expect("the first page");
        assert_eq!(
            page.commits
                .iter()
                .map(|one| one.id.clone())
                .collect::<Vec<_>>(),
            ids[..2]
        );
        assert_eq!(page.cursor.as_deref(), Some(ids[2].as_str()));

        let rest = log(&root, 2, page.cursor.as_deref()).expect("the rest");
        assert_eq!(
            rest.commits
                .iter()
                .map(|one| one.id.clone())
                .collect::<Vec<_>>(),
            ids[2..]
        );
        assert!(rest.cursor.is_none());

        assert_eq!(
            log(&root, 2, Some("0123456789abcdef0123456789abcdef01234567"))
                .unwrap_err()
                .said(),
            "That is not one of the states this graph has been in."
        );
    }

    #[test]
    fn a_listing_of_a_folder_with_no_commits_in_it_is_empty() {
        let root = vault();
        assert!(log(&root, 10, None)
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
    fn a_switch_that_would_lose_writing_says_what_would_be_lost() {
        let root = vault();
        made(&root, "A graph");
        branch(&root, "later").expect("the branch");
        write(&root, GRAPH_FILE, "{}");

        assert_eq!(
            switch_to(&root, "later").unwrap_err().said(),
            "There is writing here that is not committed: graph.json. Commit it first, or put it back the way it was."
        );

        for one in ["a", "b", "c", "d"] {
            write(&root, &format!("notes/{one}.md"), one);
        }
        made(&root, "Four notes");
        for one in ["a", "b", "c", "d"] {
            write(&root, &format!("notes/{one}.md"), "changed");
        }
        assert_eq!(
            switch_to(&root, "later").unwrap_err().said(),
            "There is writing here that is not committed: notes/a.md, notes/b.md, notes/c.md and 1 more. Commit it first, or put it back the way it was."
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

        let held = merge_in(&root, "later").expect("the merge");
        assert!(held.merged);
        assert_eq!(
            head(&root).expect("the head").as_deref(),
            Some(ahead.id.as_str())
        );
        assert_eq!(read(&root, "notes/a.md"), "one");
        let held = status(&root).expect("the status");
        assert_eq!(held.branch.as_deref(), Some("main"));
        assert!(held.changed.is_empty());

        assert!(merge_in(&root, "later").expect("nothing left").merged);
        assert_eq!(
            merge_in(&root, "main").unwrap_err().said(),
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

        assert!(merge_in(&root, "later").expect("the merge").merged);
        assert_eq!(read(&root, "notes/a.md"), "mine");
        assert_eq!(read(&root, "notes/b.md"), "theirs");

        let page = log(&root, 1, None).expect("the listing");
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

        let held = merge_in(&root, "later").expect("the merge");
        assert!(!held.merged);
        assert_eq!(
            held.conflicts.as_deref(),
            Some(["notes/a.md".to_owned()].as_slice())
        );
        assert_eq!(read(&root, "notes/a.md"), "mine");

        assert_eq!(
            commit(&root, "Too soon").unwrap_err().said(),
            "Some of these are still here in two versions. Choose one of each and try again."
        );
        assert_eq!(
            merge_in(&root, "later").unwrap_err().said(),
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
        assert!(commit(&root, "Again").expect("nothing left").is_none());
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

        let held = merge_in(&root, "later").expect("the merge");
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
