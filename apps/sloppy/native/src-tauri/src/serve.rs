//! The folders open here served to a headset: an iroh endpoint under a key kept
//! in the app's data, each headset paired once by a code `serve_pair` shows
//! and by its own key after, every line it sends handed to the webview as
//! `serve:call` and every answer carried back — `ServeAccess` in
//! `@sloppy/app-core` declares every act, docs/ARCHITECTURE.md § "A headset
//! beside the desk".
//!
//! **Nothing here answers a line but `pair`.** What every other message asks
//! and what it is answered with are the webview's; this file pairs, carries
//! and remembers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use iroh::address_lookup::{
    AddressLookup, AddressLookupBuilder, AddressLookupBuilderError, EndpointData, PkarrPublisher,
};
use iroh::endpoint::{presets, Connection, PortmapperConfig, RecvStream, SendStream};
use iroh::{Endpoint, RelayMode, RelayUrl, SecretKey};
use iroh_mdns_address_lookup::MdnsAddressLookup;
use iroh_tickets::endpoint::EndpointTicket;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime, State};
use tokio::io::{AsyncBufReadExt as _, BufReader};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::task::AbortHandle;

/// `SERVE_ALPN` in `@sloppy/types`.
pub const ALPN: &[u8] = b"sloppy/serve/1";
/// What a desk announces itself as on this network, and a headset listens for.
pub const SERVICE: &str = "sloppy";
/// `SERVE_PAIR_WINDOW_MS` in `@sloppy/types`.
const PAIR_WINDOW: Duration = Duration::from_secs(120);
/// `SERVE_FIRST_LINE_MS` in `@sloppy/types`.
const FIRST_LINE: Duration = Duration::from_secs(10);
/// `SERVE_CODE_LENGTH` in `@sloppy/types`.
const CODE_LENGTH: usize = 6;
/// `UNPAIRED` in `@sloppy/local`'s `serving.ts`.
const UNPAIRED: i32 = -32001;
/// The longest name a headset is remembered by, as `serving.ts` keeps it.
const NAMED_AT_MOST: usize = 64;
/// How long a connection that is let go waits for its last answer to arrive.
const LETTING_GO: Duration = Duration::from_secs(2);

const KEY_FILE: &str = "serve.key";
const PAIRED_FILE: &str = "paired.json";

const CALL_EVENT: &str = "serve:call";
const CLOSED_EVENT: &str = "serve:closed";

// The words `pairingAnswer` in `serving.ts` answers with.
const NOT_PAIRED: &str =
    "This headset is not paired with this desk yet. Enter the code the desk shows.";
const NOT_PAIRING: &str =
    "This headset is not paired with this desk yet. Ask the desk for a code: on it, choose Pair a headset.";
const WRONG_CODE: &str =
    "That is not a code this desk is showing. Check it, or ask the desk for a new one.";
const PAIR_TOO_LATE: &str =
    "The code did not come in time. Connect again and enter the code the desk shows.";

const COULD_NOT_START: &str =
    "Serving could not start here. Check this computer is on a network, and try again.";
const NO_RELAY: &str =
    "That relay could not be used. Check its address, which starts with https://, and try again.";
const NOT_KEPT: &str = "Serving could not start here. Try again.";
const NOT_SERVING: &str = "Turn on Serve to a headset first, then pair one.";

/// `ServeReach` in `@sloppy/types`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Reach {
    Local,
    Anywhere,
}

/// `PairedHeadset` in `@sloppy/types`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PairedHeadset {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub paired_at: u64,
}

/// `ServePairing` in `@sloppy/types`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Pairing {
    pub code: String,
    pub until: u64,
}

/// `Serving` in `@sloppy/types`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Serving {
    pub id: String,
    pub ticket: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairing: Option<Pairing>,
    pub reach: Reach,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay: Option<String>,
    pub paired: Vec<PairedHeadset>,
    pub connections: u32,
}

/// `ServeCall` in `@sloppy/types`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ServeCall {
    pub connection: String,
    pub line: String,
}

/// What a running desk tells whoever started it.
pub trait Heard: Send + Sync + 'static {
    fn call(&self, call: ServeCall);
    /// A connection that was paired, and whose calls came with this id, has gone.
    fn closed(&self, _connection: &str) {}
}

