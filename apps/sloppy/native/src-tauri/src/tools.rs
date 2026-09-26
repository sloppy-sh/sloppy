//! The endpoint an agent calls Sloppy's own acts over: a JSON-RPC server on the
//! loopback, bound to a port nothing else has and answering only a caller
//! carrying the name it was started with. A call arrives here, is handed to the
//! webview, and the webview answers it — docs/ARCHITECTURE.md § "Asking a tool
//! to write the notes".
//!
//! **Nothing here knows what an act DOES.** The acts are the webview's,
//! advertised as it handed them over when the session opened, and this file
//! carries them out and carries the calls back. It holds no vocabulary of its
//! own, so a new act costs it nothing.

use std::collections::HashMap;
use std::io::Read as _;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Map, Value};
use tiny_http::{Header, Request, Response, Server};

/// What this endpoint calls itself where the agent names it, which is also what
/// the agent prefixes its calls with on its own side.
const NAME: &str = "sloppy";

/// Answered where a caller named no version of the protocol.
const PROTOCOL: &str = "2025-06-18";

/// The one path served. The agent is handed this URL and nothing else reaches
/// the endpoint by guessing at another.
const PATH: &str = "/mcp";

/// Longer than reading a project's notes takes, and long enough for somebody to
/// come back to the window and answer. A call nobody answered in that time is
/// told so rather than held, because an agent waiting on an answer that never
/// comes is a chat that has stopped without saying so.
const ANSWER_WITHIN: Duration = Duration::from_secs(600);

/// Longer than any call an agent composes. A body past this is not one.
const BODY_MAX: usize = 1024 * 1024;

const UNANSWERED: &str = "Nobody answered that. Ask again.";

/// One act as the agent is shown it — what `advertisedChatTools` in
/// `@sloppy/types` answered, handed over when the session opened.
#[derive(Clone, Deserialize)]
pub struct Advertised {
    pub name: String,
    pub description: String,
    /// JSON Schema for the call's arguments.
    pub arguments: Value,
}

/// A call on its way to the webview. `act` is the bare name the endpoint
/// advertised: whatever the agent prefixes it with is the agent's own spelling
/// and is gone by the time a call arrives.
pub struct Called {
    pub call: String,
    pub act: String,
    pub arguments: Value,
}

/// What the webview answered a call with.
#[derive(Deserialize)]
pub struct Answered {
    pub call: String,
    pub said: String,
    /// Whether it came to nothing the agent asked for, which the agent is told
    /// so it can act on it.
    pub trouble: bool,
}

type Waiting = Arc<Mutex<HashMap<String, mpsc::Sender<Answered>>>>;

/// The running endpoint. Dropping it closes the socket and lets the thread
/// serving it go.
pub struct Endpoint {
    port: u16,
    bearer: String,
    waiting: Waiting,
    server: Arc<Server>,
    serving: Option<JoinHandle<()>>,
}

impl Endpoint {
    /// Bind the loopback on a port the machine chooses and serve `tools`.
    /// `called` is given every call that arrives, on the thread serving it.
    pub fn start(
        tools: &[Advertised],
        called: Arc<dyn Fn(Called) + Send + Sync>,
    ) -> Result<Endpoint, String> {
        let server = Server::http("127.0.0.1:0").map_err(|why| why.to_string())?;
        let port = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| "no address".to_owned())?
            .port();
        let server = Arc::new(server);
        let bearer = minted();
        let waiting: Waiting = Waiting::default();
        let listed = Arc::new(listed(tools));
        let held = server.clone();
        let mine = waiting.clone();
        let token = bearer.clone();
        let serving = thread::spawn(move || {
            for request in held.incoming_requests() {
                // One thread per call: answering a call waits on the person, and
                // a second call must not be held up behind that.
                let listed = listed.clone();
                let mine = mine.clone();
                let token = token.clone();
                let called = called.clone();
                thread::spawn(move || serve(request, &listed, &token, &mine, called.as_ref()));
            }
        });
        Ok(Endpoint {
            port,
            bearer,
            waiting,
            server,
            serving: Some(serving),
        })
    }

    /// What the agent is started with, so that the name the endpoint answers to
    /// never reaches the webview and never becomes an argument a page composes.
    pub fn config(&self) -> String {
        let mut named = Map::new();
        named.insert(
            NAME.to_owned(),
            json!({
                "type": "http",
                "url": format!("http://127.0.0.1:{}{PATH}", self.port),
                "headers": { "Authorization": format!("Bearer {}", self.bearer) },
            }),
        );
        json!({ "mcpServers": Value::Object(named) }).to_string()
    }

    /// Hand the webview's answer to whoever is waiting on it. An answer to a
    /// call nothing is waiting on is not a failure.
    pub fn answer(&self, answered: Answered) {
        let waiting = self.waiting.lock().unwrap().remove(&answered.call);
        if let Some(says) = waiting {
            let _ = says.send(answered);
        }
    }
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        // Letting go of everything waiting tells each call so now, rather than
        // leaving a thread sitting out `ANSWER_WITHIN` on a session that is
        // over.
        self.waiting.lock().unwrap().clear();
        self.server.unblock();
        if let Some(serving) = self.serving.take() {
            let _ = serving.join();
        }
    }
}

