//! A build's line of work and the checkouts it is carried out in —
//! `BuildAccess` in `@sloppy/app-core` declares every act and what its answer
//! means, docs/ARCHITECTURE.md § "Building from the notes".
//!
//! **Nothing here touches the folder in front of the person.** The line is a
//! branch of their repository, and the work happens in checkouts of this app's
//! own under its private data: one for the line, one per task on a branch of
//! the line nobody is shown. Taking a line in is `History.merge` on their own
//! folder and is deliberately not here.
//!
//! **A commit made here stages the whole checkout, code and notes.** That is
//! the one place the rule that a commit of Sloppy's carries the notes alone
//! does not hold: the checkout is the build's own and the code is the point.
//! What the folder is told not to keep stays out either way.
//!
//! What is standing is read back out of the repository rather than out of
//! anything a run remembers, so a build is still there after the app has been
//! closed and opened again.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use git2::{
    build::CheckoutBuilder, BranchType, Index, IndexAddOption, ObjectType, Oid, Repository,
    RepositoryState, WorktreeAddOptions, WorktreePruneOptions,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::draft::vault_in;
use crate::history::{
    at, branch_head, conflicted_path, head_commit, let_go, merging, on, record, view, Commit,
    HistoryError, Kept, BUILD_TASK_PREFIX,
};
use crate::signing::Trust;
use crate::vault::{settled, Folders, Opened};

/// What a build's line is called before its name — `BUILD_LINE_PREFIX` in
/// `@sloppy/types`. **It is shown**: the line stands in the history picture
/// like any other and the person works on it and takes it in there.
const LINE_PREFIX: &str = "build/";

/// Where a build's line is written down, before the build's own ulid and the
/// name of that line: the version it forked from, and the record that the line
/// is this build's rather than one the person opened themselves. This is no
/// branch — nothing `history.rs` lists or acts on reaches one.
const BASE_REF: &str = "refs/sloppy/builds/";

/// What the line's own copy is called under the build, beside one folder per
/// task.
const LINE: &str = "line";

/// What a task's copy is called before the task's own id, so a task's folder is
/// never the line's however a plan names the task.
const TASK: &str = "task-";

/// What the record of where a build began says for itself.
const BEGAN: &str = "Where the build began";

const NOT_A_BUILD: &str = "That build is not here any more. Start it again.";
const NOT_A_TASK: &str = "That task is not here any more.";
const NO_VERSION: &str = "Keep a version of this project first. A build needs one to start from.";
const NOT_A_NAME: &str = "Give the build a name with a letter or a digit in it.";
const IN_TWO_VERSIONS: &str =
    "Some files here are still in two versions. Settle each one, then try again.";
const MID_MERGE: &str =
    "This copy is in the middle of taking a task in. Settle it and keep a version, then try again.";
const DIDNT_WORK: &str = "That did not work. Try again.";

fn already_a_line(name: &str) -> HistoryError {
    HistoryError::new(format!(
        "A line of work is already called {name}. Give the build another name."
    ))
}

/// One build standing — `BuildStanding` in `@sloppy/types`. `path` is where the
/// line's copy is, which `start` makes again where the build has given it up.
#[derive(Debug, Serialize)]
pub struct Standing {
    id: String,
    line: String,
    path: String,
    from: String,
    tasks: Vec<StandingTask>,
}

/// One task's copy, as the build is carrying it out.
#[derive(Debug, Serialize)]
pub struct StandingTask {
    task: String,
    path: String,
}

/// The line a build writes on and the copy it is worked on in.
#[derive(Debug, Serialize)]
pub struct Line {
    line: String,
    path: String,
}

/// What a task merged into the line came to. An empty `conflicts` with
/// `merged` false cannot happen: a merge either is done or has left something
/// in two versions.
#[derive(Debug, Serialize)]
pub struct Merge {
    merged: bool,
    conflicts: Vec<String>,
}

impl Merge {
    fn whole() -> Self {
        Merge {
            merged: true,
            conflicts: Vec::new(),
        }
    }

    fn in_two_versions(conflicts: Vec<String>) -> Self {
        Merge {
            merged: false,
            conflicts,
        }
    }
}

/// A ulid as `UlidSchema` in `@sloppy/types` spells one. Nothing here composes
/// a path, a branch or a ref out of anything that is not one.
fn build_id(id: &str) -> Result<&str, HistoryError> {
    let crockford = |held: u8| {
        held.is_ascii_digit()
            || (held.is_ascii_uppercase() && !matches!(held, b'I' | b'L' | b'O' | b'U'))
    };
    (id.len() == 26 && id.bytes().all(crockford))
        .then_some(id)
        .ok_or_else(|| HistoryError::new(NOT_A_BUILD))
}

/// Whether `held` is what `BUILD_SLUG` in `@sloppy/types` allows, up to `most`.
fn slugged(held: &str, most: usize) -> bool {
    let mut bytes = held.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    held.len() <= most
        && (first.is_ascii_lowercase() || first.is_ascii_digit())
        && bytes.all(|one| one.is_ascii_lowercase() || one.is_ascii_digit() || one == b'-')
}

/// A task's id as `BuildSlugSchema` in `@sloppy/types` spells one.
fn task_id(task: &str) -> Result<&str, HistoryError> {
    slugged(task, 64)
        .then_some(task)
        .ok_or_else(|| HistoryError::new(NOT_A_TASK))
}

