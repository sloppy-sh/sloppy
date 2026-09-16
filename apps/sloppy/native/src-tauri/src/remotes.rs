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

use git2::build::RepoBuilder;
use git2::{
    BranchType, Cred, CredentialType, ErrorClass, ErrorCode, FetchOptions, Oid, PushOptions,
    RemoteCallbacks, Repository,
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::history::{self, HistoryError, Merged};
use crate::signing::SshKey;
use crate::vault::Folders;

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
        "That address would not let Sloppy in. Check what it was given and try again.",
    )
}

/// What a person is told when an act over the wire did not go through. Which
/// call failed and what the library called it is this file's business; what
/// they can do about it is theirs.
fn tripped(error: git2::Error) -> HistoryError {
    match error.code() {
        ErrorCode::Auth | ErrorCode::Certificate => turned_away(),
        ErrorCode::NotFastForward => pull_first(),
        _ => match error.class() {
            ErrorClass::Net | ErrorClass::Os | ErrorClass::Ssh | ErrorClass::Http => {
                if error.code() == ErrorCode::GenericError && error.class() == ErrorClass::Http {
                    turned_away()
                } else {
                    nowhere()
                }
            }
            _ if error.code() == ErrorCode::NotFound => nowhere(),
            _ => error.into(),
        },
    }
}

/// How this device answers a host that asks who is there. Nothing is
/// remembered between two acts: what is here came in with the call.
fn asked_for<'a>(credential: Option<&'a Credential>, data: &'a Path) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    let offered = Cell::new(0u8);
    callbacks.credentials(move |_url, from_url, allowed| {
        // A host that refuses what it was given asks again, and giving it the
        // same thing a second time is a loop rather than a sign-in.
        if offered.get() > 4 {
            return Err(git2::Error::from_str("nothing else to offer"));
        }
        offered.set(offered.get() + 1);
        let user = from_url.unwrap_or(DEFAULT_USER);
        if allowed.contains(CredentialType::USERNAME) {
            return Cred::username(user);
        }
        match credential {
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
            _ => Err(git2::Error::from_str("nothing to offer")),
        }
    });
    callbacks
}

/// The two halves of the key an act reaches a host with: the one this app
/// keeps, or one already on the device that a person named.
fn key_files(key: &SshKey, data: &Path) -> (PathBuf, Option<PathBuf>) {
    match key {
        SshKey::Kept => (
            data.join("signing.key"),
            Some(data.join(crate::signing::KEPT_KEY_PUBLIC)),
        ),
        SshKey::File { path } => {
            let at = PathBuf::from(path);
            let beside = PathBuf::from(format!("{}.pub", at.to_string_lossy()));
            let public = beside.exists().then_some(beside);
            (at, public)
        }
    }
}

