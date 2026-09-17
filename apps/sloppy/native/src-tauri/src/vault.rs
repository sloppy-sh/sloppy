//! The commands behind `Files` in `@sloppy/local`, which declares every one of
//! them and what its answer means — docs/ARCHITECTURE.md § "Local-only mode".
//!
//! Two things bound what these can touch, and both are here rather than in the
//! webview because the webview is the side being bounded: a `root` is refused
//! unless somebody picked it or it is this app's own private data, and a `path`
//! is refused unless it settles inside that root once symlinks have been
//! followed.

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::http::{header, Method, Request, Response, StatusCode, Uri};
use tauri::{AppHandle, Manager, Runtime, State, UriSchemeContext, UriSchemeResponder};

/// The scheme a picture in a graph loads from. It is this app's own rather than
/// Tauri's asset protocol so that one gate — the folders somebody picked —
/// stands between the webview and the disk; `src/lib/files.ts` spells the same
/// word. Bytes only come back this way: everything the page writes crosses the
/// bridge, because a webview carries no request body to the app it belongs to.
pub const SCHEME: &str = "vault";

/// What a person is told, and the whole of it. Which check refused, and what
/// the platform called it, is this file's business.
#[derive(Debug)]
pub enum FileError {
    NoFolder,
    Outside,
    Failed(String),
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        FileError::Failed(
            match error.kind() {
                io::ErrorKind::NotFound => "That folder is not there any more.",
                io::ErrorKind::PermissionDenied => "Sloppy cannot write in that folder.",
                _ => "That did not work. Try again, or choose another folder.",
            }
            .into(),
        )
    }
}

impl FileError {
    /// What a person is told, and what `Serialize` hands the page.
    pub fn said(&self) -> &str {
        match self {
            FileError::NoFolder => "That folder is not open. Choose it to open the graph in it.",
            FileError::Outside => "That is not a file inside the folder.",
            FileError::Failed(why) => why,
        }
    }
}

impl Serialize for FileError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.said())
    }
}

/// `path` with as much of it as exists resolved — symlinks followed, `.`
/// dropped — and the rest left as it was spelled, so a file that is not there
/// yet still answers where it would be.
pub(crate) fn settled(path: &Path) -> PathBuf {
    if let Ok(real) = fs::canonicalize(path) {
        return real;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => settled(parent).join(name),
        _ => path.to_path_buf(),
    }
}

/// Whether two paths name one file. `settled` has already followed what is
/// there; what is left is a filesystem that answers to a second spelling of the
/// same name, which macOS and Windows both do.
fn same_file(a: &Path, b: &Path) -> bool {
    a == b
        || a.as_os_str()
            .as_encoded_bytes()
            .eq_ignore_ascii_case(b.as_os_str().as_encoded_bytes())
}

/// `insideVault` in `@sloppy/vault`, which is what the page checked before it
/// asked. A colon is a path a person may well have spelled, and is refused in
/// the one place it names a drive instead.
fn inside_vault(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        return false;
    }
    let mut spelled = path.chars();
    let drive = matches!(
        (spelled.next(), spelled.next()),
        (Some(letter), Some(':')) if letter.is_ascii_alphabetic()
    );
    !drive
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// The relative path a command was handed, or nothing where it is not one. The
/// empty path is the folder itself, which only listing and making a folder
/// take.
fn relative(path: &str, allow_root: bool) -> Option<PathBuf> {
    if path.is_empty() {
        return if allow_root {
            Some(PathBuf::new())
        } else {
            None
        };
    }
    inside_vault(path).then(|| path.split('/').collect())
}

/// Where `path` names a file under `root`, and nothing where it would leave it.
fn inside(root: &Path, path: &str, allow_root: bool) -> Result<PathBuf, FileError> {
    let relative = relative(path, allow_root).ok_or(FileError::Outside)?;
    let root = settled(root);
    let target = settled(&root.join(relative));
    if target.starts_with(&root) {
        Ok(target)
    } else {
        Err(FileError::Outside)
    }
}

