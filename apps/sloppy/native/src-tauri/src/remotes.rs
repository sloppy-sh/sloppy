//! The commands behind the remote half of `History` in `@sloppy/local`, which
//! declares every act and what its answer means —
//! docs/ARCHITECTURE.md § "The vault's history" names each one and what it is
//! handed.
//!
//! A credential is never held here: the page reads it and passes it per call,
//! so this shell keeps no secret of anybody's.

use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use git2::build::RepoBuilder;
use git2::{
    BranchType, Cred, CredentialType, ErrorClass, ErrorCode, FetchOptions, Oid, PushOptions,
    RemoteCallbacks, Repository,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::history::{self, HistoryError, Kept, Merged};
use crate::signing::SshKey;
use crate::vault::{Folders, Opened};

/// The remote an act with none named is with, where the branch follows nothing
/// and this folder has more than one.
const DEFAULT_REMOTE: &str = "origin";

/// Where a host takes a name and nothing else says which.
const DEFAULT_USER: &str = "git";

/// `Credential` in `@sloppy/local`. It arrives with the act that needs it and
/// is gone when that act is over.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Credential {
    Token {
        username: Option<String>,
        token: String,
    },
    Ssh {
        key: SshKey,
    },
}

/// `Remote` in `@sloppy/local`.
#[derive(Debug, Serialize)]
pub struct Remote {
    pub(crate) name: String,
    pub(crate) url: String,
}

fn nothing_called(name: &str) -> HistoryError {
    HistoryError::new(format!("There is nothing here called {name}."))
}

fn already_called(name: &str) -> HistoryError {
    HistoryError::new(format!("There is already one called {name}."))
}

fn pull_first() -> HistoryError {
    HistoryError::new("Pull first, then push again.")
}

fn nowhere() -> HistoryError {
    HistoryError::new("There is nothing at that address. Check it and try again.")
}

fn turned_away() -> HistoryError {
    HistoryError::new(
        "That address would not let Sloppy in. Check the token or key it was given and try again.",
    )
}

/// What a person is told when an act over the wire did not go through. Which
/// call failed and what the library called it is this file's business; what
/// they can do about it is theirs.
fn tripped(error: git2::Error, asked: &Asked) -> HistoryError {
    match (error.code(), error.class()) {
        (ErrorCode::Auth | ErrorCode::Certificate, _) => turned_away(),
        (ErrorCode::NotFastForward, _) => pull_first(),
        // A host that asked this device who it was is a host that is there. So
        // where the way in ran out, or where what went wrong after the asking
        // was the host's own answer, the credential is what to look at and the
        // address is not.
        _ if asked.ran_out() => turned_away(),
        (_, ErrorClass::Http | ErrorClass::Ssh) if asked.happened() => turned_away(),
        (ErrorCode::NotFound, _)
        | (_, ErrorClass::Net | ErrorClass::Os | ErrorClass::Ssh | ErrorClass::Http) => nowhere(),
        _ => error.into(),
    }
}

/// How far a host's asking who is there got. A callback's own refusal reaches
/// the caller as a library error with no class on it, so what the asking came
/// to is kept here rather than read back off that error.
#[derive(Clone, Copy, Default, PartialEq)]
enum Asking {
    #[default]
    Never,
    Answered,
    RanOut,
}

#[derive(Clone, Default)]
struct Asked(Rc<Cell<Asking>>);

impl Asked {
    fn happened(&self) -> bool {
        self.0.get() != Asking::Never
    }

    fn ran_out(&self) -> bool {
        self.0.get() == Asking::RanOut
    }

    fn answered(&self) {
        self.0.set(Asking::Answered);
    }

    /// Nothing more to offer, and the sentence libgit2 carries back for it —
    /// which a person never sees, because `tripped` says it in their words.
    fn ran_dry(&self, said: &str) -> git2::Error {
        self.0.set(Asking::RanOut);
        git2::Error::from_str(said)
    }
}

