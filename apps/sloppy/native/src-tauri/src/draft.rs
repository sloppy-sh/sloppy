//! Making and letting go of a draft of the notes — `DraftAccess` in
//! `@sloppy/app-core` declares every act and what its answer means,
//! docs/ARCHITECTURE.md § "Asking a tool to write the notes".
//!
//! A draft is a second checkout of the repository keeping the folder's notes,
//! under this app's own data, on a branch of its own at the version the folder
//! was last kept at. That is what lets the agent read the code as it was kept,
//! and what makes a draft survive the app closing: it is read back out of the
//! repository rather than out of anything this run remembers.
//!
//! **Making one is all this file does.** Everything after it is what the rest
//! of the app already does to a folder: the commands in `history.rs` keep a
//! version on the draft and read one back, and settling the two copies into one
//! is `previewVault` and `importVault` in `@sloppy/local`. No merge of git's
//! ever touches the folder in front of somebody.

use std::fs;
use std::path::{Path, PathBuf};

use git2::{BranchType, Repository, WorktreeAddOptions, WorktreePruneOptions};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::history::{at, HistoryError};
use crate::vault::{settled, Folders};

/// What a draft's branch is called before its own ulid — `DRAFT_BRANCH_PREFIX`
/// in `@sloppy/types`, which is the one spelling and the reason nothing shows
/// it to anybody.
const BRANCH_PREFIX: &str = "sloppy/draft/";

/// A branch a draft is on, which is not one of the folder's lines of work:
/// nothing in `history.rs` lists one and no act there reaches one by name.
pub fn of_a_draft(name: &str) -> bool {
    name.starts_with(BRANCH_PREFIX)
}

/// The vault's own sidecar folder — `SLOPPY_DIR` in `@sloppy/vault`. The
/// identity a container's writing is by is kept in it, and the repository is
/// told not to keep it.
const SIDECAR: &str = ".sloppy";

const NOTHING_KEPT: &str = "Keep a version of these notes first. A draft starts from the last one.";
const NOT_A_DRAFT: &str = "That draft is not here any more.";
const ALREADY_THERE: &str = "There is already a draft of these notes.";
const DIDNT_WORK: &str = "That did not work. Try again.";

/// One draft standing — `StandingDraft` in `@sloppy/types`, which says what
/// each of these is and which of them a person ever sees. None of them.
#[derive(Debug, Serialize)]
pub struct Draft {
    id: String,
    root: String,
    vault: String,
    branch: String,
    from: String,
}

/// A ulid as `UlidSchema` in `@sloppy/types` spells one. Nothing here composes
/// a path or a branch name out of anything that is not one.
fn draft_id(id: &str) -> Result<&str, HistoryError> {
    let crockford = |held: u8| {
        held.is_ascii_digit()
            || (held.is_ascii_uppercase() && !matches!(held, b'I' | b'L' | b'O' | b'U'))
    };
    (id.len() == 26 && id.bytes().all(crockford))
        .then_some(id)
        .ok_or_else(|| HistoryError::new(NOT_A_DRAFT))
}