/// The identity's key is in the private data, and nothing but this app has any
/// business reading that folder.
#[cfg(unix)]
pub(crate) fn own_only(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
pub(crate) fn own_only(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

/// A vault a history command works in: the folder the graph's files are in,
/// which is what this reads as, and the folder somebody picked that holds it.
/// The pick is how far up the search for the repository keeping the vault may
/// go — docs/ARCHITECTURE.md § "The vault's history".
#[derive(Clone, Debug)]
pub struct Opened {
    root: PathBuf,
    within: PathBuf,
}

impl Opened {
    /// A vault nothing above it was picked for, which is its own repository or
    /// becomes one.
    pub fn own(root: &Path) -> Self {
        Opened {
            root: root.to_path_buf(),
            within: root.to_path_buf(),
        }
    }

    /// A vault inside a folder somebody picked — a project's container inside
    /// the project's root.
    pub fn inside(root: &Path, within: &Path) -> Self {
        Opened {
            root: root.to_path_buf(),
            within: within.to_path_buf(),
        }
    }

    /// How far up a search for the repository keeping this vault may go.
    pub fn within(&self) -> &Path {
        &self.within
    }
}

impl std::ops::Deref for Opened {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.root
    }
}

impl AsRef<Path> for Opened {
    fn as_ref(&self) -> &Path {
        &self.root
    }
}

/// The folders this app may reach: its own private data, and every folder a
/// person has picked. A pick is written down, so a graph opened yesterday opens
/// today without anybody being asked again.
pub struct Folders {
    data: PathBuf,
    record: PathBuf,
    picked: Mutex<BTreeSet<PathBuf>>,
}

impl Folders {
    pub fn new(data: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&data)?;
        own_only(&data, 0o700)?;
        let data = settled(&data);
        let record = data.join("folders.json");
        let held: Vec<String> = fs::read_to_string(&record)
            .ok()
            .and_then(|held| serde_json::from_str(&held).ok())
            .unwrap_or_default();
        Ok(Folders {
            data,
            record,
            picked: Mutex::new(held.into_iter().map(PathBuf::from).collect()),
        })
    }

    pub fn data_path(&self) -> String {
        self.data.to_string_lossy().into_owned()
    }

    pub fn pick(&self, folder: PathBuf) -> io::Result<()> {
        let mut picked = self.picked.lock().unwrap();
        picked.insert(settled(&folder));
        let spelled: Vec<String> = picked
            .iter()
            .map(|folder| folder.to_string_lossy().into_owned())
            .collect();
        let written = serde_json::to_string(&spelled).unwrap_or_else(|_| "[]".into());
        fs::write(&self.record, written)?;
        own_only(&self.record, 0o600)
    }

    fn allows(&self, root: &Path) -> bool {
        if !root.is_absolute() {
            return false;
        }
        let root = settled(root);
        root.starts_with(&self.data)
            || self
                .picked
                .lock()
                .unwrap()
                .iter()
                .any(|folder| root.starts_with(folder))
    }

    /// Where the command's `root` and `path` land, the root checked before
    /// anything is said about the path.
    fn resolve(&self, root: &str, path: &str, allow_root: bool) -> Result<PathBuf, FileError> {
        let root = PathBuf::from(root);
        if !self.allows(&root) {
            return Err(FileError::NoFolder);
        }
        inside(&root, path, allow_root)
    }

    /// The folder a history command works in, refused where nobody opened it.
    /// Everything that command then reaches is under what this answers.
    pub fn opened(&self, root: &str) -> Result<Opened, FileError> {
        let root = PathBuf::from(root);
        if !self.allows(&root) {
            return Err(FileError::NoFolder);
        }
        let root = settled(&root);
        Ok(match self.holding(&root) {
            Some(folder) => Opened::inside(&root, &folder),
            None => Opened::own(&root),
        })
    }

    /// The picked folder a path is in, the innermost where it is in several.
    /// Nothing for this app's own private data, which nobody picked.
    fn holding(&self, at: &Path) -> Option<PathBuf> {
        self.picked
            .lock()
            .unwrap()
            .iter()
            .filter(|folder| at.starts_with(folder))
            .max_by_key(|folder| folder.as_os_str().len())
            .cloned()
    }

    /// Where a file the page named lands, refused where it would leave the
    /// folder or be the record itself.
    pub fn within(&self, root: &str, path: &str) -> Result<PathBuf, FileError> {
        self.changeable(self.resolve(root, path, false)?)
    }

    fn is_private(&self, path: &Path) -> bool {
        path.starts_with(&self.data)
    }

    /// The record is what `allows` reads on the next launch, so a command may
    /// not be the thing that writes it.
    fn changeable(&self, at: PathBuf) -> Result<PathBuf, FileError> {
        if same_file(&at, &self.record) {
            return Err(FileError::Outside);
        }
        Ok(at)
    }

    /// A file the page may draw: anything in a folder somebody picked. Nothing
    /// where no picked folder holds it — the private data included, which is
    /// where the identity's key is.
    pub fn loadable(&self, at: &Path) -> Option<PathBuf> {
        if !at.is_absolute() {
            return None;
        }
        let at = settled(at);
        let picked = self.picked.lock().unwrap();
        picked
            .iter()
            .any(|folder| at.starts_with(folder))
            .then_some(at)
    }

    pub fn read(&self, root: &str, path: &str) -> Result<Option<Vec<u8>>, FileError> {
        let at = self.resolve(root, path, false)?;
        match fs::read(&at) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn write(&self, root: &str, path: &str, bytes: &[u8]) -> Result<(), FileError> {
        let at = self.changeable(self.resolve(root, path, false)?)?;
        if let Some(parent) = at.parent() {
            fs::create_dir_all(parent)?;
            if self.is_private(parent) {
                own_only(parent, 0o700)?;
            }
        }
        fs::write(&at, bytes)?;
        if self.is_private(&at) {
            own_only(&at, 0o600)?;
        }
        Ok(())
    }

    pub fn list(&self, root: &str, path: &str) -> Result<Vec<String>, FileError> {
        let at = self.resolve(root, path, true)?;
        let from = settled(&PathBuf::from(root));
        let mut found = Vec::new();
        let mut walking = vec![at];
        while let Some(folder) = walking.pop() {
            let entries = match fs::read_dir(&folder) {
                Ok(entries) => entries,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            for entry in entries {
                let entry = entry?;
                // A symlink is neither followed nor listed: following one is
                // the one way a walk inside the folder ends up outside it.
                let kind = entry.file_type()?;
                if kind.is_dir() {
                    walking.push(entry.path());
                } else if kind.is_file() {
                    if let Ok(under) = entry.path().strip_prefix(&from) {
                        found.push(
                            under
                                .components()
                                .map(|part| part.as_os_str().to_string_lossy())
                                .collect::<Vec<_>>()
                                .join("/"),
                        );
                    }
                }
            }
        }
        found.sort();
        Ok(found)
    }

    pub fn remove(&self, root: &str, path: &str) -> Result<(), FileError> {
        let at = self.changeable(self.resolve(root, path, false)?)?;
        let removed = match fs::symlink_metadata(&at) {
            Ok(held) if held.is_dir() => fs::remove_dir_all(&at),
            Ok(_) => fs::remove_file(&at),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        match removed {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            other => Ok(other?),
        }
    }

    pub fn exists(&self, root: &str, path: &str) -> Result<bool, FileError> {
        Ok(self.resolve(root, path, false)?.exists())
    }

    pub fn mkdir(&self, root: &str, path: &str) -> Result<(), FileError> {
        let at = self.changeable(self.resolve(root, path, true)?)?;
        fs::create_dir_all(&at)?;
        if self.is_private(&at) {
            own_only(&at, 0o700)?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn files_read(
    folders: State<'_, Folders>,
    root: String,
    path: String,
) -> Result<Option<String>, FileError> {
    Ok(folders
        .read(&root, &path)?
        .map(|bytes| BASE64.encode(bytes)))
}

#[tauri::command]
pub fn files_write(
    folders: State<'_, Folders>,
    root: String,
    path: String,
    bytes: String,
) -> Result<(), FileError> {
    let bytes = BASE64
        .decode(bytes)
        .map_err(|_| FileError::Failed("Those bytes could not be read.".into()))?;
    folders.write(&root, &path, &bytes)
}

#[tauri::command]
pub fn files_list(
    folders: State<'_, Folders>,
    root: String,
    path: String,
) -> Result<Vec<String>, FileError> {
    folders.list(&root, &path)
}

#[tauri::command]
pub fn files_remove(
    folders: State<'_, Folders>,
    root: String,
    path: String,
) -> Result<(), FileError> {
    folders.remove(&root, &path)
}

#[tauri::command]
pub fn files_exists(
    folders: State<'_, Folders>,
    root: String,
    path: String,
) -> Result<bool, FileError> {
    folders.exists(&root, &path)
}

#[tauri::command]
pub fn files_mkdir(
    folders: State<'_, Folders>,
    root: String,
    path: String,
) -> Result<(), FileError> {
    folders.mkdir(&root, &path)
}

#[tauri::command]
pub fn app_data_path(folders: State<'_, Folders>) -> String {
    folders.data_path()
}

#[tauri::command]
pub async fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, FileError> {
    let Some(folder) = ask(&app).await? else {
        return Ok(None);
    };
    // What is recorded and what the page is handed is one string, so a URL the
    // page builds out of it lands on the folder that was granted.
    let folder = settled(&folder);
    app.state::<Folders>().pick(folder.clone())?;
    Ok(Some(folder.to_string_lossy().into_owned()))
}

/// A file somebody chose from outside every folder this app reads — an identity
/// another device wrote. The bytes come back with it rather than a path,
/// because nothing grants the webview that file and nothing should.
#[derive(Serialize)]
pub struct PickedFile {
    name: String,
    /// Base64: the bridge carries JSON.
    bytes: String,
}

#[tauri::command]
pub async fn pick_file<R: Runtime>(
    app: AppHandle<R>,
    extensions: Vec<String>,
) -> Result<Option<PickedFile>, FileError> {
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_fs::FsExt;

    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut asking = handle.dialog().file();
        if !extensions.is_empty() {
            let spelled: Vec<&str> = extensions.iter().map(String::as_str).collect();
            asking = asking.add_filter("Files", &spelled);
        }
        asking.blocking_pick_file()
    })
    .await
    .map_err(|_| FileError::Failed("Choosing a file did not finish.".into()))?;

    let Some(path) = picked else {
        return Ok(None);
    };
    let name = path
        .to_string()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_string();
    // A file somebody picked on Android is a content URI and not a path, which
    // is what this reads and `std::fs` does not.
    let bytes = app
        .fs()
        .read(path)
        .map_err(|_| FileError::Failed("That file could not be read.".into()))?;
    Ok(Some(PickedFile {
        name,
        bytes: BASE64.encode(bytes),
    }))
}

/// A file the app hands a person to keep, put where they say. `false` is
/// somebody who named nowhere, which is not a failure.
#[tauri::command]
pub async fn save_file<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    bytes: String,
) -> Result<bool, FileError> {
    use std::io::Write as _;
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    let body = BASE64
        .decode(bytes)
        .map_err(|_| FileError::Failed("That file could not be saved.".into()))?;
    // Left to itself the panel opens wherever the app last was, which is the
    // folder a graph is open in. A file this app hands over can hold a key, and
    // one of those must never land in somebody's notes by accepting a default.
    let start = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .ok();
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut panel = handle.dialog().file().set_file_name(&name);
        if let Some(folder) = start {
            panel = panel.set_directory(folder);
        }
        panel.blocking_save_file()
    })
    .await
    .map_err(|_| FileError::Failed("Saving did not finish.".into()))?;

    let Some(path) = picked else {
        return Ok(false);
    };
    let mut opening = OpenOptions::new();
    opening.read(false).write(true).create(true).truncate(true);
    let mut file = app
        .fs()
        .open(path, opening)
        .map_err(|_| FileError::Failed("That file could not be saved there.".into()))?;
    file.write_all(&body)
        .map_err(|_| FileError::Failed("That file could not be saved there.".into()))?;
    Ok(true)
}

/// What every answer at this scheme carries. The page is served from another
/// scheme, so the webview asks before it draws a picture; nothing outside this
/// app can reach `vault:` at all.
fn sent(status: StatusCode, kind: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, kind)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .body(body)
        .expect("a response built out of static headers")
}