/// How this device answers a host that asks who is there. Nothing is
/// remembered between two acts: what is here came in with the call.
fn asked_for<'a>(
    credential: Option<&'a Credential>,
    data: &'a Path,
    asked: &Asked,
) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    let asked = asked.clone();
    callbacks.credentials(move |_url, from_url, allowed| {
        let user = from_url.unwrap_or(DEFAULT_USER);
        // A host takes the name on its own first, which is not yet it asking
        // for a way in.
        if allowed.contains(CredentialType::USERNAME) {
            return Cred::username(user);
        }
        if asked.happened() {
            // Asking again for what it was just given is a host turning that
            // down, and the same answer twice is a loop rather than a way in.
            return Err(asked.ran_dry("what this was given was turned down"));
        }
        let offer = match credential {
            Some(Credential::Token { username, token })
                if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) =>
            {
                Cred::userpass_plaintext(username.as_deref().unwrap_or(user), token)
            }
            Some(Credential::Ssh { key }) if allowed.contains(CredentialType::SSH_KEY) => {
                let (private, public) = key_files(key, data);
                Cred::ssh_key(user, public.as_deref(), &private, None)
            }
            _ if allowed.contains(CredentialType::DEFAULT) => Cred::default(),
            _ => return Err(asked.ran_dry("nothing to offer")),
        };
        asked.answered();
        offer
    });
    callbacks
}

/// The two halves of the key an act reaches a host with: the one this app
/// keeps, or one already on the device that a person named.
fn key_files(key: &SshKey, data: &Path) -> (PathBuf, Option<PathBuf>) {
    match key {
        SshKey::Kept => {
            let (private, public) = crate::signing::kept_at(data);
            (private, Some(public))
        }
        SshKey::File { path } => {
            let (private, public) = crate::signing::halves(Path::new(path));
            (private, public.exists().then_some(public))
        }
    }
}

pub fn list(vault: &Opened) -> Result<Vec<Remote>, HistoryError> {
    let kept = history::at(vault)?;
    let repo = kept.repo();
    let mut held = Vec::new();
    for name in repo.remotes()?.iter().flatten() {
        let Ok(remote) = repo.find_remote(name) else {
            continue;
        };
        held.push(Remote {
            name: name.to_owned(),
            url: remote.url().unwrap_or_default().to_owned(),
        });
    }
    Ok(held)
}

pub fn add(vault: &Opened, name: &str, url: &str) -> Result<(), HistoryError> {
    let kept = history::at(vault)?;
    let repo = kept.repo();
    if repo.find_remote(name).is_ok() {
        return Err(already_called(name));
    }
    repo.remote(name, url)
        .map_err(|_| HistoryError::new(format!("{name} will not work as a name. Try another.")))?;
    Ok(())
}

pub fn rename(vault: &Opened, name: &str, to: &str) -> Result<(), HistoryError> {
    let kept = history::at(vault)?;
    let repo = kept.repo();
    if repo.find_remote(name).is_err() {
        return Err(nothing_called(name));
    }
    if repo.find_remote(to).is_ok() {
        return Err(already_called(to));
    }
    repo.remote_rename(name, to)
        .map_err(|_| HistoryError::new(format!("{to} will not work as a name. Try another.")))?;
    Ok(())
}

pub fn set_url(vault: &Opened, name: &str, url: &str) -> Result<(), HistoryError> {
    let kept = history::at(vault)?;
    let repo = kept.repo();
    if repo.find_remote(name).is_err() {
        return Err(nothing_called(name));
    }
    repo.remote_set_url(name, url)?;
    Ok(())
}

pub fn remove(vault: &Opened, name: &str) -> Result<(), HistoryError> {
    let kept = history::at(vault)?;
    let repo = kept.repo();
    if repo.find_remote(name).is_err() {
        return Err(nothing_called(name));
    }
    repo.remote_delete(name)?;
    Ok(())
}

pub fn fetch(
    vault: &Opened,
    data: &Path,
    name: &str,
    credential: Option<&Credential>,
) -> Result<(), HistoryError> {
    take_from(history::at(vault)?.repo(), name, data, credential)
}

fn take_from(
    repo: &Repository,
    name: &str,
    data: &Path,
    credential: Option<&Credential>,
) -> Result<(), HistoryError> {
    let mut remote = repo.find_remote(name).map_err(|_| nothing_called(name))?;
    let asked = Asked::default();
    let mut how = FetchOptions::new();
    how.remote_callbacks(asked_for(credential, data, &asked));
    let nothing: [&str; 0] = [];
    remote
        .fetch(&nothing, Some(&mut how), None)
        .map_err(|error| tripped(error, &asked))
}