fn serve(
    mut request: Request,
    listed: &Value,
    bearer: &str,
    waiting: &Waiting,
    called: &(dyn Fn(Called) + Send + Sync),
) {
    if request.url() != PATH || !carries(&request, bearer) {
        let _ = request.respond(Response::empty(404));
        return;
    }
    let mut body = String::new();
    let read = request
        .as_reader()
        .take(BODY_MAX as u64 + 1)
        .read_to_string(&mut body);
    if read.is_err() || body.len() > BODY_MAX {
        let _ = request.respond(Response::empty(400));
        return;
    }
    let Ok(asked) = serde_json::from_str::<Value>(&body) else {
        answered(
            request,
            Value::Null,
            Err((-32700, "Parse error".to_owned())),
        );
        return;
    };
    // No id at all is a notification, which is told and never answered.
    let Some(id) = asked.get("id").cloned() else {
        let _ = request.respond(Response::empty(202));
        return;
    };
    let method = asked.get("method").and_then(Value::as_str).unwrap_or("");
    let params = asked.get("params").cloned().unwrap_or(Value::Null);
    let answer = match method {
        "initialize" => Ok(initialized(&params)),
        "tools/list" => Ok(listed.clone()),
        "tools/call" => call(&params, waiting, called),
        _ => Err((-32601, format!("No method named {method}"))),
    };
    answered(request, id, answer);
}

fn call(
    params: &Value,
    waiting: &Waiting,
    called: &(dyn Fn(Called) + Send + Sync),
) -> Result<Value, (i64, String)> {
    let Some(act) = params.get("name").and_then(Value::as_str) else {
        return Err((-32602, "That call names no tool.".to_owned()));
    };
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let call = minted();
    let (says, hears) = mpsc::channel();
    waiting.lock().unwrap().insert(call.clone(), says);
    called(Called {
        call: call.clone(),
        act: act.to_owned(),
        arguments,
    });
    let heard = hears.recv_timeout(ANSWER_WITHIN);
    waiting.lock().unwrap().remove(&call);
    Ok(match heard {
        Ok(answer) => came_to(&answer.said, answer.trouble),
        Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
            came_to(UNANSWERED, true)
        }
    })
}

/// A call that came to nothing is an answer the agent reads and acts on, not a
/// protocol error: the chat goes on.
fn came_to(said: &str, trouble: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": said }], "isError": trouble })
}

fn initialized(params: &Value) -> Value {
    let version = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(PROTOCOL);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": NAME, "version": env!("CARGO_PKG_VERSION") },
    })
}

fn listed(tools: &[Advertised]) -> Value {
    let tools: Vec<Value> = tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.arguments,
            })
        })
        .collect();
    json!({ "tools": tools })
}

fn answered(request: Request, id: Value, answer: Result<Value, (i64, String)>) {
    let body = match answer {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    };
    let json =
        Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("a content type");
    let _ = request.respond(Response::from_string(body.to_string()).with_header(json));
}

fn carries(request: &Request, bearer: &str) -> bool {
    let named = format!("Bearer {bearer}");
    request
        .headers()
        .iter()
        .any(|header| header.field.equiv("Authorization") && header.value.as_str().trim() == named)
}

