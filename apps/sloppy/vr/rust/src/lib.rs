//! `IrohLink`: the headset's one link to a desk serving Sloppy — found on this
//! network or named by a ticket, dialled by its key, one stream of lines each
//! way. docs/ARCHITECTURE.md § "A headset beside the desk"; apps/sloppy/vr/README.md
//! says how it is built.

use std::sync::mpsc::{self, Receiver, Sender};

use godot::classes::{INode, Node, ProjectSettings};
use godot::prelude::*;
use iroh::address_lookup::{DnsAddressLookup, PkarrResolver};
use iroh::endpoint::{presets, PortmapperConfig, SendStream};
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey};
use iroh_mdns_address_lookup::{DiscoveryEvent, MdnsAddressLookup};
use iroh_tickets::endpoint::EndpointTicket;
use n0_future::StreamExt as _;
use tokio::io::{AsyncBufReadExt as _, BufReader};
use tokio::runtime::Runtime;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::task::JoinHandle;

mod multicast;
use multicast::MulticastLock;

/// `SERVE_ALPN` in `@sloppy/types`.
const ALPN: &[u8] = b"sloppy/serve/1";
/// What a desk announces itself as on a network; `SERVICE` in the desk's `serve.rs`.
const SERVICE: &str = "sloppy";
/// Where this headset's own key is kept.
const KEY: &str = "user://headset.key";

const UNREACHABLE: &str =
    "The desk could not be reached. Check Sloppy is serving on it and this headset is on the same network, or enter the desk's address.";
const LET_GO: &str = "The desk stopped serving this headset.";
const NOT_STARTED: &str = "This headset could not reach the network. Try again.";

struct SloppyIroh;

#[gdextension]
unsafe impl ExtensionLibrary for SloppyIroh {}

enum Heard {
    DeskFound { name: String, id: String },
    Opened,
    Line(String),
    Closed(String),
}

struct Link {
    lines: UnboundedSender<String>,
    task: JoinHandle<()>,
    /// The endpoint a desk beyond this network is dialled from; none for one on it.
    own: Option<Endpoint>,
}

/// One desk at a time, reached from this headset.
#[derive(GodotClass)]
#[class(base = Node)]
pub struct IrohLink {
    base: Base<Node>,
    runtime: Option<Runtime>,
    heard: Sender<Heard>,
    hearing: Receiver<Heard>,
    key: Option<SecretKey>,
    /// The endpoint that looks for desks on this network and dials them.
    here: Option<(Endpoint, MdnsAddressLookup)>,
    discovering: Option<JoinHandle<()>>,
    /// Held from looking for a desk, or dialling one by id, until a link opens.
    listening: Option<MulticastLock>,
    link: Option<Link>,
}

#[godot_api]
impl INode for IrohLink {
    fn init(base: Base<Node>) -> Self {
        let (heard, hearing) = mpsc::channel();
        Self {
            base,
            runtime: tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .ok(),
            heard,
            hearing,
            key: None,
            here: None,
            discovering: None,
            listening: None,
            link: None,
        }
    }

    fn ready(&mut self) {
        self.base_mut().set_process(true);
    }

    fn process(&mut self, _delta: f64) {
        while let Ok(heard) = self.hearing.try_recv() {
            match heard {
                Heard::DeskFound { name, id } => {
                    self.base_mut().emit_signal(
                        "desk_found",
                        &[
                            GString::from(&name).to_variant(),
                            GString::from(&id).to_variant(),
                        ],
                    );
                }
                Heard::Opened => {
                    self.listening = None;
                    self.base_mut().emit_signal("opened", &[]);
                }
                Heard::Line(line) => {
                    self.base_mut()
                        .emit_signal("line", &[GString::from(&line).to_variant()]);
                }
                Heard::Closed(reason) => {
                    self.let_go();
                    self.base_mut()
                        .emit_signal("closed", &[GString::from(&reason).to_variant()]);
                }
            }
        }
    }