pub fn pull(
    vault: &Opened,
    data: &Path,
    named: Option<&str>,
    credential: Option<&Credential>,
) -> Result<Merged, HistoryError> {
    let mut kept = history::at(vault)?;
    let repo = kept.repo();
    let branch = history::on(repo)?.ok_or_else(off_a_branch)?;
    let name = which(repo, &branch, named)?;
    take_from(repo, &name, data, credential)?;

    if history::head_commit(repo)?.is_none() {
        let Some(tracking) = arriving(repo, &name, &branch) else {
            return Ok(Merged::whole());
        };
        let Some(theirs) = head_of(repo, &tracking) else {
            return Ok(Merged::whole());
        };
        let taken = theirs_in(&tracking, &name).to_owned();
        history::lay(&kept, theirs)?;
        repo.reference(
            &format!("refs/heads/{taken}"),
            theirs,
            true,
            &format!("pull {tracking}"),
        )?;
        repo.set_head(&format!("refs/heads/{taken}"))?;
        follow(repo, &taken, &tracking)?;
        return Ok(Merged::whole());
    }

    let tracking = tracked(repo, &branch, &name);
    let Some(theirs) = head_of(repo, &tracking) else {
        return Ok(Merged::whole());
    };
    history::merge_commit(&mut kept, vault, data, theirs, &tracking)
}

pub fn push(
    vault: &Opened,
    data: &Path,
    named: Option<&str>,
    credential: Option<&Credential>,
) -> Result<(), HistoryError> {
    let kept = history::at(vault)?;
    let repo = kept.repo();
    let branch = history::on(repo)?.ok_or_else(off_a_branch)?;
    let Some(mine) = history::head_commit(repo)?.map(|held| held.id()) else {
        return Err(HistoryError::new(
            "There is nothing here to keep somewhere else yet. Commit what is in this folder first.",
        ));
    };
    let name = which(repo, &branch, named)?;
    let mut remote = repo.find_remote(&name).map_err(|_| nothing_called(&name))?;

    // What the remote has that this branch has not taken in would be written
    // over, and the side holding it is the side that says so.
    let refused: Cell<Option<String>> = Cell::new(None);
    let tracking = tracked(repo, &branch, &name);
    let want = format!("refs/heads/{branch}");
    let onto = format!("refs/heads/{}", theirs_in(&tracking, &name));
    let asked = Asked::default();
    let mut how = PushOptions::new();
    let mut callbacks = asked_for(credential, data, &asked);
    callbacks.push_update_reference(|_reference, status| {
        refused.set(status.map(str::to_owned));
        Ok(())
    });
    how.remote_callbacks(callbacks);
    remote
        .push(&[format!("{want}:{onto}")], Some(&mut how))
        .map_err(|error| tripped(error, &asked))?;
    if let Some(said) = refused.take() {
        return Err(turned_down(&said));
    }

    repo.reference(
        &format!("refs/remotes/{tracking}"),
        mine,
        true,
        &format!("push {tracking}"),
    )?;
    follow(repo, &branch, &tracking)?;
    Ok(())
}

/// A copy of what is kept somewhere else, in a folder a person chose. A folder
/// that is not here yet has no history to ask, which is why this is `Files`'.
pub fn clone_into(
    url: &str,
    into: &Path,
    data: &Path,
    credential: Option<&Credential>,
) -> Result<(), HistoryError> {
    let holding = fs::read_dir(into).map(Iterator::count).unwrap_or(0);
    if holding > 0 {
        return Err(HistoryError::new(
            "There is already something in that folder. Choose an empty one.",
        ));
    }
    let asked = Asked::default();
    let mut how = FetchOptions::new();
    how.remote_callbacks(asked_for(credential, data, &asked));
    let repo = RepoBuilder::new()
        .fetch_options(how)
        .clone(url, into)
        .map_err(|error| tripped(error, &asked))?;
    history::keep_out(&Kept::whole(repo, into))?;
    Ok(())
}

/// A remote that would not take a push. The one thing every host refuses for
/// the same reason is a branch it has commits on that this one has not taken
/// in; anything else is that host's own rule, and what it said about it is
/// written for somebody reading a terminal rather than for the person here.
fn turned_down(said: &str) -> HistoryError {
    if said.contains("fast") || said.contains("behind") {
        return pull_first();
    }
    HistoryError::new(
        "That address would not take these versions. Check that what Sloppy was given may write there.",
    )
}

fn off_a_branch() -> HistoryError {
    HistoryError::new("This folder is not on a branch, so there is nothing to keep in step.")
}