fn said(status: StatusCode) -> Response<Vec<u8>> {
    sent(status, "text/plain", Vec::new())
}

/// What a picture's bytes are. A vault names a picture by what it is
/// (`@sloppy/local`'s `extensionFor`), so the name is the whole answer.
fn kind_of(at: &Path) -> &'static str {
    let extension = at
        .extension()
        .and_then(|held| held.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// The file a `vault:` URL names. `convertFileSrc` on the page spells the whole
/// path into one segment, so decoding that segment is the whole of reading it.
fn asked(uri: &Uri) -> Option<PathBuf> {
    let spelled = percent_decode_str(uri.path().trim_start_matches('/'))
        .decode_utf8()
        .ok()?;
    (!spelled.is_empty()).then(|| PathBuf::from(spelled.as_ref()))
}

/// What the page is answered when it loads a picture out of a graph.
pub fn answer(folders: &Folders, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let at = asked(request.uri());
    match *request.method() {
        Method::OPTIONS => said(StatusCode::NO_CONTENT),
        Method::GET | Method::HEAD => {
            let Some(at) = at.as_deref().and_then(|at| folders.loadable(at)) else {
                return said(StatusCode::FORBIDDEN);
            };
            match fs::read(&at) {
                Ok(bytes) => sent(StatusCode::OK, kind_of(&at), bytes),
                Err(_) => said(StatusCode::NOT_FOUND),
            }
        }
        _ => said(StatusCode::METHOD_NOT_ALLOWED),
    }
}

/// The page's side of `vault:`, as `lib.rs` registers it.
pub fn protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    // Disk work, and the webview's own thread is what would be waiting on it.
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(answer(&app.state::<Folders>(), &request));
    });
}