/// The desk's key and the headsets it has paired, in one folder of the app's
/// own data.
#[derive(Clone)]
pub struct Kept(PathBuf);

impl Kept {
    pub fn at(folder: impl Into<PathBuf>) -> Self {
        Self(folder.into())
    }

    /// The desk's key, made once.
    fn key(&self) -> std::io::Result<SecretKey> {
        let path = self.0.join(KEY_FILE);
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(held) = <[u8; 32]>::try_from(bytes.as_slice()) {
                return Ok(SecretKey::from_bytes(&held));
            }
        }
        let made = SecretKey::generate();
        std::fs::create_dir_all(&self.0)?;
        write_private(&path, &made.to_bytes())?;
        Ok(made)
    }

    pub fn paired(&self) -> Vec<PairedHeadset> {
        std::fs::read(self.0.join(PAIRED_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn keep(&self, paired: &[PairedHeadset]) {
        if std::fs::create_dir_all(&self.0).is_ok() {
            if let Ok(bytes) = serde_json::to_vec(paired) {
                let _ = write_private(&self.0.join(PAIRED_FILE), &bytes);
            }
        }
    }

    /// Forgets the headset `id`; one never paired is not a failure.
    pub fn forget(&self, id: &str) {
        let mut paired = self.paired();
        paired.retain(|one| one.id != id);
        self.keep(&paired);
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// How a desk is started.
pub struct Start {
    pub reach: Reach,
    pub relay: Option<String>,
    /// What the desk is called to a headset looking for one on this network.
    pub name: String,
    pub kept: Kept,
    /// Whether the desk is announced on this network. A test dials by address
    /// and leaves it off.
    pub announce: bool,
}

struct Open {
    send: UnboundedSender<String>,
    task: AbortHandle,
}

type Opened = Arc<Mutex<HashMap<String, Open>>>;

/// The code shown now, and when it stops being accepted.
struct Shown {
    code: String,
    closes: std::time::Instant,
    until: u64,
}

type Showing = Arc<Mutex<Option<Shown>>>;

/// The code `shown` holds while it is still accepted.
fn open_code(shown: &Option<Shown>) -> Option<&Shown> {
    shown
        .as_ref()
        .filter(|shown| std::time::Instant::now() < shown.closes)
}

/// One endpoint serving, and the headsets connected to it.
pub struct Listening {
    endpoint: Endpoint,
    serving: Serving,
    accepting: AbortHandle,
    opened: Opened,
    paired: Arc<Mutex<Vec<PairedHeadset>>>,
    shown: Showing,
}

impl Listening {
    pub async fn start(start: Start, heard: Arc<dyn Heard>) -> Result<Self, String> {
        let key = start.kept.key().map_err(|_| NOT_KEPT.to_owned())?;
        let relay = match (&start.reach, &start.relay) {
            (Reach::Anywhere, Some(url)) => {
                Some(url.parse::<RelayUrl>().map_err(|_| NO_RELAY.to_owned())?)
            }
            _ => None,
        };
        let mut builder = Endpoint::builder(presets::Minimal)
            .secret_key(key)
            .alpns(vec![ALPN.to_vec()]);
        if start.announce {
            builder = builder
                .address_lookup(MdnsAddressLookup::builder().service_name(SERVICE))
                .user_data_for_address_lookup(
                    named(&start.name)
                        .parse()
                        .map_err(|_| NOT_KEPT.to_owned())?,
                );
        }
        builder = match (start.reach, relay) {
            (Reach::Local, _) => builder
                .relay_mode(RelayMode::Disabled)
                .portmapper_config(PortmapperConfig::Disabled),
            (Reach::Anywhere, Some(relay)) => builder.relay_mode(RelayMode::custom([relay])),
            (Reach::Anywhere, None) => builder
                .relay_mode(RelayMode::Default)
                .address_lookup(Unnamed(PkarrPublisher::n0_dns())),
        };
        let endpoint = builder
            .bind()
            .await
            .map_err(|_| COULD_NOT_START.to_owned())?;
        if start.reach == Reach::Anywhere {
            let _ = tokio::time::timeout(Duration::from_secs(10), endpoint.online()).await;
        }
        let paired = Arc::new(Mutex::new(start.kept.paired()));
        let opened: Opened = Arc::default();
        let shown: Showing = Arc::default();
        let accepting = tokio::spawn(accept(
            endpoint.clone(),
            Desk {
                shown: shown.clone(),
                kept: start.kept.clone(),
                paired: paired.clone(),
                opened: opened.clone(),
                heard,
            },
        ));
        let serving = Serving {
            id: endpoint.id().to_string(),
            ticket: EndpointTicket::new(endpoint.addr()).to_string(),
            name: start.announce.then(|| named(&start.name)),
            pairing: None,
            reach: start.reach,
            relay: start.relay.filter(|_| start.reach == Reach::Anywhere),
            paired: Vec::new(),
            connections: 0,
        };
        Ok(Self {
            endpoint,
            serving,
            accepting: accepting.abort_handle(),
            opened,
            paired,
            shown,
        })
    }

    /// Shows a fresh code for [`PAIR_WINDOW`], in place of any shown before.
    pub fn pair(&self) -> Result<Serving, String> {
        let code = new_code().ok_or_else(|| NOT_KEPT.to_owned())?;
        self.pair_on(code, PAIR_WINDOW);
        Ok(self.serving())
    }

    /// Shows `code` for `open_for`, or until one headset pairs by it.
    pub fn pair_on(&self, code: String, open_for: Duration) {
        let closes = std::time::Instant::now() + open_for;
        let until =
            now_ms().saturating_add(u64::try_from(open_for.as_millis()).unwrap_or(u64::MAX));
        *lock(&self.shown) = Some(Shown {
            code,
            closes,
            until,
        });
    }

    /// What is served now.
    pub fn serving(&self) -> Serving {
        Serving {
            ticket: EndpointTicket::new(self.endpoint.addr()).to_string(),
            pairing: open_code(&lock(&self.shown)).map(|shown| Pairing {
                code: shown.code.clone(),
                until: shown.until,
            }),
            paired: lock(&self.paired).clone(),
            connections: u32::try_from(lock(&self.opened).len()).unwrap_or(u32::MAX),
            ..self.serving.clone()
        }
    }

    /// One line back on `connection`. A connection since closed is not a failure.
    pub fn answer(&self, connection: &str, line: String) {
        if let Some(open) = lock(&self.opened).get(connection) {
            let _ = open.send.send(line);
        }
    }

    /// Forgets `id`, so it pairs by the code when it next connects.
    pub fn forget(&self, kept: &Kept, id: &str) {
        lock(&self.paired).retain(|one| one.id != id);
        kept.forget(id);
    }

    /// Lets every headset go and stops serving.
    pub async fn stop(self) {
        self.accepting.abort();
        for (_, open) in lock(&self.opened).drain() {
            open.task.abort();
        }
        self.endpoint.close().await;
    }
}

fn lock<T>(held: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    held.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What every connection on one desk shares.
#[derive(Clone)]
struct Desk {
    shown: Showing,
    kept: Kept,
    paired: Arc<Mutex<Vec<PairedHeadset>>>,
    opened: Opened,
    heard: Arc<dyn Heard>,
}

async fn accept(endpoint: Endpoint, desk: Desk) {
    let next = Arc::new(AtomicU64::new(1));
    while let Some(incoming) = endpoint.accept().await {
        let desk = desk.clone();
        let connection = next.fetch_add(1, Ordering::Relaxed).to_string();
        tokio::spawn(async move {
            let Ok(held) = incoming.await else { return };
            let (send, received) = mpsc::unbounded_channel();
            let task = tokio::spawn(serve_connection(
                held,
                connection.clone(),
                desk.clone(),
                received,
            ));
            lock(&desk.opened).insert(
                connection,
                Open {
                    send,
                    task: task.abort_handle(),
                },
            );
        });
    }
}

async fn serve_connection(
    held: Connection,
    connection: String,
    desk: Desk,
    answers: mpsc::UnboundedReceiver<String>,
) {
    let was_paired = carry(&held, &connection, &desk, answers).await;
    lock(&desk.opened).remove(&connection);
    held.close(0u32.into(), b"");
    if was_paired {
        desk.heard.closed(&connection);
    }
}

async fn carry(
    held: &Connection,
    connection: &str,
    desk: &Desk,
    mut answers: mpsc::UnboundedReceiver<String>,
) -> bool {
    let deadline = tokio::time::Instant::now() + FIRST_LINE;
    let Ok(Ok((mut send, recv))) = tokio::time::timeout_at(deadline, held.accept_bi()).await else {
        return false;
    };
    let mut lines = BufReader::new(recv).lines();
    let remote = held.remote_id().to_string();
    let paired_before = lock(&desk.paired).iter().any(|one| one.id == remote);
    if !paired_before && !paired(&mut lines, &mut send, &remote, deadline, desk).await {
        let _ = send.finish();
        let _ = tokio::time::timeout(LETTING_GO, send.stopped()).await;
        return false;
    }
    loop {
        tokio::select! {
            answer = answers.recv() => match answer {
                Some(line) => if say(&mut send, &line).await.is_err() { break },
                None => break,
            },
            line = lines.next_line() => match line {
                Ok(Some(line)) if !line.trim().is_empty() => desk.heard.call(ServeCall {
                    connection: connection.to_owned(),
                    line,
                }),
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => break,
            },
        }
    }
    true
}

/// Reads the first line from a headset not paired before and answers it; true
/// once it has paired, which spends the code. The headset is remembered before
/// it is told so.
async fn paired(
    lines: &mut tokio::io::Lines<BufReader<RecvStream>>,
    send: &mut SendStream,
    remote: &str,
    deadline: tokio::time::Instant,
    desk: &Desk,
) -> bool {
    let first = match tokio::time::timeout_at(deadline, lines.next_line()).await {
        Ok(Ok(Some(line))) => line,
        Ok(_) => return false,
        Err(_) => {
            let _ = say(send, &refusal(Value::Null, PAIR_TOO_LATE)).await;
            return false;
        }
    };
    let (answer, name) = {
        let mut shown = lock(&desk.shown);
        let answered = pairing_answer(&first, open_code(&shown).map(|shown| shown.code.as_str()));
        if answered.1.is_some() {
            *shown = None;
        }
        answered
    };
    let accepted = name.is_some();
    if let Some(name) = name {
        let mut paired = lock(&desk.paired);
        paired.retain(|one| one.id != remote);
        paired.push(PairedHeadset {
            id: remote.to_owned(),
            name,
            paired_at: now_ms(),
        });
        desk.kept.keep(&paired);
    }
    let _ = say(send, &answer).await;
    accepted
}

/// `pairingAnswer` in `serving.ts`: the line the first message from a headset
/// not paired before is answered with, given the code shown now, and — where it
/// paired — the name it gave.
fn pairing_answer(line: &str, code: Option<&str>) -> (String, Option<Option<String>>) {
    let asked: Option<Value> = serde_json::from_str(line).ok();
    let id = asked
        .as_ref()
        .and_then(|asked| asked.get("id"))
        .cloned()
        .unwrap_or(Value::Null);
    let asked = asked.filter(|asked| asked.get("method").and_then(Value::as_str) == Some("pair"));
    let Some(asked) = asked else {
        let words = if code.is_some() {
            NOT_PAIRED
        } else {
            NOT_PAIRING
        };
        let refused = json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": UNPAIRED, "message": words, "data": { "pairing": code.is_some() } },
        });
        return (refused.to_string(), None);
    };
    let params = asked.get("params");
    let given = params
        .and_then(|params| params.get("code"))
        .and_then(Value::as_str);
    if matches!(code, None | Some("")) || given != code {
        return (refusal(id, WRONG_CODE), None);
    }
    let name = params
        .and_then(|params| params.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| name.chars().take(NAMED_AT_MOST).collect());
    (
        json!({ "jsonrpc": "2.0", "id": id, "result": { "paired": true } }).to_string(),
        Some(name),
    )
}

fn refusal(id: Value, words: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": UNPAIRED, "message": words } })
        .to_string()
}

async fn say(send: &mut SendStream, line: &str) -> std::io::Result<()> {
    send.write_all(format!("{line}\n").as_bytes())
        .await
        .map_err(std::io::Error::other)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

/// What the desk is announced as: its name, cut to what one announcement holds.
fn named(name: &str) -> String {
    let mut named = String::new();
    for one in name.chars() {
        if named.len() + one.len_utf8() > 245 {
            break;
        }
        named.push(one);
    }
    named
}

/// The public address book, told where the desk is and never what it is called.
#[derive(Debug)]
struct Unnamed<B>(B);

#[derive(Debug)]
struct UnnamedLookup<L>(L);

impl<B: AddressLookupBuilder> AddressLookupBuilder for Unnamed<B> {
    fn into_address_lookup(
        self,
        endpoint: &Endpoint,
    ) -> Result<impl AddressLookup, AddressLookupBuilderError> {
        Ok(UnnamedLookup(self.0.into_address_lookup(endpoint)?))
    }
}

impl<L: AddressLookup> AddressLookup for UnnamedLookup<L> {
    fn publish(&self, data: &EndpointData) {
        let mut data = data.clone();
        data.set_user_data(None);
        self.0.publish(&data);
    }
}

/// A fresh code from the platform's cryptographic source.
fn new_code() -> Option<String> {
    let mut code = String::with_capacity(CODE_LENGTH);
    while code.len() < CODE_LENGTH {
        let mut byte = [0u8; 1];
        getrandom::getrandom(&mut byte).ok()?;
        // 250 is the largest multiple of ten a byte holds, so every digit is as likely.
        if byte[0] < 250 {
            code.push(char::from(b'0' + byte[0] % 10));
        }
    }
    Some(code)
}

/// What this app is serving, if anything.
#[derive(Default)]
pub struct Serve(tokio::sync::Mutex<Option<Listening>>);

struct ToThePage<R: Runtime>(AppHandle<R>);

impl<R: Runtime> Heard for ToThePage<R> {
    fn call(&self, call: ServeCall) {
        let _ = self.0.emit(CALL_EVENT, call);
    }

    fn closed(&self, connection: &str) {
        let _ = self
            .0
            .emit(CLOSED_EVENT, json!({ "connection": connection }));
    }
}

fn kept_for<R: Runtime>(app: &AppHandle<R>) -> Result<Kept, String> {
    app.path()
        .app_data_dir()
        .map(|data| Kept::at(data.join("serve")))
        .map_err(|_| NOT_KEPT.to_owned())
}

#[tauri::command]
pub async fn serve_start<R: Runtime>(
    app: AppHandle<R>,
    serve: State<'_, Serve>,
    reach: Reach,
    relay: Option<String>,
) -> Result<Serving, String> {
    let mut held = serve.0.lock().await;
    if let Some(listening) = held.as_ref() {
        let now = listening.serving();
        if now.reach == reach && now.relay == relay.clone().filter(|_| reach == Reach::Anywhere) {
            return Ok(now);
        }
    }
    if let Some(listening) = held.take() {
        listening.stop().await;
    }
    let listening = Listening::start(
        Start {
            reach,
            relay,
            name: gethostname::gethostname().to_string_lossy().into_owned(),
            kept: kept_for(&app)?,
            announce: true,
        },
        Arc::new(ToThePage(app)),
    )
    .await?;
    let serving = listening.serving();
    *held = Some(listening);
    Ok(serving)
}

#[tauri::command]
pub async fn serve_pair(serve: State<'_, Serve>) -> Result<Serving, String> {
    match serve.0.lock().await.as_ref() {
        Some(listening) => listening.pair(),
        None => Err(NOT_SERVING.to_owned()),
    }
}

#[tauri::command]
pub async fn serve_stop(serve: State<'_, Serve>) -> Result<(), String> {
    if let Some(listening) = serve.0.lock().await.take() {
        listening.stop().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn serve_status(serve: State<'_, Serve>) -> Result<Option<Serving>, String> {
    Ok(serve.0.lock().await.as_ref().map(Listening::serving))
}

#[tauri::command]
pub async fn serve_forget<R: Runtime>(
    app: AppHandle<R>,
    serve: State<'_, Serve>,
    id: String,
) -> Result<(), String> {
    let kept = kept_for(&app)?;
    match serve.0.lock().await.as_ref() {
        Some(listening) => listening.forget(&kept, &id),
        None => kept.forget(&id),
    }
    Ok(())
}

#[tauri::command]
pub async fn serve_answer(
    serve: State<'_, Serve>,
    connection: String,
    line: String,
) -> Result<(), String> {
    if let Some(listening) = serve.0.lock().await.as_ref() {
        listening.answer(&connection, line);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &str = "042917";

    #[derive(Default)]
    struct Heards(Mutex<Vec<ServeCall>>, Mutex<Vec<String>>);

    impl Heard for Heards {
        fn call(&self, call: ServeCall) {
            self.0.lock().unwrap().push(call);
        }

        fn closed(&self, connection: &str) {
            self.1.lock().unwrap().push(connection.to_owned());
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let at = std::env::temp_dir().join(format!(
            "sloppy-serve-{name}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&at);
        at
    }

    /// A desk on this network showing no code.
    async fn desk(kept: &Kept) -> (Listening, Arc<Heards>) {
        let heard = Arc::new(Heards::default());
        let listening = Listening::start(
            Start {
                reach: Reach::Local,
                relay: None,
                name: "The desk".to_owned(),
                kept: kept.clone(),
                announce: false,
            },
            heard.clone(),
        )
        .await
        .expect("serving");
        (listening, heard)
    }

    /// A headset: its own endpoint, dialled to the desk's address on one stream.
    struct Headset {
        endpoint: Endpoint,
        send: SendStream,
        lines: tokio::io::Lines<BufReader<RecvStream>>,
    }

    impl Headset {
        async fn dial(listening: &Listening, key: SecretKey) -> Self {
            let endpoint = Endpoint::builder(presets::Minimal)
                .secret_key(key)
                .relay_mode(RelayMode::Disabled)
                .bind()
                .await
                .expect("a headset");
            let ticket: EndpointTicket = listening.serving().ticket.parse().expect("a ticket");
            let held = endpoint
                .connect(ticket.endpoint_addr().clone(), ALPN)
                .await
                .expect("connected");
            let (send, recv) = held.open_bi().await.expect("a stream");
            Self {
                endpoint,
                send,
                lines: BufReader::new(recv).lines(),
            }
        }

        /// Pairs by `code`, answering what the desk said.
        async fn pair(listening: &Listening, code: &str) -> (Self, Value) {
            let mut headset = Self::dial(listening, SecretKey::generate()).await;
            let said = headset
                .ask(json!({ "jsonrpc": "2.0", "id": 1, "method": "pair", "params": { "code": code } }))
                .await
                .expect("an answer");
            (headset, said)
        }

        async fn ask(&mut self, line: Value) -> Option<Value> {
            say(&mut self.send, &line.to_string()).await.ok()?;
            self.next().await
        }

        async fn next(&mut self) -> Option<Value> {
            let line = tokio::time::timeout(Duration::from_secs(5), self.lines.next_line())
                .await
                .ok()?
                .ok()??;
            serde_json::from_str(&line).ok()
        }
    }

    async fn settles<T>(mut done: impl FnMut() -> Option<T>) -> T {
        for _ in 0..500 {
            if let Some(held) = done() {
                return held;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("never settled");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn pairs_by_the_code_once_and_by_the_key_after() {
        let kept = Kept::at(scratch("pairs"));
        let (listening, heard) = desk(&kept).await;
        listening.pair_on(CODE.to_owned(), PAIR_WINDOW);
        let quest = SecretKey::generate();

        let mut wrong = Headset::dial(&listening, quest.clone()).await;
        let refused = wrong
            .ask(json!({ "jsonrpc": "2.0", "id": 1, "method": "pair", "params": { "code": "000000" } }))
            .await
            .expect("an answer");
        assert_eq!(refused["error"]["code"], UNPAIRED);
        assert_eq!(refused["error"]["message"], WRONG_CODE);
        assert_eq!(wrong.next().await, None);

        let mut asking = Headset::dial(&listening, SecretKey::generate()).await;
        let refused = asking
            .ask(json!({ "jsonrpc": "2.0", "id": 1, "method": "projects/list" }))
            .await
            .expect("an answer");
        assert_eq!(refused["error"]["message"], NOT_PAIRED);
        assert_eq!(refused["error"]["data"], json!({ "pairing": true }));

        let mut one = Headset::dial(&listening, quest.clone()).await;
        let paired = one
            .ask(json!({ "jsonrpc": "2.0", "id": 1, "method": "pair", "params": { "code": CODE, "name": "Quest" } }))
            .await
            .expect("an answer");
        assert_eq!(
            paired,
            json!({ "jsonrpc": "2.0", "id": 1, "result": { "paired": true } })
        );
        let remembered = kept.paired();
        assert_eq!(remembered.len(), 1);
        assert_eq!(remembered[0].id, quest.public().to_string());
        assert_eq!(remembered[0].name.as_deref(), Some("Quest"));

        say(
            &mut one.send,
            r#"{"jsonrpc":"2.0","id":2,"method":"projects/list"}"#,
        )
        .await
        .unwrap();
        let call = settles(|| heard.0.lock().unwrap().first().cloned()).await;
        assert_eq!(
            call.line,
            r#"{"jsonrpc":"2.0","id":2,"method":"projects/list"}"#
        );
        listening.answer(&call.connection, "to the headset".to_owned());
        assert_eq!(
            one.lines.next_line().await.unwrap().as_deref(),
            Some("to the headset")
        );
        assert_eq!(listening.serving().connections, 1);
        one.endpoint.close().await;

        let mut again = Headset::dial(&listening, quest.clone()).await;
        say(
            &mut again.send,
            r#"{"jsonrpc":"2.0","id":3,"method":"projects/list"}"#,
        )
        .await
        .unwrap();
        settles(|| (heard.0.lock().unwrap().len() == 2).then_some(())).await;
        assert_eq!(listening.serving().paired.len(), 1);

        listening.forget(&kept, &quest.public().to_string());
        assert!(kept.paired().is_empty());
        assert!(listening.serving().paired.is_empty());
        let mut forgotten = Headset::dial(&listening, quest).await;
        let refused = forgotten
            .ask(json!({ "jsonrpc": "2.0", "id": 4, "method": "projects/list" }))
            .await
            .expect("an answer");
        assert_eq!(refused["error"]["message"], NOT_PAIRING);
        assert_eq!(refused["error"]["data"], json!({ "pairing": false }));

        for headset in [wrong, asking, again, forgotten] {
            headset.endpoint.close().await;
        }
        listening.stop().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn says_when_a_paired_connection_has_gone_and_carries_a_line_nobody_asked_for() {
        let (listening, heard) = desk(&Kept::at(scratch("closed"))).await;
        listening.pair_on(CODE.to_owned(), PAIR_WINDOW);
        let (mut one, said) = Headset::pair(&listening, CODE).await;
        assert_eq!(said["result"], json!({ "paired": true }));
        let mut stranger = Headset::dial(&listening, SecretKey::generate()).await;
        say(
            &mut stranger.send,
            r#"{"jsonrpc":"2.0","id":1,"method":"projects/list"}"#,
        )
        .await
        .unwrap();
        assert!(stranger.next().await.is_some());

        say(
            &mut one.send,
            r#"{"jsonrpc":"2.0","id":2,"method":"chat/say"}"#,
        )
        .await
        .unwrap();
        let call = settles(|| heard.0.lock().unwrap().first().cloned()).await;
        listening.answer(
            &call.connection,
            r#"{"jsonrpc":"2.0","method":"view/show","params":{}}"#.to_owned(),
        );
        assert_eq!(
            one.next().await,
            Some(json!({ "jsonrpc": "2.0", "method": "view/show", "params": {} }))
        );

        one.endpoint.close().await;
        stranger.endpoint.close().await;
        let gone = settles(|| {
            let gone = heard.1.lock().unwrap().clone();
            (!gone.is_empty()).then_some(gone)
        })
        .await;
        assert_eq!(gone, vec![call.connection]);
        listening.stop().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn is_the_same_desk_every_time_it_serves() {
        let kept = Kept::at(scratch("same"));
        let (first, _) = desk(&kept).await;
        let id = first.serving().id;
        first.stop().await;
        let (second, _) = desk(&kept).await;

        assert_eq!(second.serving().id, id);
        assert_eq!(second.serving().pairing, None);
        assert_eq!(second.serving().reach, Reach::Local);
        assert_eq!(
            second.serving().name,
            None,
            "a desk announced nowhere has no name"
        );
        second.stop().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn refuses_a_pair_while_no_code_is_shown() {
        let (listening, _) = desk(&Kept::at(scratch("resting"))).await;
        assert_eq!(listening.serving().pairing, None);

        let mut asking = Headset::dial(&listening, SecretKey::generate()).await;
        let refused = asking
            .ask(json!({ "jsonrpc": "2.0", "id": 1, "method": "projects/list" }))
            .await
            .expect("an answer");
        assert_eq!(refused["error"]["message"], NOT_PAIRING);
        assert_eq!(refused["error"]["data"], json!({ "pairing": false }));

        let (guessing, refused) = Headset::pair(&listening, CODE).await;
        assert_eq!(refused["error"]["code"], UNPAIRED);
        assert_eq!(refused["error"]["message"], WRONG_CODE);
        assert!(listening.serving().paired.is_empty());

        for headset in [asking, guessing] {
            headset.endpoint.close().await;
        }
        listening.stop().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn spends_a_code_on_the_first_headset_and_closes_it_on_time() {
        let (listening, _) = desk(&Kept::at(scratch("window"))).await;
        let shown = listening.pair().expect("a code").pairing.expect("shown");
        assert_eq!(shown.code.len(), CODE_LENGTH);
        let open_for = shown.until.saturating_sub(now_ms());
        assert!(
            (110_000..=120_000).contains(&open_for),
            "open for {open_for}ms"
        );

        let (first, said) = Headset::pair(&listening, &shown.code).await;
        assert_eq!(said["result"], json!({ "paired": true }));
        assert_eq!(listening.serving().pairing, None, "spent on the first");
        let (second, said) = Headset::pair(&listening, &shown.code).await;
        assert_eq!(said["error"]["message"], WRONG_CODE);

        listening.pair_on(CODE.to_owned(), Duration::from_millis(200));
        assert_eq!(
            listening.serving().pairing.map(|shown| shown.code),
            Some(CODE.to_owned())
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(listening.serving().pairing, None, "closed on time");
        let (late, said) = Headset::pair(&listening, CODE).await;
        assert_eq!(said["error"]["message"], WRONG_CODE);
        assert_eq!(listening.serving().paired.len(), 1);

        for headset in [first, second, late] {
            headset.endpoint.close().await;
        }
        listening.stop().await;
    }

    #[test]
    fn answers_a_first_line_as_the_terminal_does() {
        let (said, name) = pairing_answer(
            r#"{"jsonrpc":"2.0","id":7,"method":"pair","params":{"code":"042917","name":"  Quest  "}}"#,
            Some(CODE),
        );
        assert_eq!(
            serde_json::from_str::<Value>(&said).unwrap(),
            json!({ "jsonrpc": "2.0", "id": 7, "result": { "paired": true } })
        );
        assert_eq!(name, Some(Some("Quest".to_owned())));
        assert_eq!(pairing_answer("not a line", Some(CODE)).1, None);
        assert_eq!(
            pairing_answer(
                r#"{"id":1,"method":"pair","params":{"code":"042917"}}"#,
                None
            )
            .1,
            None
        );
    }

    #[test]
    fn refuses_every_other_first_line_from_a_headset_not_paired() {
        for method in [
            "projects/list",
            "field/list",
            "look/read",
            "picture/read",
            "tools/call",
        ] {
            for code in [Some(CODE), None] {
                let line = json!({ "jsonrpc": "2.0", "id": 3, "method": method, "params": { "note": "x" } });
                let (said, paired) = pairing_answer(&line.to_string(), code);
                let said: Value = serde_json::from_str(&said).unwrap();
                assert_eq!(paired, None, "{method} pairs nobody");
                assert_eq!(said["error"]["code"], UNPAIRED, "{method} is refused");
                assert_eq!(said["error"]["data"]["pairing"], code.is_some());
            }
        }
    }

    #[test]
    fn makes_a_code_of_six_digits() {
        for _ in 0..50 {
            let code = new_code().expect("a code");
            assert_eq!(code.len(), CODE_LENGTH);
            assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
        }
    }

    #[test]
    fn announces_a_name_no_longer_than_one_announcement_holds() {
        assert_eq!(named("desk"), "desk");
        assert!(named(&"é".repeat(400)).len() <= 245);
    }
}