/// A build's name as `BuildNameSchema` in `@sloppy/types` spells one — what
/// `buildNameFrom` answered on the page, held again here because it names a
/// branch of somebody's repository.
fn build_name(name: &str) -> Result<&str, HistoryError> {
    slugged(name, 120)
        .then_some(name)
        .ok_or_else(|| HistoryError::new(NOT_A_NAME))
}

fn based_at(id: &str, name: &str) -> String {
    format!("{BASE_REF}{id}/{name}")
}

/// The build and the line a record of ours names, and nothing for a ref that is
/// not one.
fn named_in(held: &str) -> Option<(&str, &str)> {
    let (id, name) = held.strip_prefix(BASE_REF)?.split_once('/')?;
    build_id(id).ok().zip(build_name(name).ok())
}

/// The line this build opened, read out of the repository: what it is called,
/// and the version it forked from. Nothing where this build has opened none.
fn ours(repo: &Repository, id: &str) -> Option<(String, Oid)> {
    repo.references_glob(&format!("{BASE_REF}{id}/*"))
        .ok()?
        .flatten()
        .find_map(|held| {
            let name = named_in(held.name()?)?.1.to_owned();
            Some((name, held.target()?))
        })
}

fn line_named(name: &str) -> String {
    format!("{LINE_PREFIX}{name}")
}

fn task_branch(id: &str, task: &str) -> String {
    format!("{BUILD_TASK_PREFIX}{id}/{task}")
}

fn line_path(folders: &Folders, id: &str) -> PathBuf {
    folders.builds_path().join(id).join(LINE)
}

fn task_path(folders: &Folders, id: &str, task: &str) -> PathBuf {
    folders.builds_path().join(id).join(format!("{TASK}{task}"))
}

/// What git calls one of a build's copies: the build's own id and what the copy
/// is for, so nothing another build or a draft made answers to the same name.
fn copy_named(id: &str, which: &str) -> String {
    format!("build-{id}-{which}")
}

/// The same for a task's copy, which is never the line's however a plan names
/// the task.
fn task_copy_named(id: &str, task: &str) -> String {
    copy_named(id, &format!("{TASK}{task}"))
}

/// A copy of the folder on `branch`, and the one standing where there is one.
fn checkout(
    repo: &Repository,
    branch: &str,
    named: &str,
    into: &Path,
) -> Result<PathBuf, HistoryError> {
    if let Ok(standing) = repo.find_worktree(named) {
        if standing.validate().is_ok() {
            return Ok(settled(standing.path()));
        }
    }
    taken_out(repo, named)?;
    if into.exists() {
        fs::remove_dir_all(into)?;
    }
    if let Some(folder) = into.parent() {
        fs::create_dir_all(folder)?;
    }
    let held = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|_| HistoryError::new(NOT_A_BUILD))?;
    let mut how = WorktreeAddOptions::new();
    how.reference(Some(held.get()));
    let made = repo.worktree(named, into, Some(&how))?;
    Ok(settled(made.path()))
}

/// One copy gone, with nothing of it left behind. A copy that is not there is
/// not a failure.
fn taken_out(repo: &Repository, named: &str) -> Result<(), HistoryError> {
    let Ok(held) = repo.find_worktree(named) else {
        return Ok(());
    };
    let at = settled(held.path());
    let mut how = WorktreePruneOptions::new();
    how.valid(true).locked(true).working_tree(true);
    held.prune(Some(&mut how))?;
    if at.exists() {
        fs::remove_dir_all(&at)?;
    }
    Ok(())
}

/// Every task this build has opened a branch for, whether or not a copy of it
/// is still there.
fn tasks_of(repo: &Repository, id: &str) -> Result<Vec<String>, HistoryError> {
    let under = format!("{BUILD_TASK_PREFIX}{id}/");
    let mut held = BTreeSet::new();
    for found in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = found?;
        let Some(name) = branch.name()?.and_then(|name| name.strip_prefix(&under)) else {
            continue;
        };
        if let Ok(task) = task_id(name) {
            held.insert(task.to_owned());
        }
    }
    Ok(held.into_iter().collect())
}

/// Everything of the build gone: every task's copy and branch, the line's copy,
/// the line itself and the record of where it began.
fn taken_apart(folders: &Folders, repo: &Repository, id: &str) -> Result<(), HistoryError> {
    for task in tasks_of(repo, id)? {
        let_go_of_task(folders, repo, id, &task)?;
    }
    // A copy whose branch is already gone is still a folder on the disk and
    // still registered, so what the build made is swept by its own name.
    let under = copy_named(id, "");
    for name in repo.worktrees()?.iter().flatten() {
        if name.starts_with(&under) {
            taken_out(repo, name)?;
        }
    }
    if let Some((name, _)) = ours(repo, id) {
        if let Ok(mut line) = repo.find_branch(&line_named(&name), BranchType::Local) {
            line.delete()?;
        }
        if let Ok(mut held) = repo.find_reference(&based_at(id, &name)) {
            held.delete()?;
        }
    }
    let held = folders.builds_path().join(id);
    if held.exists() {
        fs::remove_dir_all(&held)?;
    }
    Ok(())
}

/// One task's copy and branch gone. What it merged into the line stays.
fn let_go_of_task(
    folders: &Folders,
    repo: &Repository,
    id: &str,
    task: &str,
) -> Result<(), HistoryError> {
    taken_out(repo, &task_copy_named(id, task))?;
    let held = task_path(folders, id, task);
    if held.exists() {
        fs::remove_dir_all(&held)?;
    }
    if let Ok(mut branch) = repo.find_branch(&task_branch(id, task), BranchType::Local) {
        branch.delete()?;
    }
    Ok(())
}