    fn exit_tree(&mut self) {
        self.close();
        self.listening = None;
        if let Some(handle) = self.discovering.take() {
            handle.abort();
        }
        if let (Some(runtime), Some((endpoint, _))) = (self.runtime.as_ref(), self.here.take()) {
            runtime.block_on(endpoint.close());
        }
    }
}

#[godot_api]
impl IrohLink {
    /// A desk on this network said it is there: what it is called, and the id to dial.
    #[signal]
    fn desk_found(name: GString, id: GString);

    /// The link to the desk is open; lines sent before it are on their way.
    #[signal]
    fn opened();

    /// One line the desk sent.
    #[signal]
    fn line(text: GString);

    /// The link ended, in words for the person. A link this headset closed says nothing.
    #[signal]
    fn closed(reason: GString);

    /// Listens for desks on this network, saying each as `desk_found`. Announces nothing.
    #[func]
    fn discover(&mut self) {
        self.listen();
        if self.discovering.is_some() || self.here().is_none() {
            return;
        }
        let (Some(runtime), Some((_, mdns))) = (self.runtime.as_ref(), self.here.as_ref()) else {
            return;
        };
        let mdns = mdns.clone();
        let heard = self.heard.clone();
        self.discovering = Some(runtime.spawn(async move {
            let mut events = mdns.subscribe().await;
            while let Some(event) = events.next().await {
                if let DiscoveryEvent::Discovered { endpoint_info, .. } = event {
                    let id = endpoint_info.endpoint_id.to_string();
                    let name = endpoint_info
                        .data
                        .user_data()
                        .map_or_else(|| id.chars().take(8).collect(), |name| name.to_string());
                    if heard.send(Heard::DeskFound { name, id }).is_err() {
                        return;
                    }
                }
            }
        }));
    }

    /// Dials the desk an id or a ticket names, dropping any link before it.
    /// False where `id_or_ticket` names no desk.
    #[func]
    fn connect_to(&mut self, id_or_ticket: GString) -> bool {
        let said = id_or_ticket.to_string();
        let said = said.trim();
        let addr = if let Ok(ticket) = said.parse::<EndpointTicket>() {
            ticket.endpoint_addr().clone()
        } else if let Ok(id) = said.parse::<EndpointId>() {
            EndpointAddr::new(id)
        } else {
            return false;
        };
        self.close();
        let relays: Vec<RelayUrl> = addr.relay_urls().cloned().collect();
        let own = if relays.is_empty() {
            None
        } else {
            match self.beyond(relays) {
                Some(endpoint) => Some(endpoint),
                None => {
                    let _ = self.heard.send(Heard::Closed(NOT_STARTED.to_owned()));
                    return true;
                }
            }
        };
        if own.is_none() {
            self.listen();
        }
        let Some(endpoint) = own
            .clone()
            .or_else(|| self.here().map(|(endpoint, _)| endpoint))
        else {
            let _ = self.heard.send(Heard::Closed(NOT_STARTED.to_owned()));
            return true;
        };
        let Some(runtime) = self.runtime.as_ref() else {
            return true;
        };
        let (lines, outgoing) = unbounded_channel();
        let task = runtime.spawn(carry(endpoint, addr, outgoing, self.heard.clone()));
        self.link = Some(Link { lines, task, own });
        true
    }

    /// One line to the desk, on its way once the link is open.
    #[func]
    fn send(&mut self, line: GString) {
        if let Some(link) = self.link.as_ref() {
            let _ = link.lines.send(line.to_string());
        }
    }

    /// Lets the desk go.
    #[func]
    fn close(&mut self) {
        self.let_go();
    }

    /// This headset's own id, which a desk remembers it by.
    #[func]
    fn own_id(&mut self) -> GString {
        self.key()
            .map(|key| GString::from(&key.public().to_string()))
            .unwrap_or_default()
    }
}

impl IrohLink {
    fn listen(&mut self) {
        if self.listening.is_none() {
            self.listening = MulticastLock::acquire();
        }
    }