/// The vault's path inside the repository keeping it, spelled with `/` and with
/// no slash at either end. Empty is a vault that is the whole of it.
fn prefix_of(repo: &Repository, vault: &Path) -> String {
    let Some(work) = repo.workdir() else {
        return String::new();
    };
    settled(vault)
        .strip_prefix(settled(work))
        .map(|under| {
            under
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// The same vault inside the copy: the copy's own root, and then wherever the
/// notes sit inside it.
fn vault_in(worktree: &Path, prefix: &str) -> PathBuf {
    if prefix.is_empty() {
        worktree.to_path_buf()
    } else {
        worktree.join(prefix)
    }
}

/// The version a draft's branch and the folder's own last had in common, which
/// is what the draft was taken from — read back out of the two rather than
/// written down, so nothing can disagree with the repository.
fn forked_from(repo: &Repository, branch: &str) -> Result<String, HistoryError> {
    let theirs = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|_| HistoryError::new(NOT_A_DRAFT))?
        .get()
        .peel_to_commit()?
        .id();
    let ours = repo.head()?.peel_to_commit()?.id();
    Ok(repo.merge_base(ours, theirs).unwrap_or(theirs).to_string())
}

/// The folder's own private data carried into the copy: what the repository is
/// told not to keep, which is the identity the container's writing is by. A
/// copy written under a fresh identity would have every note the folder holds
/// offered back as somebody else's amendment — docs/ARCHITECTURE.md § "Asking a
/// tool to write the notes". What the repository IS keeping is already in the
/// copy, at the version the draft forked from, and is left exactly as it is.
fn carry_private(repo: &Repository, from: &Path, into: &Path) -> Result<(), HistoryError> {
    let Some(work) = repo.workdir().map(settled) else {
        return Ok(());
    };
    let entries = match fs::read_dir(from) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries {
        let entry = entry?;
        let held = entry.path();
        let Ok(under) = settled(&held).strip_prefix(&work).map(Path::to_path_buf) else {
            continue;
        };
        if !repo.is_path_ignored(&under).unwrap_or(false) {
            continue;
        }
        copy_across(&held, &into.join(entry.file_name()))?;
    }
    Ok(())
}

fn copy_across(from: &Path, into: &Path) -> Result<(), HistoryError> {
    let kind = fs::symlink_metadata(from)?.file_type();
    if kind.is_symlink() {
        // Following one is the one way a copy inside the folder ends up outside
        // it, which is the rule `Folders::list` is held to as well.
        return Ok(());
    }
    if kind.is_file() {
        if let Some(folder) = into.parent() {
            fs::create_dir_all(folder)?;
        }
        fs::copy(from, into)?;
        return Ok(());
    }
    if !kind.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(into)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        copy_across(&entry.path(), &into.join(entry.file_name()))?;
    }
    Ok(())
}

/// Every draft standing for the folder at `root`, read out of the repository
/// keeping it. A worktree somebody made themselves is not one of these: a draft
/// is named by its ulid and is under this app's own data.
pub fn standing(folders: &Folders, root: &str) -> Result<Vec<Draft>, HistoryError> {
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    let repo = kept.repo();
    let prefix = prefix_of(repo, &opened);
    let under = folders.drafts_path();
    let mut held = Vec::new();
    for name in repo.worktrees()?.iter().flatten() {
        let Ok(id) = draft_id(name) else { continue };
        let Ok(worktree) = repo.find_worktree(name) else {
            continue;
        };
        let root = settled(worktree.path());
        if !root.starts_with(&under) || worktree.validate().is_err() {
            continue;
        }
        let branch = format!("{BRANCH_PREFIX}{id}");
        let Ok(from) = forked_from(repo, &branch) else {
            continue;
        };
        held.push(Draft {
            id: id.to_owned(),
            vault: vault_in(&root, &prefix).to_string_lossy().into_owned(),
            root: root.to_string_lossy().into_owned(),
            branch,
            from,
        });
    }
    // A ulid sorts by when it was minted, so this is oldest first and reading
    // the same repository twice is one answer.
    held.sort_by(|one, other| one.id.cmp(&other.id));
    Ok(held)
}

/// A draft of the folder at `root`, taken from the version it was last kept at.
/// `id` is the ulid the page minted for it, which names both the copy and the
/// branch.
pub fn start(folders: &Folders, root: &str, id: &str) -> Result<Draft, HistoryError> {
    let id = draft_id(id)?;
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    let repo = kept.repo();
    let head = repo
        .head()
        .and_then(|held| held.peel_to_commit())
        .map_err(|_| HistoryError::new(NOTHING_KEPT))?;
    let branch = format!("{BRANCH_PREFIX}{id}");
    if repo.find_branch(&branch, BranchType::Local).is_ok() {
        return Err(HistoryError::new(ALREADY_THERE));
    }
    let at_head = repo.branch(&branch, &head, false)?;
    let into = folders.drafts_path().join(id);
    if let Some(folder) = into.parent() {
        fs::create_dir_all(folder)?;
    }
    let mut how = WorktreeAddOptions::new();
    how.reference(Some(at_head.get()));
    let made = match repo.worktree(id, &into, Some(&how)) {
        Ok(made) => made,
        Err(why) => {
            // A branch with no copy on it is a draft nothing lists and
            // nobody can reach.
            if let Ok(mut held) = repo.find_branch(&branch, BranchType::Local) {
                let _ = held.delete();
            }
            return Err(why.into());
        }
    };
    let root = settled(made.path());
    let prefix = prefix_of(repo, &opened);
    let vault = vault_in(&root, &prefix);
    carry_private(repo, &opened.join(SIDECAR), &vault.join(SIDECAR))?;
    Ok(Draft {
        id: id.to_owned(),
        vault: vault.to_string_lossy().into_owned(),
        root: root.to_string_lossy().into_owned(),
        branch,
        from: head.id().to_string(),
    })
}

/// The draft gone: the copy removed and the branch deleted, with nothing of
/// either left behind. A draft that is not there is not a failure.
pub fn discard(folders: &Folders, root: &str, id: &str) -> Result<(), HistoryError> {
    let id = draft_id(id)?;
    let opened = folders.opened(root)?;
    let kept = at(&opened)?;
    let repo = kept.repo();
    if let Ok(worktree) = repo.find_worktree(id) {
        let held = settled(worktree.path());
        let mut how = WorktreePruneOptions::new();
        how.valid(true).locked(true).working_tree(true);
        worktree.prune(Some(&mut how))?;
        if held.exists() {
            fs::remove_dir_all(&held)?;
        }
    }
    if let Ok(mut branch) = repo.find_branch(&format!("{BRANCH_PREFIX}{id}"), BranchType::Local) {
        branch.delete()?;
    }
    Ok(())
}

/// A copy is a checkout of every file the folder keeps, and letting one go
/// deletes the same, so neither runs on the thread the page is drawn on.
async fn off_the_page<T: Send + 'static>(
    act: impl FnOnce() -> Result<T, HistoryError> + Send + 'static,
) -> Result<T, HistoryError> {
    tauri::async_runtime::spawn_blocking(act)
        .await
        .map_err(|_| HistoryError::new(DIDNT_WORK))?
}