/// The notes inside one of the build's copies, opened the way every act of this
/// app's opens a folder — so a version kept there is by the author and the
/// signing the person's own folder is set to, and not by whatever git on this
/// machine would say.
fn notes_in(folders: &Folders, theirs: &Kept, copy: &Path) -> Result<Opened, HistoryError> {
    let vault = vault_in(&settled(copy), theirs.prefix());
    Ok(folders.opened(&vault.to_string_lossy())?)
}

/// Whether `path` is one of this build's copies: a page may name only a copy
/// these acts answered with, so anything else is nowhere a version is kept.
fn one_of_ours(folders: &Folders, repo: &Repository, path: &str) -> Result<(), HistoryError> {
    let held = settled(Path::new(path));
    let under = held
        .strip_prefix(folders.builds_path())
        .map_err(|_| HistoryError::new(NOT_A_BUILD))?;
    let mut parts = under
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned());
    let (Some(id), Some(which), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(HistoryError::new(NOT_A_BUILD));
    };
    let id = build_id(&id)?;
    if ours(repo, id).is_none() {
        return Err(HistoryError::new(NOT_A_BUILD));
    }
    match which.strip_prefix(TASK) {
        Some(task) => task_id(task).map(|_| ())?,
        None if which == LINE => {}
        None => return Err(HistoryError::new(NOT_A_BUILD)),
    }
    Ok(())
}

/// Every path a merge has left in two versions, as the project spells them —
/// the files a session settles where it is working.
fn in_two(index: &Index) -> Result<Vec<String>, HistoryError> {
    let mut held = BTreeSet::new();
    for found in index.conflicts()? {
        if let Some(path) = conflicted_path(&found?) {
            held.insert(path);
        }
    }
    Ok(held.into_iter().collect())
}

/// The line the build `id` writes on and the copy it is worked on in: the line
/// opened at `from` where the build has none, and the one standing where it
/// has — so asking twice answers one line rather than opening a second, and a
/// build whose copy was given up is worked on again.
pub fn start(
    folders: &Folders,
    root: &str,
    id: &str,
    name: &str,
    from: &str,
) -> Result<Line, HistoryError> {
    let id = build_id(id)?;
    let asked = build_name(name)?;
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    let repo = kept.repo();
    let standing = ours(repo, id);
    let (name, began) = match &standing {
        Some((name, began)) => (name.clone(), *began),
        None => {
            let began = repo
                .revparse_single(from)
                .and_then(|found| found.peel_to_commit())
                .map_err(|_| HistoryError::new(NO_VERSION))?
                .id();
            if repo
                .find_branch(&line_named(asked), BranchType::Local)
                .is_ok()
            {
                return Err(already_a_line(asked));
            }
            repo.reference(&based_at(id, asked), began, false, BEGAN)?;
            (asked.to_owned(), began)
        }
    };
    let line = line_named(&name);
    match opens(repo, folders, id, &line, began) {
        Ok(path) => Ok(Line {
            line,
            path: path.to_string_lossy().into_owned(),
        }),
        Err(why) => {
            // A build half opened is one nothing lists and nobody can reach, so
            // what was made of it goes back — and a build that was already
            // standing keeps everything it had.
            if standing.is_none() {
                let _ = taken_apart(folders, repo, id);
            }
            Err(why)
        }
    }
}

/// The line's branch where it is not there, and the copy the line is worked on
/// in.
fn opens(
    repo: &Repository,
    folders: &Folders,
    id: &str,
    line: &str,
    began: Oid,
) -> Result<PathBuf, HistoryError> {
    if repo.find_branch(line, BranchType::Local).is_err() {
        repo.branch(line, &repo.find_commit(began)?, false)?;
    }
    checkout(repo, line, &copy_named(id, LINE), &line_path(folders, id))
}

/// The copy one task works in, on a branch of the line nobody is shown. Asking
/// again for a task that has one answers that one.
pub fn task_checkout(
    folders: &Folders,
    root: &str,
    id: &str,
    task: &str,
) -> Result<String, HistoryError> {
    let id = build_id(id)?;
    let task = task_id(task)?;
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    let repo = kept.repo();
    let (name, _) = ours(repo, id).ok_or_else(|| HistoryError::new(NOT_A_BUILD))?;
    let branch = task_branch(id, task);
    let made = if repo.find_branch(&branch, BranchType::Local).is_ok() {
        true
    } else {
        let head =
            branch_head(repo, &line_named(&name)).ok_or_else(|| HistoryError::new(NOT_A_BUILD))?;
        repo.branch(&branch, &repo.find_commit(head)?, false)?;
        false
    };
    match checkout(
        repo,
        &branch,
        &task_copy_named(id, task),
        &task_path(folders, id, task),
    ) {
        Ok(path) => Ok(path.to_string_lossy().into_owned()),
        Err(why) => {
            if !made {
                let _ = let_go_of_task(folders, repo, id, task);
            }
            Err(why)
        }
    }
}