/// A name nothing can guess. The endpoint stands on the loopback, which every
/// other program on the machine can reach.
fn minted() -> String {
    use ssh_key::rand_core::{OsRng, RngCore as _};

    let mut held = [0u8; 24];
    OsRng.fill_bytes(&mut held);
    held.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Write as _};
    use std::net::TcpStream;

    use super::*;

    fn advertised() -> Vec<Advertised> {
        vec![Advertised {
            name: "list_notes".to_owned(),
            description: "List the notes this project already has.".to_owned(),
            arguments: json!({ "type": "object", "properties": {} }),
        }]
    }

    /// The URL and the name the endpoint answers to, read back out of what the
    /// agent would be started with.
    fn reached(endpoint: &Endpoint) -> (String, String) {
        let config: Value = serde_json::from_str(&endpoint.config()).expect("a config");
        let named = &config["mcpServers"][NAME];
        (
            named["url"].as_str().expect("a url").to_owned(),
            named["headers"]["Authorization"]
                .as_str()
                .expect("a name")
                .to_owned(),
        )
    }

    /// One request, answered. `None` where the answer carried no body.
    fn ask_at(url: &str, authorization: &str, body: &str) -> (u16, Option<Value>) {
        let at = url.trim_start_matches("http://");
        let (host, path) = at.split_once('/').expect("a path");
        let mut socket = TcpStream::connect(host).expect("the endpoint");
        write!(
            socket,
            "POST /{path} HTTP/1.1\r\nHost: {host}\r\nAuthorization: {authorization}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .expect("to ask");
        let mut reader = BufReader::new(socket);
        let mut status = String::new();
        reader.read_line(&mut status).expect("an answer");
        let code = status
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .expect("a status");
        let mut length = 0usize;
        loop {
            let mut header = String::new();
            reader.read_line(&mut header).expect("the headers");
            if header.trim().is_empty() {
                break;
            }
            if let Some((name, value)) = header.split_once(':') {
                if name.eq_ignore_ascii_case("content-length") {
                    length = value.trim().parse().unwrap_or(0);
                }
            }
        }
        let mut rest = vec![0u8; length];
        reader.read_exact(&mut rest).expect("the body");
        (code, serde_json::from_slice(&rest).ok())
    }

    fn asked(endpoint: &Endpoint, authorization: Option<&str>, body: &str) -> (u16, Option<Value>) {
        let (url, bearer) = reached(endpoint);
        ask_at(url.as_str(), authorization.unwrap_or(&bearer), body)
    }

    fn quiet() -> Arc<dyn Fn(Called) + Send + Sync> {
        Arc::new(|_| {})
    }

    #[test]
    fn it_advertises_what_it_was_handed_and_nothing_of_its_own() {
        let endpoint = Endpoint::start(&advertised(), quiet()).expect("the endpoint");

        let (_, answer) = asked(
            &endpoint,
            None,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
        );

        let tools = answer.expect("an answer")["result"]["tools"].clone();
        assert_eq!(tools[0]["name"], "list_notes");
        assert_eq!(tools[0]["inputSchema"]["type"], "object");
        assert_eq!(tools.as_array().expect("a list").len(), 1);
    }

    /// The endpoint stands on the loopback, so every other program on the
    /// machine can knock on it.
    #[test]
    fn a_caller_without_the_name_is_not_answered() {
        let endpoint = Endpoint::start(&advertised(), quiet()).expect("the endpoint");

        let (code, _) = asked(
            &endpoint,
            Some("Bearer not-the-one"),
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
        );

        assert_eq!(code, 404);
    }

    #[test]
    fn it_answers_the_version_of_the_protocol_it_was_asked_in() {
        let endpoint = Endpoint::start(&advertised(), quiet()).expect("the endpoint");

        let (_, answer) = asked(
            &endpoint,
            None,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}"#,
        );

        let result = answer.expect("an answer")["result"].clone();
        assert_eq!(result["protocolVersion"], "2024-11-05");
        assert_eq!(result["serverInfo"]["name"], NAME);
    }

    /// A request with no id is a notification: told, and never answered.
    #[test]
    fn a_notification_is_taken_and_not_answered() {
        let endpoint = Endpoint::start(&advertised(), quiet()).expect("the endpoint");

        let (code, body) = asked(
            &endpoint,
            None,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        );

        assert_eq!(code, 202);
        assert_eq!(body, None);
    }

    #[test]
    fn a_method_it_has_never_heard_of_is_said_so_rather_than_dropped() {
        let endpoint = Endpoint::start(&advertised(), quiet()).expect("the endpoint");

        let (_, answer) = asked(
            &endpoint,
            None,
            r#"{"jsonrpc":"2.0","id":7,"method":"resources/list"}"#,
        );

        let answer = answer.expect("an answer");
        assert_eq!(answer["id"], 7);
        assert_eq!(answer["error"]["code"], -32601);
    }

    /// A call reaches whoever serves it, and what they say comes back as the
    /// call's answer.
    #[test]
    fn a_call_is_answered_by_whoever_serves_it() {
        let (says, hears) = mpsc::channel();
        let endpoint = Endpoint::start(
            &advertised(),
            Arc::new(move |called: Called| {
                let _ = says.send(called);
            }),
        )
        .expect("the endpoint");
        let (url, bearer) = reached(&endpoint);
        let asking = thread::spawn(move || {
            ask_at(
                &url,
                &bearer,
                r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"write_note","arguments":{"about":"src/parser"}}}"#,
            )
        });

        let called = hears
            .recv_timeout(Duration::from_secs(10))
            .expect("the call");
        assert_eq!(called.act, "write_note");
        assert_eq!(called.arguments["about"], "src/parser");
        endpoint.answer(Answered {
            call: called.call,
            said: "written".to_owned(),
            trouble: false,
        });

        let (_, answer) = asking.join().expect("the asking");
        let result = answer.expect("an answer")["result"].clone();
        assert_eq!(result["content"][0]["text"], "written");
        assert_eq!(result["isError"], false);
    }

    /// A call nobody is waiting on is not a failure.
    #[test]
    fn an_answer_to_nothing_is_taken() {
        let endpoint = Endpoint::start(&advertised(), quiet()).expect("the endpoint");

        endpoint.answer(Answered {
            call: "nobody-asked".to_owned(),
            said: "hello".to_owned(),
            trouble: false,
        });
    }

    #[test]
    fn two_endpoints_answer_to_two_names() {
        let first = Endpoint::start(&advertised(), quiet()).expect("one endpoint");
        let second = Endpoint::start(&advertised(), quiet()).expect("another");

        assert_ne!(reached(&first), reached(&second));
    }
}