pub fn list(root: &Path) -> Result<Vec<Remote>, HistoryError> {
    let repo = history::at(root)?;
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

pub fn add(root: &Path, name: &str, url: &str) -> Result<(), HistoryError> {
    let repo = history::at(root)?;
    if repo.find_remote(name).is_ok() {
        return Err(already_called(name));
    }
    repo.remote(name, url)
        .map_err(|_| HistoryError::new(format!("{name} will not work as a name. Try another.")))?;
    Ok(())
}

pub fn rename(root: &Path, name: &str, to: &str) -> Result<(), HistoryError> {
    let repo = history::at(root)?;
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

pub fn set_url(root: &Path, name: &str, url: &str) -> Result<(), HistoryError> {
    let repo = history::at(root)?;
    if repo.find_remote(name).is_err() {
        return Err(nothing_called(name));
    }
    repo.remote_set_url(name, url)?;
    Ok(())
}

pub fn remove(root: &Path, name: &str) -> Result<(), HistoryError> {
    let repo = history::at(root)?;
    if repo.find_remote(name).is_err() {
        return Err(nothing_called(name));
    }
    repo.remote_delete(name)?;
    Ok(())
}

pub fn fetch(
    root: &Path,
    data: &Path,
    name: &str,
    credential: Option<&Credential>,
) -> Result<(), HistoryError> {
    let repo = history::at(root)?;
    take_from(&repo, name, data, credential)
}

fn take_from(
    repo: &Repository,
    name: &str,
    data: &Path,
    credential: Option<&Credential>,
) -> Result<(), HistoryError> {
    let mut remote = repo.find_remote(name).map_err(|_| nothing_called(name))?;
    let mut how = FetchOptions::new();
    how.remote_callbacks(asked_for(credential, data));
    let nothing: [&str; 0] = [];
    remote
        .fetch(&nothing, Some(&mut how), None)
        .map_err(tripped)
}

pub fn pull(
    root: &Path,
    data: &Path,
    named: Option<&str>,
    credential: Option<&Credential>,
) -> Result<Merged, HistoryError> {
    let mut repo = history::at(root)?;
    let branch = history::on(&repo)?.ok_or_else(off_a_branch)?;
    let name = which(&repo, &branch, named)?;
    take_from(&repo, &name, data, credential)?;

    if history::head_commit(&repo)?.is_none() {
        let Some(tracking) = arriving(&repo, &name, &branch) else {
            return Ok(Merged::whole());
        };
        let Some(theirs) = head_of(&repo, &tracking) else {
            return Ok(Merged::whole());
        };
        let branch = tracking[name.len() + 1..].to_owned();
        history::lay(&repo, root, theirs)?;
        repo.reference(
            &format!("refs/heads/{branch}"),
            theirs,
            true,
            &format!("pull {tracking}"),
        )?;
        repo.set_head(&format!("refs/heads/{branch}"))?;
        follow(&repo, &branch, &tracking)?;
        return Ok(Merged::whole());
    }

    let tracking = format!("{name}/{branch}");
    let Some(theirs) = head_of(&repo, &tracking) else {
        return Ok(Merged::whole());
    };
    history::merge_commit(&mut repo, root, data, theirs, &tracking)
}

pub fn push(
    root: &Path,
    data: &Path,
    named: Option<&str>,
    credential: Option<&Credential>,
) -> Result<(), HistoryError> {
    let repo = history::at(root)?;
    let branch = history::on(&repo)?.ok_or_else(off_a_branch)?;
    let Some(mine) = history::head_commit(&repo)?.map(|held| held.id()) else {
        return Err(HistoryError::new(
            "There is nothing here to keep somewhere else yet. Commit what is in this folder first.",
        ));
    };
    let name = which(&repo, &branch, named)?;
    let mut remote = repo.find_remote(&name).map_err(|_| nothing_called(&name))?;

    // What the remote has that this branch has not taken in would be written
    // over, and the side holding it is the side that says so.
    let refused: Cell<Option<String>> = Cell::new(None);
    let want = format!("refs/heads/{branch}");
    let mut how = PushOptions::new();
    let mut callbacks = asked_for(credential, data);
    callbacks.push_update_reference(|_reference, status| {
        refused.set(status.map(str::to_owned));
        Ok(())
    });
    how.remote_callbacks(callbacks);
    remote
        .push(&[format!("{want}:{want}")], Some(&mut how))
        .map_err(tripped)?;
    if let Some(said) = refused.take() {
        return Err(turned_down(&said));
    }

    let tracking = format!("{name}/{branch}");
    repo.reference(
        &format!("refs/remotes/{tracking}"),
        mine,
        true,
        &format!("push {tracking}"),
    )?;
    follow(&repo, &branch, &tracking)?;
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
    if fs::read_dir(into).into_iter().flatten().flatten().count() > 0 {
        return Err(HistoryError::new(
            "There is already something in that folder. Choose an empty one.",
        ));
    }
    let mut how = FetchOptions::new();
    how.remote_callbacks(asked_for(credential, data));
    let repo = RepoBuilder::new()
        .fetch_options(how)
        .clone(url, into)
        .map_err(tripped)?;
    history::keep_out(&repo)?;
    Ok(())
}

/// A remote that would not take a push. The one thing every host refuses for
/// the same reason is a branch it has commits on that this one has not taken
/// in; anything else is that host's own rule and its own words.
fn turned_down(said: &str) -> HistoryError {
    if said.contains("fast") || said.contains("behind") {
        return pull_first();
    }
    HistoryError::new(format!(
        "That address would not take this. {}",
        one_sentence(said)
    ))
}

fn one_sentence(said: &str) -> String {
    let said = said.trim();
    let mut held: String = said.chars().take(120).collect();
    if let Some(first) = held.get(0..1) {
        held.replace_range(0..1, &first.to_uppercase());
    }
    if !held.ends_with('.') {
        held.push('.');
    }
    held
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

fn opened(folders: &State<'_, Folders>, root: &str) -> Result<PathBuf, HistoryError> {
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
    fn elsewhere(name: &str) -> (PathBuf, String) {
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

        let kept: Vec<String> = crate::history::read_at(&there, "refs/heads/main")
            .expect("what is kept there")
            .keys()
            .cloned()
            .collect();
        assert!(kept.contains(&"notes/a.md".to_owned()));
        for one in [
            "identity.json",
            "identity.key",
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