/// What is in one of the build's copies, kept as one version — the code and the
/// notes together. Nothing where the copy holds nothing that is not already
/// kept, which is not a failure.
///
/// A copy in the middle of taking a task in is finished by this: the version it
/// keeps carries what was merged, however the session settled it.
pub fn commit(
    folders: &Folders,
    root: &str,
    path: &str,
    message: &str,
) -> Result<Option<Commit>, HistoryError> {
    let opened = folders.opened(root)?;
    let theirs = at(&opened)?;
    one_of_ours(folders, theirs.repo(), path)?;
    let into = notes_in(folders, &theirs, Path::new(path))?;
    let mut kept = at(&into)?;
    let with = merging(kept.repo_mut())?;
    let repo = kept.repo();
    let mut index = repo.index()?;
    let_go(&kept, &mut index)?;
    index.update_all(["*"], None)?;
    index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
    index.write()?;
    if index.has_conflicts() {
        return Err(HistoryError::new(IN_TWO_VERSIONS));
    }
    let head = head_commit(repo)?;
    let written = index.write_tree()?;
    if with.is_none() {
        if let Some(held) = &head {
            if held.tree_id() == written {
                return Ok(None);
            }
        }
    }
    let tree = repo.find_tree(written)?;
    let taken = match with {
        Some(held) => Some(repo.find_commit(held)?),
        None => None,
    };
    let mut parents: Vec<&git2::Commit<'_>> = Vec::new();
    if let Some(one) = head.as_ref() {
        parents.push(one);
    }
    if let Some(one) = taken.as_ref() {
        parents.push(one);
    }
    let data = PathBuf::from(folders.data_path());
    let made = record(&kept, &into, &data, message, &tree, &parents)?;
    if with.is_some() {
        repo.cleanup_state()?;
    }
    let held = view(repo, &repo.find_commit(made)?, &Trust::of(&into, &data));
    Ok(Some(held))
}

/// The task's branch taken into the line, in the line's own copy. A merge that
/// settles is kept here; one that does not leaves every file it could not
/// settle in the copy for a session to settle itself, and is finished by
/// keeping a version of that copy.
pub fn merge_task(
    folders: &Folders,
    root: &str,
    id: &str,
    task: &str,
) -> Result<Merge, HistoryError> {
    let id = build_id(id)?;
    let task = task_id(task)?;
    let opened = folders.opened(root)?;
    let theirs = at(&opened)?;
    if ours(theirs.repo(), id).is_none() {
        return Err(HistoryError::new(NOT_A_BUILD));
    }
    let head = branch_head(theirs.repo(), &task_branch(id, task))
        .ok_or_else(|| HistoryError::new(NOT_A_TASK))?;
    let into = notes_in(folders, &theirs, &line_path(folders, id))?;
    let mut kept = at(&into)?;
    if merging(kept.repo_mut())?.is_some() {
        return Err(HistoryError::new(MID_MERGE));
    }
    let repo = kept.repo();
    if repo.state() != RepositoryState::Clean {
        return Err(HistoryError::new(MID_MERGE));
    }
    let (Some(mine), Some(line)) = (head_commit(repo)?, on(repo)?) else {
        return Err(HistoryError::new(NOT_A_BUILD));
    };
    let taking = repo.find_annotated_commit(head)?;
    let (reading, _) = repo.merge_analysis(&[&taking])?;
    if reading.is_up_to_date() {
        return Ok(Merge::whole());
    }
    if reading.is_fast_forward() {
        let onto = repo.find_object(head, Some(ObjectType::Commit))?;
        let mut how = CheckoutBuilder::new();
        how.safe();
        repo.checkout_tree(&onto, Some(&mut how))?;
        repo.reference(
            &format!("refs/heads/{line}"),
            head,
            true,
            &format!("merge {task}"),
        )?;
        return Ok(Merge::whole());
    }
    let mut how = CheckoutBuilder::new();
    how.safe();
    repo.merge(&[&taking], None, Some(&mut how))?;
    let mut index = repo.index()?;
    if index.has_conflicts() {
        return Ok(Merge::in_two_versions(in_two(&index)?));
    }
    let tree = repo.find_tree(index.write_tree()?)?;
    index.write()?;
    let took = repo.find_commit(head)?;
    let data = PathBuf::from(folders.data_path());
    record(
        &kept,
        &into,
        &data,
        &format!("Merge {task}"),
        &tree,
        &[&mine, &took],
    )?;
    repo.cleanup_state()?;
    Ok(Merge::whole())
}

/// The task's copy and its branch gone, with nothing of either left behind.
/// What it merged into the line stays, and a task that is not there is not a
/// failure.
pub fn finish_task(
    folders: &Folders,
    root: &str,
    id: &str,
    task: &str,
) -> Result<(), HistoryError> {
    let id = build_id(id)?;
    let task = task_id(task)?;
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    let_go_of_task(folders, kept.repo(), id, task)
}

/// The line's copy given up, so the person's own folder can work on the line
/// without two copies holding one branch. The line and its versions stay.
pub fn finish(folders: &Folders, root: &str, id: &str) -> Result<(), HistoryError> {
    let id = build_id(id)?;
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    taken_out(kept.repo(), &copy_named(id, LINE))?;
    let held = line_path(folders, id);
    if held.exists() {
        fs::remove_dir_all(&held)?;
    }
    Ok(())
}

/// Everything of the build gone: its tasks' copies and branches, the line's
/// copy, the line itself and the record of where it began. The person's own
/// folder and lines are untouched, and a build that is not there is not a
/// failure.
pub fn discard(folders: &Folders, root: &str, id: &str) -> Result<(), HistoryError> {
    let id = build_id(id)?;
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    taken_apart(folders, kept.repo(), id)
}