/// Which remote an act with none named is with: the one the branch follows,
/// else the only one there is, else the one a first push makes.
fn which(repo: &Repository, branch: &str, named: Option<&str>) -> Result<String, HistoryError> {
    let known: Vec<String> = repo
        .remotes()?
        .iter()
        .flatten()
        .map(str::to_owned)
        .collect();
    let followed = repo
        .branch_upstream_remote(&format!("refs/heads/{branch}"))
        .ok()
        .and_then(|held| std::str::from_utf8(&held).ok().map(str::to_owned));
    let only = (known.len() == 1).then(|| known[0].clone());
    let name = named
        .map(str::to_owned)
        .or(followed)
        .or(only)
        .unwrap_or_else(|| DEFAULT_REMOTE.to_owned());
    if !known.contains(&name) {
        return Err(nothing_called(&name));
    }
    Ok(name)
}

/// The branch on a remote that a local one takes from and writes back to: the
/// one it follows where it follows one of that remote's, else the one there of
/// the same name. Somebody else's git points a branch wherever they like, and
/// this folder is as often one of theirs as one this app started.
fn tracked(repo: &Repository, branch: &str, remote: &str) -> String {
    let here = format!("{remote}/");
    repo.branch_upstream_name(&format!("refs/heads/{branch}"))
        .ok()
        .and_then(|held| std::str::from_utf8(&held).map(str::to_owned).ok())
        .and_then(|followed| followed.strip_prefix("refs/remotes/").map(str::to_owned))
        .filter(|followed| followed.starts_with(&here))
        .unwrap_or_else(|| format!("{here}{branch}"))
}

/// What the remote calls the branch, out of what this folder calls it there.
fn theirs_in<'a>(tracking: &'a str, remote: &str) -> &'a str {
    &tracking[remote.len() + 1..]
}

fn head_of(repo: &Repository, tracking: &str) -> Option<Oid> {
    repo.find_branch(tracking, BranchType::Remote)
        .ok()
        .and_then(|held| held.get().target())
}

/// Which of a remote's branches a folder with no commits in it takes: the one
/// it is already on if that remote has it, the one most folders start on, or
/// the only one there is.
fn arriving(repo: &Repository, remote: &str, branch: &str) -> Option<String> {
    let here = format!("{remote}/{branch}");
    let mut held = Vec::new();
    for found in repo.branches(Some(BranchType::Remote)).ok()? {
        let Ok((one, _)) = found else { continue };
        let Ok(Some(name)) = one.name() else { continue };
        if name == here {
            return Some(here);
        }
        if name.starts_with(&format!("{remote}/")) && !name.ends_with("/HEAD") {
            held.push(name.to_owned());
        }
    }
    for usual in ["main", "master"] {
        let name = format!("{remote}/{usual}");
        if held.contains(&name) {
            return Some(name);
        }
    }
    (held.len() == 1).then(|| held[0].clone())
}

/// The branch follows what it was just kept in step with, where it followed
/// nothing until now.
fn follow(repo: &Repository, branch: &str, tracking: &str) -> Result<(), HistoryError> {
    let mut held = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|_| nothing_called(branch))?;
    if held.upstream().is_ok() {
        return Ok(());
    }
    held.set_upstream(Some(tracking))?;
    Ok(())
}

fn opened(folders: &State<'_, Folders>, root: &str) -> Result<Opened, HistoryError> {
    Ok(folders.opened(root)?)
}

fn private(folders: &State<'_, Folders>) -> PathBuf {
    PathBuf::from(folders.data_path())
}

#[tauri::command]
pub fn history_remotes(
    folders: State<'_, Folders>,
    root: String,
) -> Result<Vec<Remote>, HistoryError> {
    list(&opened(&folders, &root)?)
}

#[tauri::command]
pub fn history_add_remote(
    folders: State<'_, Folders>,
    root: String,
    name: String,
    url: String,
) -> Result<(), HistoryError> {
    add(&opened(&folders, &root)?, &name, &url)
}

#[tauri::command]
pub fn history_rename_remote(
    folders: State<'_, Folders>,
    root: String,
    name: String,
    to: String,
) -> Result<(), HistoryError> {
    rename(&opened(&folders, &root)?, &name, &to)
}

#[tauri::command]
pub fn history_set_remote_url(
    folders: State<'_, Folders>,
    root: String,
    name: String,
    url: String,
) -> Result<(), HistoryError> {
    set_url(&opened(&folders, &root)?, &name, &url)
}

#[tauri::command]
pub fn history_remove_remote(
    folders: State<'_, Folders>,
    root: String,
    name: String,
) -> Result<(), HistoryError> {
    remove(&opened(&folders, &root)?, &name)
}

#[tauri::command]
pub fn history_fetch(
    folders: State<'_, Folders>,
    root: String,
    remote: String,
    credential: Option<Credential>,
) -> Result<(), HistoryError> {
    fetch(
        &opened(&folders, &root)?,
        &private(&folders),
        &remote,
        credential.as_ref(),
    )
}