/// A person is asked where a desktop can ask them.
#[cfg(desktop)]
async fn ask<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, FileError> {
    use tauri_plugin_dialog::DialogExt;
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .set_title("Where should this graph live?")
            .blocking_pick_folder()
    })
    .await
    .map_err(|_| FileError::Failed("Choosing a folder did not finish.".into()))?;
    Ok(picked.and_then(|folder| folder.into_path().ok()))
}

/// On a phone and a tablet a graph lives in this app's own documents folder, so
/// that folder is the answer and nobody is asked for one.
#[cfg(mobile)]
async fn ask<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, FileError> {
    let documents = app.path().document_dir().map_err(|_| {
        FileError::Failed("Sloppy could not find a place to keep this graph.".into())
    })?;
    fs::create_dir_all(&documents)?;
    Ok(Some(documents))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT: AtomicU32 = AtomicU32::new(0);

    /// A folder outside anything a test has granted, standing in for the rest
    /// of the disk.
    fn scratch(name: &str) -> PathBuf {
        let at = std::env::temp_dir().join(format!(
            "sloppy-vault-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&at);
        fs::create_dir_all(&at).expect("a scratch folder");
        at
    }

    fn folders(data: &Path) -> Folders {
        Folders::new(data.to_path_buf()).expect("the private data folder")
    }

    /// The private data and one picked folder, spelled the way a command is
    /// handed them.
    fn opened() -> (Folders, String, String) {
        let held = folders(&scratch("data"));
        let vault = scratch("vault");
        held.pick(vault.clone()).expect("picking the folder");
        let data = held.data_path();
        (held, data, vault.to_string_lossy().into_owned())
    }

    #[test]
    fn a_relative_path_is_the_only_kind_a_command_takes() {
        assert_eq!(
            relative("notes/a.md", false),
            Some(PathBuf::from("notes/a.md"))
        );
        assert_eq!(relative("", true), Some(PathBuf::new()));

        assert_eq!(relative("", false), None);
        assert_eq!(relative("../elsewhere", false), None);
        assert_eq!(relative("notes/../../elsewhere", false), None);
        assert_eq!(relative("/etc/passwd", false), None);
        assert_eq!(relative("notes//a.md", false), None);
        assert_eq!(relative("C:/Windows", false), None);
        assert_eq!(relative("notes\\..\\a.md", false), None);
        assert_eq!(relative("notes/./a.md", false), None);

        // The same paths `insideVault` takes, so one spelling is not a file to
        // the page and no file here: a colon names a drive and nothing else.
        assert_eq!(
            relative("notes/a:b.md", false),
            Some(PathBuf::from("notes/a:b.md"))
        );
    }

    #[test]
    fn only_a_folder_somebody_picked_can_be_reached() {
        let held = folders(&scratch("data"));
        let vault = scratch("vault");
        let spelled = vault.to_string_lossy().into_owned();

        assert!(matches!(
            held.read(&spelled, "graph.json"),
            Err(FileError::NoFolder)
        ));
        assert!(matches!(
            held.read("", "graph.json"),
            Err(FileError::NoFolder)
        ));
        assert!(matches!(
            held.read("notes", "a.md"),
            Err(FileError::NoFolder)
        ));
        assert!(held.read(&held.data_path(), "identity.json").is_ok());

        held.pick(vault).expect("picking the folder");
        assert!(held.read(&spelled, "graph.json").is_ok());
    }

    #[test]
    fn a_path_that_would_leave_the_folder_is_refused() {
        let (held, _, vault) = opened();
        for path in ["../graph.json", "notes/../../graph.json", "/etc/hosts"] {
            assert!(matches!(held.read(&vault, path), Err(FileError::Outside)));
            assert!(matches!(
                held.write(&vault, path, b"x"),
                Err(FileError::Outside)
            ));
            assert!(matches!(held.remove(&vault, path), Err(FileError::Outside)));
            assert!(matches!(held.exists(&vault, path), Err(FileError::Outside)));
            assert!(matches!(held.list(&vault, path), Err(FileError::Outside)));
            assert!(matches!(held.mkdir(&vault, path), Err(FileError::Outside)));
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_folder_is_still_out_of_the_folder() {
        let (held, _, vault) = opened();
        let elsewhere = scratch("elsewhere");
        fs::write(elsewhere.join("secret"), b"not yours").expect("a file elsewhere");
        std::os::unix::fs::symlink(&elsewhere, PathBuf::from(&vault).join("away"))
            .expect("a symlink");

        assert!(matches!(
            held.read(&vault, "away/secret"),
            Err(FileError::Outside)
        ));
    }

    #[test]
    fn a_file_reads_back_as_the_bytes_that_were_written() {
        let (held, _, vault) = opened();
        held.write(&vault, "notes/a.md", b"one").expect("the write");

        assert_eq!(
            held.read(&vault, "notes/a.md").unwrap(),
            Some(b"one".to_vec())
        );
        assert!(held.exists(&vault, "notes/a.md").unwrap());
        assert_eq!(held.read(&vault, "notes/b.md").unwrap(), None);
        assert!(!held.exists(&vault, "notes/b.md").unwrap());
    }

    #[test]
    fn listing_answers_every_file_under_the_folder_and_no_folder() {
        let (held, _, vault) = opened();
        held.write(&vault, "graph.json", b"{}").expect("the graph");
        held.write(&vault, "notes/a.md", b"a").expect("a note");
        held.write(&vault, "notes/deep/b.md", b"b").expect("a note");

        assert_eq!(
            held.list(&vault, "").unwrap(),
            vec!["graph.json", "notes/a.md", "notes/deep/b.md"]
        );
        assert_eq!(
            held.list(&vault, "notes").unwrap(),
            vec!["notes/a.md", "notes/deep/b.md"]
        );
        assert_eq!(held.list(&vault, "media").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn removing_what_is_not_there_is_an_outcome_and_not_an_error() {
        let (held, _, vault) = opened();
        held.write(&vault, "notes/a.md", b"a").expect("a note");

        held.remove(&vault, "notes/a.md").expect("the first remove");
        held.remove(&vault, "notes/a.md").expect("the second");
        assert!(!held.exists(&vault, "notes/a.md").unwrap());
    }

    #[test]
    fn making_a_folder_that_is_there_is_an_outcome_and_not_an_error() {
        let (held, _, vault) = opened();
        held.mkdir(&vault, "media").expect("the first");
        held.mkdir(&vault, "media").expect("the second");
        held.mkdir(&vault, "").expect("the folder itself");
    }

    #[cfg(unix)]
    #[test]
    fn the_identity_this_device_writes_under_is_readable_by_nobody_else() {
        use std::os::unix::fs::PermissionsExt;
        let (held, data, vault) = opened();
        held.write(&data, "identity.key", b"a seed")
            .expect("the key");
        held.write(&vault, "notes/a.md", b"a note").expect("a note");

        let key = fs::metadata(PathBuf::from(&data).join("identity.key")).expect("the key");
        assert_eq!(key.permissions().mode() & 0o777, 0o600);
        let folder = fs::metadata(&data).expect("the private data");
        assert_eq!(folder.permissions().mode() & 0o777, 0o700);

        // A person's own folder is theirs, and git and a backup read it, so a
        // note is written exactly as anything else on this machine writes one.
        fs::write(PathBuf::from(&vault).join("plain"), b"x").expect("a control");
        let note = fs::metadata(PathBuf::from(&vault).join("notes/a.md")).expect("the note");
        let plain = fs::metadata(PathBuf::from(&vault).join("plain")).expect("the control");
        assert_eq!(
            note.permissions().mode() & 0o777,
            plain.permissions().mode() & 0o777
        );
    }

    /// One file written and read back over the bridge the page actually calls,
    /// so a command that is not registered, or whose arguments the page spells
    /// differently, fails here rather than in somebody's hands.
    #[test]
    fn a_file_crosses_the_bridge_as_the_page_spells_it() {
        use tauri::ipc::{CallbackFn, InvokeBody};
        use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
        use tauri::webview::InvokeRequest;

        let (held, _, vault) = opened();
        let app = mock_builder()
            .invoke_handler(crate::commands())
            .build(mock_context(noop_assets()))
            .expect("an app");
        app.manage(held);
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

        let wrote = ask(
            "files_write",
            serde_json::json!({ "root": vault, "path": "notes/a.md", "bytes": BASE64.encode("one") }),
        );
        assert!(wrote.is_ok(), "the write was refused: {wrote:?}");

        let read = ask(
            "files_read",
            serde_json::json!({ "root": vault, "path": "notes/a.md" }),
        )
        .expect("the read")
        .deserialize::<Option<String>>()
        .expect("what the page is handed");
        assert_eq!(read, Some(BASE64.encode("one")));

        let outside = ask(
            "files_read",
            serde_json::json!({ "root": vault, "path": "../elsewhere" }),
        );
        assert_eq!(
            outside.unwrap_err(),
            serde_json::json!("That is not a file inside the folder.")
        );
    }

    #[test]
    fn a_picked_folder_is_still_picked_next_launch() {
        let data = scratch("data");
        let vault = scratch("vault");
        folders(&data).pick(vault.clone()).expect("picking");

        let after = folders(&data);
        assert!(after.read(&vault.to_string_lossy(), "graph.json").is_ok());
        assert!(after.loadable(&vault.join("graph.json")).is_some());
    }

    /// Which folders may be reached is settled outside the webview, so the
    /// record of them is not a file the webview's own commands can rewrite.
    #[test]
    fn the_record_of_what_was_picked_is_not_a_file_a_command_can_write() {
        let data = scratch("data");
        let vault = scratch("vault");
        let elsewhere = scratch("elsewhere");
        fs::write(elsewhere.join("secret"), b"not yours").expect("a file elsewhere");
        let held = folders(&data);
        held.pick(vault).expect("picking the folder");
        let spelled = held.data_path();
        let elsewhere = settled(&elsewhere);
        let forged =
            serde_json::to_string(&[elsewhere.to_string_lossy()]).expect("a list of folders");

        assert!(matches!(
            held.write(&spelled, "folders.json", forged.as_bytes()),
            Err(FileError::Outside)
        ));
        assert!(matches!(
            held.remove(&spelled, "folders.json"),
            Err(FileError::Outside)
        ));
        assert!(matches!(
            held.mkdir(&spelled, "folders.json"),
            Err(FileError::Outside)
        ));

        let after = folders(&data);
        assert!(matches!(
            after.read(&elsewhere.to_string_lossy(), "secret"),
            Err(FileError::NoFolder)
        ));
        assert!(after.loadable(&elsewhere.join("secret")).is_none());
    }

    /// macOS and Windows answer to a second spelling of the same file name, so
    /// the record is guarded by what the disk calls the file and not by how the
    /// page happened to type it.
    #[test]
    fn the_record_is_not_a_file_a_command_can_write_under_another_spelling() {
        let data = scratch("data");
        let held = folders(&data);
        let spelled = held.data_path();

        for name in ["Folders.json", "FOLDERS.JSON"] {
            assert!(matches!(
                held.write(&spelled, name, b"[]"),
                Err(FileError::Outside)
            ));
            assert!(matches!(
                held.remove(&spelled, name),
                Err(FileError::Outside)
            ));
        }
        held.write(&spelled, "identity.json", b"{}")
            .expect("what is not the record");
    }

    /// The page draws pictures out of a picked folder; the identity's key is in
    /// the private data, and no URL reaches it.
    #[test]
    fn what_a_page_may_load_is_the_picked_folders_and_not_the_private_data() {
        let data = scratch("data");
        let vault = scratch("vault");
        let held = folders(&data);
        held.pick(vault.clone()).expect("picking");

        assert!(held.loadable(&vault.join("media/a.png")).is_some());
        assert!(held.loadable(&vault.join("notes/a.md")).is_some());
        assert!(held
            .loadable(&PathBuf::from(held.data_path()).join("identity.key"))
            .is_none());
        assert!(held
            .loadable(&scratch("elsewhere").join("secret"))
            .is_none());
        assert!(held.loadable(&PathBuf::from("media/a.png")).is_none());
    }

    /// The URL a page builds, as `convertFileSrc` spells it.
    fn at(path: &Path) -> String {
        format!(
            "{SCHEME}://localhost/{}",
            path.to_string_lossy().replace('/', "%2F")
        )
    }

    fn ask(folders: &Folders, method: &str, path: &Path, body: &[u8]) -> Response<Vec<u8>> {
        let request = Request::builder()
            .method(method)
            .uri(at(path))
            .body(body.to_vec())
            .expect("a request");
        answer(folders, &request)
    }

    #[test]
    fn a_picture_is_loaded_out_of_a_picked_folder_and_out_of_nowhere_else() {
        let data = scratch("data");
        let vault = scratch("vault");
        let elsewhere = scratch("elsewhere");
        fs::write(elsewhere.join("secret"), b"not yours").expect("a file elsewhere");
        let held = folders(&data);
        held.pick(vault.clone()).expect("picking");
        held.write(&vault.to_string_lossy(), "media/a.png", b"a picture")
            .expect("a picture");

        let drawn = ask(&held, "GET", &vault.join("media/a.png"), b"");
        assert_eq!(drawn.status(), StatusCode::OK);
        assert_eq!(drawn.body(), b"a picture");
        assert_eq!(drawn.headers()[header::CONTENT_TYPE], "image/png");

        assert_eq!(
            ask(&held, "GET", &vault.join("media/gone.png"), b"").status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            ask(&held, "GET", &elsewhere.join("secret"), b"").status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            ask(
                &held,
                "GET",
                &PathBuf::from(held.data_path()).join("identity.key"),
                b""
            )
            .status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn the_webview_may_ask_before_it_draws_a_picture_and_may_do_nothing_else() {
        let data = scratch("data");
        let vault = scratch("vault");
        let held = folders(&data);
        held.pick(vault.clone()).expect("picking");
        held.write(&vault.to_string_lossy(), "media/a.png", b"a picture")
            .expect("a picture");

        let asked = ask(&held, "OPTIONS", &vault.join("media/a.png"), b"");
        assert_eq!(asked.status(), StatusCode::NO_CONTENT);
        assert_eq!(asked.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");

        for method in ["PUT", "POST", "DELETE"] {
            assert_eq!(
                ask(&held, method, &vault.join("media/a.png"), b"theirs").status(),
                StatusCode::METHOD_NOT_ALLOWED
            );
        }
        assert_eq!(fs::read(vault.join("media/a.png")).unwrap(), b"a picture");
    }
}