/// Every build standing for the folder at `root`, read out of the repository
/// keeping it. A build whose line the person has deleted is standing no longer.
pub fn standing(folders: &Folders, root: &str) -> Result<Vec<Standing>, HistoryError> {
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    let repo = kept.repo();
    let mut held = Vec::new();
    for found in repo.references_glob(&format!("{BASE_REF}*"))?.flatten() {
        let (Some(name), Some(from)) = (found.name(), found.target()) else {
            continue;
        };
        let Some((id, called)) = named_in(name) else {
            continue;
        };
        let line = line_named(called);
        if repo.find_branch(&line, BranchType::Local).is_err() {
            continue;
        }
        let tasks = tasks_of(repo, id)?
            .into_iter()
            .filter(|task| task_path(folders, id, task).is_dir())
            .map(|task| StandingTask {
                path: task_path(folders, id, &task).to_string_lossy().into_owned(),
                task,
            })
            .collect();
        held.push(Standing {
            id: id.to_owned(),
            line,
            path: line_path(folders, id).to_string_lossy().into_owned(),
            from: from.to_string(),
            tasks,
        });
    }
    // A ulid sorts by when it was minted, so this is oldest first and reading
    // the same repository twice is one answer.
    held.sort_by(|one, other| one.id.cmp(&other.id));
    Ok(held)
}

/// A copy is a checkout of every file the project keeps, and a merge reads and
/// writes the same, so none of this runs on the thread the page is drawn on.
async fn off_the_page<T: Send + 'static>(
    act: impl FnOnce() -> Result<T, HistoryError> + Send + 'static,
) -> Result<T, HistoryError> {
    tauri::async_runtime::spawn_blocking(act)
        .await
        .map_err(|_| HistoryError::new(DIDNT_WORK))?
}

#[tauri::command]
pub async fn build_standing<R: Runtime>(
    app: AppHandle<R>,
    root: String,
) -> Result<Vec<Standing>, HistoryError> {
    off_the_page(move || standing(&app.state::<Folders>(), &root)).await
}

#[tauri::command]
pub async fn build_start<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    id: String,
    name: String,
    from: String,
) -> Result<Line, HistoryError> {
    off_the_page(move || start(&app.state::<Folders>(), &root, &id, &name, &from)).await
}

#[tauri::command]
pub async fn build_task_checkout<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    id: String,
    task: String,
) -> Result<String, HistoryError> {
    off_the_page(move || task_checkout(&app.state::<Folders>(), &root, &id, &task)).await
}

#[tauri::command]
pub async fn build_commit<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    path: String,
    message: String,
) -> Result<Option<Commit>, HistoryError> {
    off_the_page(move || commit(&app.state::<Folders>(), &root, &path, &message)).await
}

#[tauri::command]
pub async fn build_merge_task<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    id: String,
    task: String,
) -> Result<Merge, HistoryError> {
    off_the_page(move || merge_task(&app.state::<Folders>(), &root, &id, &task)).await
}

#[tauri::command]
pub async fn build_finish_task<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    id: String,
    task: String,
) -> Result<(), HistoryError> {
    off_the_page(move || finish_task(&app.state::<Folders>(), &root, &id, &task)).await
}

#[tauri::command]
pub async fn build_finish<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    id: String,
) -> Result<(), HistoryError> {
    off_the_page(move || finish(&app.state::<Folders>(), &root, &id)).await
}