#[tauri::command]
pub fn history_pull(
    folders: State<'_, Folders>,
    root: String,
    remote: Option<String>,
    credential: Option<Credential>,
) -> Result<Merged, HistoryError> {
    pull(
        &opened(&folders, &root)?,
        &private(&folders),
        remote.as_deref(),
        credential.as_ref(),
    )
}

#[tauri::command]
pub fn history_push(
    folders: State<'_, Folders>,
    root: String,
    remote: Option<String>,
    credential: Option<Credential>,
) -> Result<(), HistoryError> {
    push(
        &opened(&folders, &root)?,
        &private(&folders),
        remote.as_deref(),
        credential.as_ref(),
    )
}

#[tauri::command]
pub fn files_clone(
    folders: State<'_, Folders>,
    url: String,
    into: String,
    credential: Option<Credential>,
) -> Result<(), HistoryError> {
    clone_into(
        &url,
        &opened(&folders, &into)?,
        &private(&folders),
        credential.as_ref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::tests::{beside_the_graph, made, private_for, read, scratch, vault, write};

    /// Somewhere else a folder is kept: a repository with no folder of its own,
    /// which is what a host holds.
    fn elsewhere(name: &str) -> (Opened, String) {
        let at = scratch(name);
        let held = Repository::init_bare(&at).expect("a place to keep it");
        // What a host answers with when somebody asks it for a copy, and what
        // this app's own folders are on.
        held.set_head("refs/heads/main").expect("what it is on");
        let url = at.to_string_lossy().into_owned();
        (at, url)
    }

    fn head_there(at: &Path, branch: &str) -> Option<String> {
        Repository::open_bare(at)
            .ok()?
            .find_reference(&format!("refs/heads/{branch}"))
            .ok()?
            .target()
            .map(|id| id.to_string())
    }

    #[test]
    fn a_remote_is_added_pointed_elsewhere_renamed_and_taken_away() {
        let root = vault();
        let (_, url) = elsewhere("host");
        assert!(list(&root).expect("the remotes").is_empty());

        add(&root, "origin", &url).expect("the remote");
        assert_eq!(
            add(&root, "origin", &url).unwrap_err().said(),
            "There is already one called origin."
        );
        let held = list(&root).expect("the remotes");
        assert_eq!(held.len(), 1);
        assert_eq!(
            (held[0].name.as_str(), held[0].url.as_str()),
            ("origin", url.as_str())
        );

        let (_, moved) = elsewhere("moved");
        set_url(&root, "origin", &moved).expect("the address");
        assert_eq!(list(&root).expect("the remotes")[0].url, moved);

        rename(&root, "origin", "mine").expect("the name");
        assert_eq!(list(&root).expect("the remotes")[0].name, "mine");
        for said in [
            set_url(&root, "origin", &moved).unwrap_err(),
            rename(&root, "origin", "yours").unwrap_err(),
            remove(&root, "origin").unwrap_err(),
            fetch(&root, &private_for(&root), "origin", None).unwrap_err(),
        ] {
            assert_eq!(said.said(), "There is nothing here called origin.");
        }

        remove(&root, "mine").expect("it goes");
        assert!(list(&root).expect("the remotes").is_empty());
    }

    #[test]
    fn a_first_push_puts_the_branch_where_the_remote_keeps_it_and_follows_it_after() {
        let root = vault();
        let data = private_for(&root);
        let (there, url) = elsewhere("host");

        assert_eq!(
            push(&root, &data, None, None).unwrap_err().said(),
            "There is nothing here to keep somewhere else yet. Commit what is in this folder first."
        );
        let first = made(&root, "A graph");
        assert_eq!(
            push(&root, &data, None, None).unwrap_err().said(),
            "There is nothing here called origin."
        );

        add(&root, "origin", &url).expect("the remote");
        push(&root, &data, None, None).expect("the push");
        assert_eq!(
            head_there(&there, "main").as_deref(),
            Some(first.id.as_str())
        );

        let held = crate::history::status(&root).expect("the status");
        assert_eq!(held.upstream.as_deref(), Some("origin/main"));
        assert_eq!((held.ahead, held.behind), (0, 0));

        let branches = crate::history::branches(&root).expect("the branches");
        let here = branches
            .iter()
            .find(|one| one.name == "main")
            .expect("main");
        assert_eq!(here.upstream.as_deref(), Some("origin/main"));
        assert_eq!((here.ahead, here.behind), (Some(0), Some(0)));
        assert!(here.remote.is_none());
        let theirs = branches
            .iter()
            .find(|one| one.name == "origin/main")
            .expect("what the remote has");
        assert_eq!(theirs.remote.as_deref(), Some("origin"));
        assert_eq!(theirs.head, first.id);
        assert!(theirs.upstream.is_none() && theirs.ahead.is_none());

        // A second push with nothing new in it is not a refusal.
        push(&root, &data, None, None).expect("nothing to add");
    }

    #[test]
    fn what_this_device_knows_about_itself_stays_out_of_what_is_pushed() {
        let root = vault();
        let data = private_for(&root);
        beside_the_graph(&root);
        write(&root, "notes/a.md", "one");
        made(&root, "A graph");

        let (there, url) = elsewhere("host");
        add(&root, "origin", &url).expect("the remote");
        push(&root, &data, None, None).expect("the push");

        let kept: Vec<String> = crate::history::read_at(&Opened::own(&there), "refs/heads/main")
            .expect("what is kept there")
            .keys()
            .cloned()
            .collect();
        assert!(kept.contains(&"notes/a.md".to_owned()));
        for one in [
            "identity.json",
            "identity.key",
            "sloppy-identity.json",
            "credentials.json",
            "git.json",
            "signing.key",
            ".sloppy/bin.json",
            ".sloppy/bin/note.md",
        ] {
            assert!(!kept.contains(&one.to_owned()), "{one} left the device");
        }
    }

    #[test]
    fn a_copy_of_what_is_kept_somewhere_else_writes_back_to_it_and_is_kept_in_step() {
        let root = vault();
        let data = private_for(&root);
        write(&root, "notes/a.md", "one");
        made(&root, "A graph");
        let (_, url) = elsewhere("host");
        add(&root, "origin", &url).expect("the remote");
        push(&root, &data, None, None).expect("the push");

        let copy = scratch("copy");
        clone_into(&url, &copy, &data, None).expect("the copy");
        assert_eq!(read(&copy, "notes/a.md"), "one");
        let held = crate::history::status(&copy).expect("the status");
        assert_eq!(held.branch.as_deref(), Some("main"));
        assert_eq!(held.upstream.as_deref(), Some("origin/main"));
        assert!(held.changed.is_empty() && held.untracked.is_empty());
        assert_eq!(
            clone_into(&url, &copy, &data, None).unwrap_err().said(),
            "There is already something in that folder. Choose an empty one."
        );

        write(&copy, "notes/b.md", "two");
        made(&copy, "Their note");
        push(&copy, &private_for(&copy), None, None).expect("their push");

        write(&root, "notes/a.md", "one, changed");
        made(&root, "My note");
        assert_eq!(
            push(&root, &data, None, None).unwrap_err().said(),
            "Pull first, then push again."
        );

        let held = pull(&root, &data, None, None).expect("the pull");
        assert!(held.merged);
        assert_eq!(read(&root, "notes/b.md"), "two");
        assert_eq!(read(&root, "notes/a.md"), "one, changed");
        push(&root, &data, None, None).expect("the push");
        let held = crate::history::status(&root).expect("the status");
        assert_eq!((held.ahead, held.behind), (0, 0));

        // And what the copy has not taken in yet is what it is behind by.
        crate::history::status(&copy).expect("the status");
        fetch(&copy, &private_for(&copy), "origin", None).expect("the fetch");
        let held = crate::history::status(&copy).expect("the status");
        assert_eq!(held.ahead, 0);
        assert_eq!(held.behind, 2);
        assert_eq!(read(&copy, "notes/a.md"), "one");
    }

    #[test]
    fn a_folder_with_nothing_in_it_takes_what_the_remote_has_whole() {
        let root = vault();
        let data = private_for(&root);
        write(&root, "notes/a.md", "one");
        made(&root, "A graph");
        let (there, url) = elsewhere("host");
        add(&root, "origin", &url).expect("the remote");
        push(&root, &data, None, None).expect("the push");

        let empty = scratch("empty");
        add(&empty, "origin", &url).expect("the remote");
        let held = pull(&empty, &private_for(&empty), None, None).expect("the pull");
        assert!(held.merged);
        assert_eq!(read(&empty, "notes/a.md"), "one");
        let held = crate::history::status(&empty).expect("the status");
        assert_eq!(held.branch.as_deref(), Some("main"));
        assert_eq!(held.upstream.as_deref(), Some("origin/main"));
        assert!(held.changed.is_empty() && held.untracked.is_empty());

        // A remote that calls its branch something else is still taken whole.
        let kept = Repository::open_bare(&there).expect("what is kept there");
        kept.find_reference("refs/heads/main")
            .expect("their branch")
            .rename("refs/heads/trunk", true, "renamed")
            .expect("the name they use");
        let second = scratch("second");
        add(&second, "origin", &url).expect("the remote");
        assert!(
            pull(&second, &private_for(&second), None, None)
                .expect("the pull")
                .merged
        );
        assert_eq!(read(&second, "notes/a.md"), "one");
        assert_eq!(
            crate::history::status(&second)
                .expect("the status")
                .branch
                .as_deref(),
            Some("trunk")
        );
    }

    #[test]
    fn what_a_remote_has_is_taken_without_touching_the_folder() {
        let root = vault();
        let data = private_for(&root);
        write(&root, "notes/a.md", "one");
        made(&root, "A graph");
        let (_, url) = elsewhere("host");
        add(&root, "origin", &url).expect("the remote");
        push(&root, &data, None, None).expect("the push");

        let copy = scratch("copy");
        clone_into(&url, &copy, &data, None).expect("the copy");
        write(&copy, "notes/b.md", "two");
        let theirs = made(&copy, "Their note");
        push(&copy, &private_for(&copy), None, None).expect("their push");

        fetch(&root, &data, "origin", None).expect("the fetch");
        assert!(!root.join("notes/b.md").exists());
        assert_eq!(crate::history::status(&root).expect("the status").behind, 1);
        let drawn = crate::history::graph(&root, &data, 10, None).expect("the picture");
        let held = drawn
            .commits
            .iter()
            .find(|one| one.commit.id == theirs.id)
            .expect("what the remote had");
        assert_eq!(held.refs, vec!["origin/main".to_owned()]);
    }

    /// Somebody else's git points a branch at whichever of a host's branches
    /// they like, and a folder set up that way is one this app opens.
    #[test]
    fn a_branch_following_one_of_another_name_takes_from_it_and_writes_back_to_it() {
        let root = vault();
        let data = private_for(&root);
        write(&root, "notes/a.md", "one");
        made(&root, "A graph");
        let (there, url) = elsewhere("host");
        add(&root, "origin", &url).expect("the remote");
        push(&root, &data, None, None).expect("the push");

        let copy = scratch("copy");
        clone_into(&url, &copy, &data, None).expect("the copy");
        {
            let repo = Repository::open(&copy).expect("the repository");
            let at = repo
                .head()
                .expect("the branch")
                .peel_to_commit()
                .expect("a commit");
            repo.branch("my-notes", &at, false)
                .expect("their branch")
                .set_upstream(Some("origin/main"))
                .expect("what it follows");
            repo.set_head("refs/heads/my-notes").expect("what it is on");
        }

        write(&root, "notes/b.md", "two");
        made(&root, "My note");
        push(&root, &data, None, None).expect("the push");

        assert!(
            pull(&copy, &private_for(&copy), None, None)
                .expect("the pull")
                .merged
        );
        assert_eq!(read(&copy, "notes/b.md"), "two");
        assert_eq!(crate::history::status(&copy).expect("the status").behind, 0);

        write(&copy, "notes/c.md", "three");
        let theirs = made(&copy, "Their note");
        push(&copy, &private_for(&copy), None, None).expect("their push");
        assert_eq!(
            head_there(&there, "main").as_deref(),
            Some(theirs.id.as_str())
        );
        assert!(head_there(&there, "my-notes").is_none());
    }

    /// A host that answers every request by asking who is there — which is
    /// what one taking a name and a token does until it is given the right
    /// one.
    fn asking_who_is_there() -> String {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listening = TcpListener::bind("127.0.0.1:0").expect("a port");
        let at = listening.local_addr().expect("the port").to_string();
        std::thread::spawn(move || {
            for held in listening.incoming() {
                let Ok(mut stream) = held else { continue };
                let Ok(same) = stream.try_clone() else {
                    continue;
                };
                let mut asking = BufReader::new(same);
                let mut line = String::new();
                while asking.read_line(&mut line).unwrap_or(0) > 0 {
                    if line.trim().is_empty() {
                        break;
                    }
                    line.clear();
                }
                let _ = stream.write_all(
                    b"HTTP/1.1 401 Unauthorized\r\n\
                      WWW-Authenticate: Basic realm=\"notes\"\r\n\
                      Content-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        });
        at
    }

    /// A branch follows one of another name because a config says so, whoever
    /// wrote that config — nothing here matches them up by name.
    #[test]
    fn a_branch_that_follows_by_config_writes_back_to_what_it_follows_and_takes_from_it() {
        let root = vault();
        let data = private_for(&root);
        write(&root, "notes/a.md", "one");
        let first = made(&root, "A graph");
        let (there, url) = elsewhere("host");
        add(&root, "origin", &url).expect("the remote");
        push(&root, &data, None, None).expect("the push");
        {
            let kept = Repository::open_bare(&there).expect("what is kept there");
            kept.reference(
                "refs/heads/trunk",
                Oid::from_str(&first.id).unwrap(),
                true,
                "theirs",
            )
            .expect("the branch they keep beside it");
        }

        let sender = follows_trunk("sender", &url);
        write(&sender, "notes/b.md", "two");
        let theirs = made(&sender, "Their note");
        push(&sender, &private_for(&sender), None, None).expect("their push");
        assert_eq!(
            head_there(&there, "trunk").as_deref(),
            Some(theirs.id.as_str())
        );
        assert_eq!(
            head_there(&there, "main").as_deref(),
            Some(first.id.as_str())
        );

        let taker = follows_trunk("taker", &url);
        assert!(
            pull(&taker, &private_for(&taker), None, None)
                .expect("the pull")
                .merged
        );
        assert_eq!(read(&taker, "notes/b.md"), "two");
    }

    /// A copy whose branch is pointed at the one the host calls `trunk`, the
    /// way somebody's own git would write it.
    fn follows_trunk(name: &str, url: &str) -> Opened {
        let at = scratch(name);
        clone_into(url, &at, &private_for(&at), None).expect("the copy");
        let repo = Repository::open(&at).expect("the repository");
        repo.config()
            .expect("the config")
            .open_level(git2::ConfigLevel::Local)
            .expect("its own")
            .set_str("branch.main.merge", "refs/heads/trunk")
            .expect("what it follows");
        at
    }

    /// What a host would not take is said in words a person can act on, and
    /// never in the host's own — those are written for a terminal.
    #[test]
    fn a_push_a_host_refuses_says_what_to_do_rather_than_what_it_said() {
        assert_eq!(
            turned_down("non-fast-forward").said(),
            "Pull first, then push again."
        );
        let said = turned_down("pre-receive hook declined: refs/heads/main is protected");
        assert_eq!(
            said.said(),
            "That address would not take these versions. Check that what Sloppy was given may write there."
        );
    }

    /// A host that is there and will not take what it was given is a different
    /// thing from an address with nothing at it, and a person is told which.
    #[test]
    fn a_host_that_turns_this_away_says_to_look_at_the_token_or_key() {
        let root = vault();
        let data = private_for(&root);
        made(&root, "A graph");
        let url = format!("http://{}/notes.git", asking_who_is_there());
        add(&root, "origin", &url).expect("the remote");

        let wrong = Credential::Token {
            username: Some("ada".to_owned()),
            token: "not the one".to_owned(),
        };
        for said in [
            fetch(&root, &data, "origin", None).unwrap_err(),
            fetch(&root, &data, "origin", Some(&wrong)).unwrap_err(),
            push(&root, &data, None, None).unwrap_err(),
            push(&root, &data, None, Some(&wrong)).unwrap_err(),
            pull(&root, &data, None, Some(&wrong)).unwrap_err(),
            clone_into(&url, &scratch("hopeful"), &data, Some(&wrong)).unwrap_err(),
        ] {
            assert_eq!(
                said.said(),
                "That address would not let Sloppy in. Check the token or key it was given and try again."
            );
        }
    }

    #[test]
    fn an_address_with_nothing_at_it_says_so() {
        let root = vault();
        let data = private_for(&root);
        made(&root, "A graph");
        let nowhere = scratch("nowhere").join("not-there");
        let url = nowhere.to_string_lossy().into_owned();
        add(&root, "origin", &url).expect("the remote");

        assert_eq!(
            fetch(&root, &data, "origin", None).unwrap_err().said(),
            "There is nothing at that address. Check it and try again."
        );
        assert_eq!(
            push(&root, &data, None, None).unwrap_err().said(),
            "There is nothing at that address. Check it and try again."
        );
        assert_eq!(
            pull(&root, &data, None, None).unwrap_err().said(),
            "There is nothing at that address. Check it and try again."
        );
        assert_eq!(
            clone_into(&url, &scratch("hopeful"), &data, None)
                .unwrap_err()
                .said(),
            "There is nothing at that address. Check it and try again."
        );
    }
}