#[tauri::command]
pub async fn draft_standing<R: Runtime>(
    app: AppHandle<R>,
    root: String,
) -> Result<Vec<Draft>, HistoryError> {
    off_the_page(move || standing(&app.state::<Folders>(), &root)).await
}

#[tauri::command]
pub async fn draft_start<R: Runtime>(
    app: AppHandle<R>,
    root: String,
    id: String,
) -> Result<Draft, HistoryError> {
    off_the_page(move || start(&app.state::<Folders>(), &root, &id)).await
}

#[tauri::command]
pub async fn draft_discard<R: Runtime>(
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
    use crate::history::{
        branch, branch_at, branches, commit, delete_branch, graph, head, merge_in, read_at,
        switch_to,
    };

    const ID: &str = "01JAPART000000000000000000";
    const OTHER: &str = "01JAPART000000000000000001";

    /// A project with its notes inside it, one version kept, and the folders
    /// this app may reach — its own data among them.
    fn ready(name: &str) -> (Folders, crate::vault::Opened, crate::vault::Opened) {
        let (project, container) = project(name);
        beside_the_graph(&container.join(SIDECAR));
        write(&container, "notes/a.md", "one");
        made(&container, "A graph");
        let data = project.with_extension("data");
        let folders = Folders::new(data).expect("this app's own data");
        folders.pick(project.to_path_buf()).expect("the project");
        (folders, project, container)
    }

    fn said(root: &crate::vault::Opened) -> String {
        root.to_string_lossy().into_owned()
    }

    /// Opened the way every history command opens a folder — through
    /// `Folders`, which is what says this app may reach it.
    fn notes(folders: &Folders, at: &str) -> crate::vault::Opened {
        folders.opened(at).expect("the notes")
    }

    /// The version a branch is at, read out of the repository rather than out
    /// of what a person is shown, which leaves a draft's branch out.
    fn branch_head(root: &crate::vault::Opened, name: &str) -> Option<String> {
        let kept = at(root).expect("the repository");
        kept.repo()
            .find_branch(name, BranchType::Local)
            .ok()
            .and_then(|held| held.get().target())
            .map(|id| id.to_string())
    }

    #[test]
    fn a_draft_is_a_copy_of_the_project_with_the_notes_inside_it() {
        let (folders, _project, container) = ready("made");

        let draft = start(&folders, &said(&container), ID).expect("a draft");
        assert_eq!(draft.id, ID);
        assert_eq!(draft.branch, format!("{BRANCH_PREFIX}{ID}"));
        assert!(Path::new(&draft.root).join(".sloppy").is_dir());
        assert_eq!(
            Path::new(&draft.vault),
            Path::new(&draft.root).join(".sloppy")
        );
        assert_eq!(
            fs::read_to_string(Path::new(&draft.vault).join("notes/a.md")).expect("the note"),
            "one"
        );
    }

    #[test]
    fn it_carries_the_identity_the_folder_writes_under_and_nothing_the_history_keeps() {
        let (folders, _project, container) = ready("identity");
        // A file in the same folder that the history DOES keep, kept at one
        // version and then written again beside it.
        write(&container, ".sloppy/pictures.json", "{\"kept\":1}");
        made(&container, "A picture");
        write(&container, ".sloppy/pictures.json", "{\"since\":1}");
        write(&container, ".sloppy/identity.json", "{\"me\":1}");

        let draft = start(&folders, &said(&container), ID).expect("a draft");
        let sidecar = Path::new(&draft.vault).join(SIDECAR);
        assert_eq!(
            fs::read_to_string(sidecar.join("identity.json")).expect("the identity"),
            "{\"me\":1}"
        );
        assert!(sidecar.join("identity.key").exists());
        assert_eq!(
            fs::read_to_string(sidecar.join("pictures.json")).expect("the pictures"),
            "{\"kept\":1}"
        );
    }

    #[test]
    fn the_copy_s_notes_are_kept_by_the_repository_the_folder_s_are() {
        let (folders, _project, container) = ready("kept");
        let draft = start(&folders, &said(&container), ID).expect("a draft");

        let theirs = at(&folders.opened(&draft.vault).expect("the copy's notes"))
            .expect("the repository keeping them");
        let ours = at(&folders
            .opened(&said(&container))
            .expect("the folder's notes"))
        .expect("the repository keeping them");
        assert_eq!(
            settled(theirs.repo().commondir()),
            settled(ours.repo().commondir())
        );
        assert_eq!(
            theirs.repo().head().expect("the copy's head").shorthand(),
            Some(draft.branch.as_str())
        );
        assert!(!Path::new(&draft.vault).join(".git").exists());
    }

    #[test]
    fn a_draft_is_read_back_out_of_the_repository() {
        let (folders, _project, container) = ready("standing");
        let made = start(&folders, &said(&container), ID).expect("a draft");

        let held = standing(&folders, &said(&container)).expect("the drafts");
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].id, ID);
        assert_eq!(held[0].root, made.root);
        assert_eq!(held[0].vault, made.vault);
        assert_eq!(held[0].from, made.from);
    }

    #[test]
    fn a_draft_already_standing_is_not_started_over() {
        let (folders, _project, container) = ready("again");
        start(&folders, &said(&container), ID).expect("a draft");

        assert!(start(&folders, &said(&container), ID).is_err());
        // One per folder is the page's rule, kept by asking what is standing
        // before starting one; another ulid here is another copy, and both are
        // listed so neither is stranded.
        start(&folders, &said(&container), OTHER).expect("a second");
        let held = standing(&folders, &said(&container)).expect("both");
        assert_eq!(
            held.iter().map(|one| one.id.as_str()).collect::<Vec<_>>(),
            [ID, OTHER]
        );
        discard(&folders, &said(&container), OTHER).expect("the second gone");
        assert_eq!(standing(&folders, &said(&container)).expect("one").len(), 1);
    }

    #[test]
    fn discarding_leaves_nothing_of_either_half() {
        let (folders, _project, container) = ready("discarded");
        let draft = start(&folders, &said(&container), ID).expect("a draft");

        discard(&folders, &said(&container), ID).expect("it gone");
        assert!(!Path::new(&draft.root).exists());
        assert!(standing(&folders, &said(&container))
            .expect("the drafts")
            .is_empty());
        // Twice is not a failure.
        discard(&folders, &said(&container), ID).expect("nothing to do");
    }

    #[test]
    fn the_agent_works_in_the_copy_and_the_history_finds_its_notes_there() {
        let (folders, project, container) = ready("found");
        their_commit(&project, &["src/a.ts"], "Their code");
        write(&project, "src/b.ts", "beside it");
        let draft = start(&folders, &said(&container), ID).expect("a draft");

        // What `chat_open` hands the agent as the folder to work in: the
        // project as it was last kept, which is what the notes are about.
        let copy = notes(&folders, &draft.root);
        assert_eq!(copy.as_ref() as &Path, Path::new(&draft.root));
        assert_eq!(
            fs::read_to_string(copy.join("src/a.ts")).expect("the code"),
            "one"
        );
        assert!(!copy.join("src/b.ts").exists());

        let theirs = notes(&folders, &draft.vault);
        let ours = notes(&folders, &said(&container));
        assert_eq!(theirs.within(), Path::new(&draft.root));
        assert!(at(&theirs)
            .expect("the repository")
            .keeps_more_than_the_vault());
        assert_eq!(
            read_at(&theirs, "HEAD").expect("what the copy kept"),
            read_at(&ours, "HEAD").expect("what the folder kept")
        );
        assert_eq!(head(&theirs).expect("the copy's version"), Some(draft.from));
    }

    #[test]
    fn a_version_kept_in_the_copy_lands_on_its_branch_and_moves_nothing_else() {
        let (folders, _project, container) = ready("keeping");
        let draft = start(&folders, &said(&container), ID).expect("a draft");
        let data = PathBuf::from(folders.data_path());
        let theirs = notes(&folders, &draft.vault);
        let ours = notes(&folders, &said(&container));

        write(&theirs, "notes/b.md", "two");
        let kept = commit(&theirs, &data, "A second note")
            .expect("the version")
            .expect("a version");

        assert_eq!(branch_head(&ours, &draft.branch), Some(kept.id));
        assert!(read_at(&theirs, "HEAD")
            .expect("what the copy kept")
            .contains_key("notes/b.md"));
        assert_eq!(
            head(&ours).expect("the folder's version").as_deref(),
            Some(draft.from.as_str())
        );
        assert!(!container.join("notes/b.md").exists());
        assert!(!read_at(&ours, "HEAD")
            .expect("what the folder kept")
            .contains_key("notes/b.md"));

        // A review reads the draft against what it was taken from, and the
        // folder keeping a version of its own does not move that.
        write(&container, "notes/c.md", "three");
        made(&container, "A third note");
        let held = standing(&folders, &said(&container)).expect("the drafts");
        assert_eq!(held[0].from, draft.from);

        discard(&folders, &said(&container), ID).expect("the draft gone");
        assert_eq!(branch_head(&ours, &draft.branch), None);
        assert_eq!(
            fs::read_to_string(container.join("notes/a.md")).expect("the first note"),
            "one"
        );
    }

    #[test]
    fn the_folder_neither_shows_the_draft_s_branch_nor_acts_on_it() {
        let (folders, _project, container) = ready("unlisted");
        let draft = start(&folders, &said(&container), ID).expect("a draft");
        let data = PathBuf::from(folders.data_path());
        let ours = notes(&folders, &said(&container));
        let theirs = notes(&folders, &draft.vault);
        write(&theirs, "notes/b.md", "two");
        let kept = commit(&theirs, &data, "A second note")
            .expect("the version")
            .expect("a version");

        let listed: Vec<String> = branches(&ours)
            .expect("the branches")
            .into_iter()
            .map(|one| one.name)
            .collect();
        assert_eq!(listed, ["main"]);

        let drawn = graph(&ours, &data, 20, None).expect("the picture");
        assert!(drawn.commits.iter().all(|one| one.commit.id != kept.id));
        assert!(drawn
            .commits
            .iter()
            .all(|one| !one.refs.contains(&draft.branch)));

        assert!(switch_to(&ours, &draft.branch).is_err());
        assert!(merge_in(&ours, &data, &draft.branch).is_err());
        assert!(delete_branch(&ours, &draft.branch).is_err());
        let another = format!("{BRANCH_PREFIX}{OTHER}");
        assert!(branch(&ours, &another).is_err());
        assert!(branch_at(&ours, &another, &draft.from).is_err());

        assert_eq!(branch_head(&ours, &draft.branch), Some(kept.id));
        assert_eq!(branch_head(&ours, &another), None);
        assert_eq!(
            standing(&folders, &said(&container))
                .expect("the drafts")
                .len(),
            1
        );
        assert!(!container.join("notes/b.md").exists());
        assert_eq!(
            head(&ours).expect("the folder's version").as_deref(),
            Some(draft.from.as_str())
        );
    }

    #[test]
    fn a_copy_that_could_not_be_made_leaves_no_branch_behind() {
        let (folders, _project, container) = ready("half");
        let under = folders.drafts_path();
        fs::create_dir_all(&under).expect("where the copies go");
        fs::write(under.join(ID), "in the way").expect("a file where the copy would be");

        assert!(start(&folders, &said(&container), ID).is_err());
        let ours = notes(&folders, &said(&container));
        assert_eq!(branch_head(&ours, &format!("{BRANCH_PREFIX}{ID}")), None);
        assert!(standing(&folders, &said(&container))
            .expect("the drafts")
            .is_empty());
    }

    #[test]
    fn nothing_that_is_not_a_ulid_names_a_draft() {
        let (folders, _project, container) = ready("named");

        assert!(start(&folders, &said(&container), "../elsewhere").is_err());
        assert!(start(&folders, &said(&container), "main").is_err());
        assert!(discard(&folders, &said(&container), "../elsewhere").is_err());
    }
}