    fn let_go(&mut self) {
        if let Some(link) = self.link.take() {
            link.task.abort();
            if let (Some(runtime), Some(own)) = (self.runtime.as_ref(), link.own) {
                runtime.spawn(async move { own.close().await });
            }
        }
    }

    /// This headset's key, made once and kept in `user://`.
    fn key(&mut self) -> Option<SecretKey> {
        if let Some(key) = self.key.as_ref() {
            return Some(key.clone());
        }
        let path = ProjectSettings::singleton().globalize_path(KEY).to_string();
        let key = std::fs::read(&path)
            .ok()
            .and_then(|bytes| <[u8; 32]>::try_from(bytes.as_slice()).ok())
            .map(|bytes| SecretKey::from_bytes(&bytes))
            .or_else(|| {
                let made = SecretKey::generate();
                std::fs::write(&path, made.to_bytes()).ok()?;
                Some(made)
            })?;
        self.key = Some(key.clone());
        Some(key)
    }

    /// The endpoint for this network, made on first use.
    fn here(&mut self) -> Option<(Endpoint, MdnsAddressLookup)> {
        if let Some(here) = self.here.as_ref() {
            return Some(here.clone());
        }
        let key = self.key()?;
        let runtime = self.runtime.as_ref()?;
        let here = runtime.block_on(async move {
            let endpoint = Endpoint::builder(presets::Minimal)
                .secret_key(key)
                .relay_mode(RelayMode::Disabled)
                .portmapper_config(PortmapperConfig::Disabled)
                .bind()
                .await
                .ok()?;
            let mdns = MdnsAddressLookup::builder()
                .advertise(false)
                .service_name(SERVICE)
                .build(endpoint.id())
                .ok()?;
            endpoint.address_lookup().ok()?.add(mdns.clone());
            Some((endpoint, mdns))
        })?;
        self.here = Some(here.clone());
        Some(here)
    }

    /// An endpoint for a desk beyond this network, through the relays its
    /// ticket names, and the public address book where they are the public ones.
    fn beyond(&mut self, relays: Vec<RelayUrl>) -> Option<Endpoint> {
        let key = self.key()?;
        let runtime = self.runtime.as_ref()?;
        let public = RelayMode::Default.relay_map();
        let looked_up = relays.iter().all(|relay| public.contains(relay));
        runtime.block_on(async move {
            let mut builder = Endpoint::builder(presets::Minimal)
                .secret_key(key)
                .relay_mode(RelayMode::custom(relays));
            if looked_up {
                builder = builder
                    .address_lookup(PkarrResolver::n0_dns())
                    .address_lookup(DnsAddressLookup::n0_dns());
            }
            builder.bind().await.ok()
        })
    }
}

/// One link: dial, open the stream, then lines both ways until either side ends.
async fn carry(
    endpoint: Endpoint,
    addr: EndpointAddr,
    mut outgoing: UnboundedReceiver<String>,
    heard: Sender<Heard>,
) {
    let Ok(held) = endpoint.connect(addr, ALPN).await else {
        let _ = heard.send(Heard::Closed(UNREACHABLE.to_owned()));
        return;
    };
    let Ok((mut send, recv)) = held.open_bi().await else {
        let _ = heard.send(Heard::Closed(UNREACHABLE.to_owned()));
        return;
    };
    let _ = heard.send(Heard::Opened);
    let mut lines = BufReader::new(recv).lines();
    loop {
        tokio::select! {
            line = outgoing.recv() => match line {
                Some(line) => if say(&mut send, &line).await.is_err() { break },
                None => return,
            },
            line = lines.next_line() => match line {
                Ok(Some(line)) if !line.trim().is_empty() => {
                    if heard.send(Heard::Line(line)).is_err() { return }
                }
                Ok(Some(_)) => {}
                Ok(None) | Err(_) => break,
            },
        }
    }
    let _ = heard.send(Heard::Closed(LET_GO.to_owned()));
}

async fn say(send: &mut SendStream, line: &str) -> Result<(), ()> {
    send.write_all(format!("{line}\n").as_bytes())
        .await
        .map_err(|_| ())
}