#[tauri::command]
pub async fn build_discard<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    id: String,
) -> Result<(), HistoryError> {
    off_the_page(move || discard(&app.state::<Folders>(), &root, &id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::tests::{beside_the_graph, made, project, their_commit, write};
    use crate::history::{branches, head, read_at, set_git_user, switch_to, GitUser};

    const ID: &str = "01JAPART000000000000000000";
    const OTHER: &str = "01JAPART000000000000000001";
    const NAME: &str = "the-reader";

    /// The vault's own sidecar folder — `SLOPPY_DIR` in `@sloppy/vault`, where
    /// the identity a container's writing is by is kept.
    const SIDECAR: &str = ".sloppy";

    /// A project with its notes inside it, one version kept, and the folders
    /// this app may reach — its own data among them.
    fn ready(name: &str) -> (Folders, Opened, Opened) {
        let (project, container) = project(name);
        beside_the_graph(&container.join(SIDECAR));
        write(&container, "notes/a.md", "one");
        // The code is the person's own, kept by them; the notes are Sloppy's,
        // kept by it — which is what a build's line forks from.
        their_commit(&project, &["src/a.ts"], "The code");
        made(&container, "A graph");
        let data = project.with_extension("data");
        let folders = Folders::new(data).expect("this app's own data");
        folders.pick(project.to_path_buf()).expect("the project");
        (folders, project, container)
    }

    fn said(root: &Opened) -> String {
        root.to_string_lossy().into_owned()
    }

    /// Where the folder's notes were last kept, which is what a build forks
    /// from.
    fn from(container: &Opened) -> String {
        head(container).expect("the version").expect("one")
    }

    /// A build of the folder, opened the way the page opens one.
    fn opened(folders: &Folders, container: &Opened, id: &str, name: &str) -> Line {
        start(folders, &said(container), id, name, &from(container)).expect("a build")
    }

    /// Opened the way every act here opens a folder — through `Folders`, which
    /// is what says this app may reach it.
    fn notes(folders: &Folders, at: &Path) -> Opened {
        folders
            .opened(&at.join(SIDECAR).to_string_lossy())
            .expect("the notes")
    }

    /// What the person's own repository holds that a build may not move: the
    /// branch it is on, where that branch is, and what is staged.
    fn theirs_alone(root: &Opened) -> (Option<String>, Option<String>, Vec<String>) {
        let kept = at(root).expect("the repository");
        let repo = kept.repo();
        let index = repo.index().expect("the index");
        (
            on(repo).expect("the branch"),
            head(root).expect("the version"),
            index
                .iter()
                .filter_map(|entry| String::from_utf8(entry.path).ok())
                .collect(),
        )
    }

    /// Every file one version carries, as the repository spells them.
    fn carried(copy: &str, commit: &str) -> Vec<String> {
        let repo = Repository::open(copy).expect("the copy");
        let tree = repo
            .find_commit(Oid::from_str(commit).expect("an id"))
            .expect("the version")
            .tree()
            .expect("the tree");
        let mut held = Vec::new();
        tree.walk(git2::TreeWalkMode::PreOrder, |root, entry| {
            if entry.kind() == Some(ObjectType::Blob) {
                held.push(format!("{root}{}", entry.name().unwrap_or_default()));
            }
            git2::TreeWalkResult::Ok
        })
        .expect("the walk");
        held.sort();
        held
    }

    /// Who one version is by, and how many it was taken from — two is a merge.
    fn by(copy: &str, commit: &str) -> (String, usize) {
        let repo = Repository::open(copy).expect("the copy");
        let held = repo
            .find_commit(Oid::from_str(commit).expect("an id"))
            .expect("the version");
        let author = held.author().name().unwrap_or_default().to_owned();
        let from = held.parent_count();
        (author, from)
    }

    fn a_user(name: &str, address: &str) -> GitUser {
        serde_json::from_value(serde_json::json!({ "name": name, "email": address }))
            .expect("a name and an address")
    }

    #[test]
    fn a_build_opens_a_line_of_its_own_with_a_copy_to_work_in() {
        let (folders, _project, container) = ready("opened");
        let was = theirs_alone(&container);

        let line = opened(&folders, &container, ID, NAME);

        assert_eq!(line.line, "build/the-reader");
        assert_eq!(
            Path::new(&line.path),
            settled(&folders.builds_path().join(ID).join(LINE))
        );
        // The copy is the project, code and notes together.
        assert_eq!(
            fs::read_to_string(Path::new(&line.path).join("src/a.ts")).expect("the code"),
            "one"
        );
        assert_eq!(
            fs::read_to_string(Path::new(&line.path).join(".sloppy/notes/a.md")).expect("the note"),
            "one"
        );
        // The line stands in the history picture like any other.
        let lines: Vec<String> = branches(&container)
            .expect("the lines")
            .into_iter()
            .map(|held| held.name)
            .collect();
        assert!(lines.contains(&line.line), "{lines:?}");
        assert_eq!(theirs_alone(&container), was);
    }

    #[test]
    fn a_name_a_line_of_their_own_already_has_is_refused() {
        let (folders, _project, container) = ready("taken");
        crate::history::branch(&container, "build/taken").expect("their own line");

        let why = start(&folders, &said(&container), ID, "taken", &from(&container))
            .expect_err("a name that is taken");

        assert_eq!(
            why.said(),
            "A line of work is already called taken. Give the build another name."
        );
        assert!(!folders.builds_path().join(ID).exists());
    }

    /// A build is asked for its line again every time the app is opened, and
    /// the answer is the one line it has — with its copy made again where it
    /// had been given up, and the work it carries still on it.
    #[test]
    fn asking_again_answers_the_one_line_and_makes_its_copy_again() {
        let (folders, _project, container) = ready("again");
        let line = opened(&folders, &container, ID, NAME);
        write(Path::new(&line.path), "src/a.ts", "written by the build");
        let kept = commit(&folders, &said(&container), &line.path, "What it built")
            .expect("a version")
            .expect("one kept");

        assert_eq!(
            opened(&folders, &container, ID, "another-name").line,
            line.line
        );

        finish(&folders, &said(&container), ID).expect("the copy given up");
        assert!(!Path::new(&line.path).exists());

        let again = opened(&folders, &container, ID, NAME);
        assert_eq!(again.line, line.line);
        assert_eq!(again.path, line.path);
        assert_eq!(
            fs::read_to_string(Path::new(&again.path).join("src/a.ts")).expect("the code"),
            "written by the build"
        );
        assert_eq!(
            head(&notes(&folders, Path::new(&again.path)))
                .expect("the version")
                .expect("one"),
            kept.id
        );
    }

    /// A person reads a task, never a branch of one, so nothing lists it and no
    /// act reaches it by name — exactly as nothing does for a draft's.
    #[test]
    fn a_task_works_on_a_branch_of_the_line_nobody_is_shown() {
        let (folders, _project, container) = ready("tasks");
        let line = opened(&folders, &container, ID, NAME);

        let path = task_checkout(&folders, &said(&container), ID, "reader").expect("a copy");

        assert_eq!(
            Path::new(&path),
            settled(&folders.builds_path().join(ID).join("task-reader"))
        );
        assert!(Path::new(&path).join("src/a.ts").exists());
        let branch = task_branch(ID, "reader");
        let lines: Vec<String> = branches(&container)
            .expect("the lines")
            .into_iter()
            .map(|held| held.name)
            .collect();
        assert!(lines.contains(&line.line), "{lines:?}");
        assert!(!lines.contains(&branch), "{lines:?}");
        assert!(switch_to(&container, &branch).is_err());
        assert!(crate::history::delete_branch(&container, &branch).is_err());
        assert!(
            crate::history::merge_in(&container, Path::new(&folders.data_path()), &branch).is_err()
        );
        // A task's copy is its own however the plan named the task, so one
        // called like the line is still not the line's.
        let also = task_checkout(&folders, &said(&container), ID, LINE).expect("a copy");
        assert_ne!(also, line.path);
        // And asking again answers the copy it already has.
        assert_eq!(
            task_checkout(&folders, &said(&container), ID, "reader").expect("the same copy"),
            path
        );
    }

    #[test]
    fn a_version_a_build_keeps_carries_the_code_and_the_notes() {
        let (folders, _project, container) = ready("kept");
        set_git_user(&container, &a_user("Grace Hopper", "grace@example.com"))
            .expect("who the versions are by");
        let line = opened(&folders, &container, ID, NAME);
        let copy = Path::new(&line.path);
        write(copy, "src/a.ts", "what the build wrote");
        write(copy, ".sloppy/notes/b.md", "what it decided");
        beside_the_graph(&copy.join(SIDECAR).join(SIDECAR));
        let was = theirs_alone(&container);

        let kept = commit(&folders, &said(&container), &line.path, "What it built")
            .expect("a version")
            .expect("one kept");

        let held = carried(&line.path, &kept.id);
        assert!(held.contains(&"src/a.ts".to_owned()), "{held:?}");
        assert!(held.contains(&".sloppy/notes/b.md".to_owned()), "{held:?}");
        // What the folder is told not to keep stays out of a build's versions
        // the way it stays out of the person's own.
        for one in [
            ".sloppy/.sloppy/identity.json",
            ".sloppy/.sloppy/identity.key",
            ".sloppy/.sloppy/bin.json",
        ] {
            assert!(!held.contains(&one.to_owned()), "{held:?}");
        }
        assert_eq!(by(&line.path, &kept.id), ("Grace Hopper".to_owned(), 1));
        // A copy holding nothing unkept is not a failure.
        assert!(commit(&folders, &said(&container), &line.path, "Again")
            .expect("nothing to keep")
            .is_none());
        assert_eq!(theirs_alone(&container), was);
        // And a path that is not one of the build's copies is not somewhere a
        // version can be kept.
        assert!(commit(&folders, &said(&container), &said(&container), "Theirs").is_err());
    }

    #[test]
    fn a_task_taken_into_the_line_brings_what_it_wrote() {
        let (folders, _project, container) = ready("merged");
        let line = opened(&folders, &container, ID, NAME);
        let task = task_checkout(&folders, &said(&container), ID, "reader").expect("a copy");
        write(
            Path::new(&task),
            ".sloppy/notes/b.md",
            "what the task decided",
        );
        write(Path::new(&task), "src/b.ts", "what it wrote");
        commit(&folders, &said(&container), &task, "The reader")
            .expect("a version")
            .expect("one kept");
        let was = theirs_alone(&container);

        let held = merge_task(&folders, &said(&container), ID, "reader").expect("the merge");

        assert!(held.merged);
        assert!(held.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(Path::new(&line.path).join(".sloppy/notes/b.md")).expect("the note"),
            "what the task decided"
        );
        let kept = read_at(&notes(&folders, Path::new(&line.path)), "HEAD").expect("the line");
        assert!(kept.contains_key("notes/b.md"), "{:?}", kept.keys());
        assert_eq!(theirs_alone(&container), was);

        // The task's copy and branch go; what it merged stays.
        finish_task(&folders, &said(&container), ID, "reader").expect("the task finished");
        assert!(!Path::new(&task).exists());
        assert!(at(&container)
            .expect("the repository")
            .repo()
            .find_branch(&task_branch(ID, "reader"), BranchType::Local)
            .is_err());
        assert!(Path::new(&line.path).join(".sloppy/notes/b.md").exists());
        // A task that is not there is not a failure.
        finish_task(&folders, &said(&container), ID, "reader").expect("nothing left to finish");
    }

    /// A merge that cannot settle itself is left to a session that can: the
    /// files are there to be written, and keeping a version of the copy is what
    /// finishes it.
    #[test]
    fn a_merge_that_disagrees_says_which_files_and_leaves_them_to_settle() {
        let (folders, _project, container) = ready("conflict");
        let line = opened(&folders, &container, ID, NAME);
        let task = task_checkout(&folders, &said(&container), ID, "reader").expect("a copy");
        write(Path::new(&task), "src/a.ts", "the task's way");
        commit(&folders, &said(&container), &task, "The reader")
            .expect("a version")
            .expect("one kept");
        write(Path::new(&line.path), "src/a.ts", "the line's way");
        commit(&folders, &said(&container), &line.path, "The line")
            .expect("a version")
            .expect("one kept");
        let was = theirs_alone(&container);

        let held = merge_task(&folders, &said(&container), ID, "reader").expect("the merge");

        assert!(!held.merged);
        assert_eq!(held.conflicts, ["src/a.ts"]);
        assert_eq!(theirs_alone(&container), was);
        // Nothing else is taken in while one is waiting to be settled.
        assert!(merge_task(&folders, &said(&container), ID, "reader").is_err());

        write(Path::new(&line.path), "src/a.ts", "both ways");
        let kept = commit(&folders, &said(&container), &line.path, "Settled")
            .expect("a version")
            .expect("one kept");

        assert_eq!(by(&line.path, &kept.id).1, 2);
        assert_eq!(
            fs::read_to_string(Path::new(&line.path).join("src/a.ts")).expect("the code"),
            "both ways"
        );
        assert_eq!(
            Repository::open(&line.path).expect("the copy").state(),
            RepositoryState::Clean
        );
        assert_eq!(theirs_alone(&container), was);
    }

    #[test]
    fn what_is_standing_is_read_out_of_the_repository() {
        let (folders, _project, container) = ready("standing");
        assert!(standing(&folders, &said(&container))
            .expect("what stands")
            .is_empty());
        let line = opened(&folders, &container, ID, NAME);
        task_checkout(&folders, &said(&container), ID, "reader").expect("a copy");
        task_checkout(&folders, &said(&container), ID, "writer").expect("another");

        let held = standing(&folders, &said(&container)).expect("what stands");

        assert_eq!(held.len(), 1);
        assert_eq!(held[0].id, ID);
        assert_eq!(held[0].line, line.line);
        assert_eq!(held[0].path, line.path);
        assert_eq!(held[0].from, from(&container));
        assert_eq!(
            held[0]
                .tasks
                .iter()
                .map(|one| one.task.as_str())
                .collect::<Vec<_>>(),
            ["reader", "writer"]
        );

        // A task finished with is no longer one of the build's copies, and the
        // line's own copy given up leaves the line standing.
        finish_task(&folders, &said(&container), ID, "reader").expect("the task finished");
        finish(&folders, &said(&container), ID).expect("the copy given up");
        let held = standing(&folders, &said(&container)).expect("what stands");
        assert_eq!(held.len(), 1);
        assert_eq!(
            held[0]
                .tasks
                .iter()
                .map(|one| one.task.as_str())
                .collect::<Vec<_>>(),
            ["writer"]
        );
        assert!(branches(&container)
            .expect("the lines")
            .into_iter()
            .any(|held| held.name == line.line));

        // And a line the person has deleted themselves leaves nothing standing.
        crate::history::delete_branch(&container, &line.line).expect("their own line gone");
        assert!(standing(&folders, &said(&container))
            .expect("what stands")
            .is_empty());
    }

    #[test]
    fn a_build_discarded_leaves_no_ref_of_itself() {
        let (folders, _project, container) = ready("discarded");
        let line = opened(&folders, &container, ID, NAME);
        let task = task_checkout(&folders, &said(&container), ID, "reader").expect("a copy");
        let other = opened(&folders, &container, OTHER, "another-build");
        let was = theirs_alone(&container);

        discard(&folders, &said(&container), ID).expect("the build gone");

        assert!(!Path::new(&line.path).exists());
        assert!(!Path::new(&task).exists());
        assert!(!folders.builds_path().join(ID).exists());
        let kept = at(&container).expect("the repository");
        let repo = kept.repo();
        assert!(repo.find_branch(&line.line, BranchType::Local).is_err());
        assert!(repo
            .find_branch(&task_branch(ID, "reader"), BranchType::Local)
            .is_err());
        assert_eq!(
            repo.references_glob(&format!("{BASE_REF}{ID}/*"))
                .expect("what is written down")
                .count(),
            0
        );
        assert!(repo
            .worktrees()
            .expect("the copies")
            .iter()
            .flatten()
            .all(|name| !name.starts_with(&copy_named(ID, ""))));
        // Another build of the same project is untouched, and so is the person's
        // own folder.
        assert!(Path::new(&other.path).exists());
        assert_eq!(theirs_alone(&container), was);
        // A build that is not there is not a failure.
        discard(&folders, &said(&container), ID).expect("nothing left to discard");
    }

    /// Every act, one after another, against what the person's own folder held
    /// before any of them: a build works in copies of its own, and the folder
    /// in front of somebody is not part of that.
    #[test]
    fn nothing_of_the_person_s_folder_moves_at_any_step() {
        let (folders, project, container) = ready("theirs");
        let was = theirs_alone(&container);
        let code = fs::read_to_string(project.join("src/a.ts")).expect("their code");
        let note = fs::read_to_string(container.join("notes/a.md")).expect("their note");
        let root = said(&container);

        let line = opened(&folders, &container, ID, NAME);
        let task = task_checkout(&folders, &root, ID, "reader").expect("a copy");
        write(Path::new(&task), "src/a.ts", "what the build wrote");
        commit(&folders, &root, &task, "The reader").expect("a version");
        merge_task(&folders, &root, ID, "reader").expect("the merge");
        finish_task(&folders, &root, ID, "reader").expect("the task finished");
        commit(&folders, &root, &line.path, "The line").expect("a version");
        finish(&folders, &root, ID).expect("the copy given up");

        assert_eq!(theirs_alone(&container), was);
        assert_eq!(
            fs::read_to_string(project.join("src/a.ts")).expect("their code"),
            code
        );
        assert_eq!(
            fs::read_to_string(container.join("notes/a.md")).expect("their note"),
            note
        );

        // And taking the line in is the merge their own folder already has.
        crate::history::merge_in(&container, Path::new(&folders.data_path()), &line.line)
            .expect("the line taken in");
        assert_eq!(
            fs::read_to_string(project.join("src/a.ts")).expect("their code"),
            "what the build wrote"
        );
    }
}
