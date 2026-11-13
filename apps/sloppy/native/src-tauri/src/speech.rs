//! Turning a recording into words with the speech agent the person chose —
//! `SpeechAccess` in `@sloppy/app-core`, docs/ARCHITECTURE.md § "A headset
//! beside the desk". Nothing here knows which agent it is: a `key` agent is an
//! endpoint and a key, a `program` agent is `whisper-cli` and a model file, and
//! the `system` agent is this computer's own recogniser. Nothing of the
//! recording is kept.

use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_speech::SpeechExt as _;

use crate::program::{end_it, found, started};

const PROGRAM: &str = "whisper-cli";

/// A person's own answer to where the program is, for a machine keeping it
/// somewhere the usual folders do not reach.
const PROGRAM_ENV: &str = "SLOPPY_SPEECH_PROGRAM";

/// A minute of speech is heard well inside this on any machine that can hear
/// it at all.
const LONGEST: Duration = Duration::from_secs(120);

/// Long enough for the sentence an agent says about its own trouble.
const SAID_MAX: usize = 400;

/// Everything a program says beyond its words is read only to find its trouble.
const HEARD_MOST: u64 = 1 << 20;

const UNREADABLE: &str = "That could not be heard. Hold the button and try again.";
const NO_PROGRAM: &str =
    "The program that hears is not on the desk any more. On the desk, Settings → AI.";
const NO_MODEL: &str = "The desk has no model file to hear with. On the desk, Settings → AI.";
const PROGRAM_FAILED: &str =
    "The desk could not hear that with its program. Check the model file on the desk, Settings → AI.";
const TOO_SLOW: &str = "Hearing that took too long. Try something shorter.";
const UNREACHED: &str =
    "The desk could not reach what hears it. Check the desk is online and try again.";
const NOT_ANSWERED: &str = "What hears the desk did not answer. Try again in a moment.";
const SYSTEM_NOT_ALLOWED: &str = "The desk is not allowed to use speech recognition. On the desk, System Settings → Privacy & Security → Speech Recognition.";
const SYSTEM_CANNOT: &str =
    "The desk cannot hear with its own speech recognition right now. On the desk, Settings → AI.";
const SYSTEM_FAILED: &str = "The desk could not hear that just now. Try again.";

#[derive(Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Reach {
    Key,
    Program,
    System,
}

/// What the page asks a recording be heard with.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hearing {
    pub reach: Reach,
    pub model: String,
    /// Where a `key` agent hears: `<baseUrl>/audio/transcriptions`.
    pub base_url: Option<String>,
    pub key: Option<String>,
    /// The model file a `program` agent hears with.
    pub program_model: Option<String>,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Heard {
    said: String,
}

/// `wav` is base64: the bridge carries JSON.
#[tauri::command]
pub async fn speech_hear<R: Runtime>(
    app: AppHandle<R>,
    asked: Hearing,
    wav: String,
) -> Result<Heard, String> {
    let wav = BASE64.decode(wav).map_err(|_| UNREADABLE.to_string())?;
    match asked.reach {
        Reach::Key => by_key(&asked, wav).await,
        Reach::System => tauri::async_runtime::spawn_blocking(move || {
            app.speech()
                .transcribe(&wav, None)
                .map(|heard| Heard { said: heard.said })
                .map_err(|error| by_system_said(&error).to_string())
        })
        .await
        .map_err(|_| SYSTEM_FAILED.to_string())?,
        Reach::Program => {
            let program = found(PROGRAM, std::env::var_os(PROGRAM_ENV).as_deref())
                .ok_or_else(|| NO_PROGRAM.to_string())?;
            tauri::async_runtime::spawn_blocking(move || by_program(&program, &asked, &wav))
                .await
                .map_err(|_| PROGRAM_FAILED.to_string())?
        }
    }
}

#[tauri::command]
pub async fn speech_program_present() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        found(PROGRAM, std::env::var_os(PROGRAM_ENV).as_deref()).is_some()
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub async fn speech_system_present<R: Runtime>(app: AppHandle<R>) -> bool {
    tauri::async_runtime::spawn_blocking(move || app.speech().available())
        .await
        .unwrap_or(false)
}

fn by_system_said(error: &tauri_plugin_speech::Error) -> &'static str {
    use tauri_plugin_speech::Error;
    match error {
        Error::NotAllowed => SYSTEM_NOT_ALLOWED,
        Error::Unavailable => SYSTEM_CANNOT,
        Error::Unreadable | Error::Unheard => UNREADABLE,
        Error::TooSlow => TOO_SLOW,
        Error::Io(_)
        | Error::CannotRecord
        | Error::MicrophoneNotAllowed
        | Error::Unrecorded
        | Error::AlreadyRecording
        | Error::NotRecording => SYSTEM_FAILED,
    }
}

/// The model file a person picks, as a path: a model is too large to carry
/// across the bridge, and the program reads it where it lies.
#[tauri::command]
pub async fn speech_pick_model<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;

    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_file())
            .await
            .ok()??;
    picked
        .into_path()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

async fn by_key(asked: &Hearing, wav: Vec<u8>) -> Result<Heard, String> {
    let (Some(base), Some(key)) = (asked.base_url.as_deref(), asked.key.as_deref()) else {
        return Err(UNREACHED.to_string());
    };
    let boundary = format!("sloppy-speech-{}", random_hex());
    let body = multipart(&boundary, &asked.model, &wav);
    let client = reqwest::Client::builder()
        .timeout(LONGEST)
        .build()
        .map_err(|_| UNREACHED.to_string())?;
    let answered = client
        .post(format!(
            "{}/audio/transcriptions",
            base.trim_end_matches('/')
        ))
        .bearer_auth(key)
        .header(
            reqwest::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                TOO_SLOW
            } else {
                UNREACHED
            }
            .to_string()
        })?;
    let fine = answered.status().is_success();
    let said = answered
        .bytes()
        .await
        .ok()
        .and_then(|body| serde_json::from_slice::<serde_json::Value>(&body).ok())
        .ok_or_else(|| NOT_ANSWERED.to_string())?;
    if fine {
        return said["text"]
            .as_str()
            .map(|text| Heard {
                said: text.trim().to_string(),
            })
            .ok_or_else(|| NOT_ANSWERED.to_string());
    }
    Err(said["error"]["message"]
        .as_str()
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(|message| message.chars().take(SAID_MAX).collect())
        .unwrap_or_else(|| NOT_ANSWERED.to_string()))
}

fn multipart(boundary: &str, model: &str, wav: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(wav.len() + 512);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\n\
             Content-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn by_program(program: &Path, asked: &Hearing, wav: &[u8]) -> Result<Heard, String> {
    let model = asked
        .program_model
        .as_deref()
        .filter(|model| Path::new(model).is_file())
        .ok_or_else(|| NO_MODEL.to_string())?;
    let recording = Recording::written(wav).map_err(|_| PROGRAM_FAILED.to_string())?;
    let mut child = started(
        Command::new(program)
            .arg("-m")
            .arg(model)
            .arg("-f")
            .arg(&recording.0)
            .args(["-nt", "-np", "-l", "auto"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .map_err(|_| PROGRAM_FAILED.to_string())?;
    let words = read_all(child.stdout.take());
    let trouble = read_all(child.stderr.take());
    let began = Instant::now();
    let finished = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status.success()),
            Ok(None) if began.elapsed() < LONGEST => thread::sleep(Duration::from_millis(20)),
            _ => break None,
        }
    };
    let Some(fine) = finished else {
        end_it(child);
        return Err(TOO_SLOW.to_string());
    };
    let words = words.join().unwrap_or_default();
    let trouble = trouble.join().unwrap_or_default();
    if !fine {
        return Err(said_trouble(&trouble).unwrap_or_else(|| PROGRAM_FAILED.to_string()));
    }
    Ok(Heard {
        said: words.split_whitespace().collect::<Vec<_>>().join(" "),
    })
}

/// The program's own sentence about what went wrong, where it said one.
fn said_trouble(said: &str) -> Option<String> {
    said.lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with("error"))
        .map(|line| {
            let line = line
                .trim_start_matches("error")
                .trim_start_matches(':')
                .trim();
            let mut sentence: String = line.chars().take(SAID_MAX).collect();
            if let Some(first) = sentence.get(0..1) {
                sentence.replace_range(0..1, &first.to_uppercase());
            }
            sentence
        })
        .filter(|line| !line.is_empty())
}

fn read_all<R: std::io::Read + Send + 'static>(from: Option<R>) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let Some(from) = from else {
            return String::new();
        };
        let mut held = Vec::new();
        let mut reading = from.take(HEARD_MOST);
        let _ = reading.read_to_end(&mut held);
        let _ = std::io::copy(&mut reading.into_inner(), &mut std::io::sink());
        String::from_utf8_lossy(&held).into_owned()
    })
}

/// The recording on disk for as long as the program reads it.
struct Recording(PathBuf);

impl Recording {
    fn written(wav: &[u8]) -> std::io::Result<Self> {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let at = std::env::temp_dir().join(format!(
            "sloppy-speech-{}-{}-{}.wav",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
            random_hex()
        ));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&at)?;
        let recording = Recording(at);
        std::io::Write::write_all(&mut file, wav)?;
        Ok(recording)
    }
}

impl Drop for Recording {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn random_hex() -> String {
    let mut bytes = [0u8; 8];
    let _ = getrandom::getrandom(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(all(test, unix))]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::os::unix::fs::PermissionsExt as _;
    use std::sync::mpsc;

    use super::*;

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn scratch() -> PathBuf {
        let at = std::env::temp_dir().join(format!(
            "sloppy-speech-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&at);
        fs::create_dir_all(&at).expect("a scratch folder");
        at
    }

    /// A `whisper-cli` that writes down what it was asked and the recording it
    /// was handed, then says `script`.
    fn fake_program(folder: &Path, script: &str) -> PathBuf {
        let at = folder.join(PROGRAM);
        fs::write(
            &at,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{asked}'\nwhile [ $# -gt 0 ]; do\n  if [ \"$1\" = -f ]; then cp \"$2\" '{copy}'; printf '%s' \"$2\" > '{path}'; fi\n  shift\ndone\n{script}\n",
                asked = folder.join("asked").display(),
                copy = folder.join("copy.wav").display(),
                path = folder.join("path").display(),
            ),
        )
        .expect("a fake program");
        fs::set_permissions(&at, fs::Permissions::from_mode(0o755)).expect("runnable");
        at
    }

    fn by_this_program(model: Option<&Path>) -> Hearing {
        Hearing {
            reach: Reach::Program,
            model: String::new(),
            base_url: None,
            key: None,
            program_model: model.map(|model| model.to_string_lossy().into_owned()),
        }
    }

    #[test]
    fn a_program_hears_the_recording_and_the_recording_is_gone_afterwards() {
        let folder = scratch();
        let model = folder.join("ggml-base.bin");
        fs::write(&model, b"model").unwrap();
        let program = fake_program(
            &folder,
            "echo 'whisper_init: loading model' >&2\necho ' take me to the'\necho ' second note '",
        );
        let found = crate::program::found(PROGRAM, Some(program.as_os_str())).expect("found");

        let heard = by_program(&found, &by_this_program(Some(&model)), b"RIFFsound");

        assert_eq!(
            heard,
            Ok(Heard {
                said: "take me to the second note".into()
            })
        );
        let asked = fs::read_to_string(folder.join("asked")).unwrap();
        let recording = fs::read_to_string(folder.join("path")).unwrap();
        assert_eq!(
            asked.lines().collect::<Vec<_>>(),
            [
                "-m",
                model.to_str().unwrap(),
                "-f",
                &recording,
                "-nt",
                "-np",
                "-l",
                "auto"
            ]
        );
        assert_eq!(fs::read(folder.join("copy.wav")).unwrap(), b"RIFFsound");
        assert!(!Path::new(&recording).exists());
    }

    /// The only test that names the program by `PROGRAM_ENV`, so no other test
    /// reads it while it is set.
    #[test]
    fn the_desk_hears_a_recording_with_the_program_it_finds() {
        let folder = scratch();
        let model = folder.join("ggml-base.bin");
        fs::write(&model, b"model").unwrap();
        let program = fake_program(&folder, "echo ' hello there'");
        std::env::set_var(PROGRAM_ENV, &program);

        let app = tauri::test::mock_app();
        let present = tauri::async_runtime::block_on(speech_program_present());
        let heard = tauri::async_runtime::block_on(speech_hear(
            app.handle().clone(),
            by_this_program(Some(&model)),
            BASE64.encode(b"RIFFsound"),
        ));
        let unreadable = tauri::async_runtime::block_on(speech_hear(
            app.handle().clone(),
            by_this_program(Some(&model)),
            "not base64!".into(),
        ));
        std::env::remove_var(PROGRAM_ENV);

        assert!(present);
        assert_eq!(
            heard,
            Ok(Heard {
                said: "hello there".into()
            })
        );
        assert_eq!(unreadable, Err(UNREADABLE.to_string()));
    }

    /// Runs only where this computer has not let the tests hear, so it never
    /// hears a recording and never asks the person anything.
    #[test]
    fn the_system_agent_says_where_to_allow_it_until_this_computer_does() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        use tauri_plugin_speech::Authorization;

        let app = mock_builder()
            .plugin(tauri_plugin_speech::init())
            .build(mock_context(noop_assets()))
            .expect("an app");
        let now = app.speech().authorization();
        if now == Authorization::Authorized {
            eprintln!("skipped: this computer has let the tests hear");
            return;
        }
        let asked: Hearing = serde_json::from_value(serde_json::json!({
            "reach": "system",
            "model": ""
        }))
        .expect("the page's shape");

        let heard = tauri::async_runtime::block_on(speech_hear(
            app.handle().clone(),
            asked,
            BASE64.encode(b"RIFFsound"),
        ));

        let said = if now == Authorization::Restricted {
            SYSTEM_CANNOT
        } else {
            SYSTEM_NOT_ALLOWED
        };
        assert_eq!(heard, Err(said.to_string()));
    }

    #[test]
    fn a_program_that_fails_says_its_own_trouble_and_leaves_nothing_behind() {
        let folder = scratch();
        let model = folder.join("ggml-base.bin");
        fs::write(&model, b"model").unwrap();
        let program = fake_program(
            &folder,
            "echo 'whisper_init: loading model' >&2\necho 'error: failed to read the WAV file' >&2\nexit 3",
        );

        let heard = by_program(&program, &by_this_program(Some(&model)), b"RIFF");

        assert_eq!(heard, Err("Failed to read the WAV file".to_string()));
        let recording = fs::read_to_string(folder.join("path")).unwrap();
        assert!(!Path::new(&recording).exists());
    }

    #[test]
    fn a_model_file_that_is_not_there_is_said_before_anything_runs() {
        let folder = scratch();
        let program = fake_program(&folder, "echo never");

        let gone = by_program(
            &program,
            &by_this_program(Some(&folder.join("nowhere.bin"))),
            b"RIFF",
        );
        let none = by_program(&program, &by_this_program(None), b"RIFF");

        assert_eq!(gone, Err(NO_MODEL.to_string()));
        assert_eq!(none, Err(NO_MODEL.to_string()));
        assert!(!folder.join("asked").exists());
    }

    /// One answer from a server on the loopback, and the request it was sent.
    fn one_answer(status: &str, body: &'static str) -> (String, mpsc::Receiver<(String, Vec<u8>)>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let at = format!("http://{}/v1", listener.local_addr().unwrap());
        let status = status.to_string();
        let (tell, told) = mpsc::channel();
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                head.push_str(&line);
            }
            let length = head
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())?
                })
                .unwrap_or(0);
            let mut sent = vec![0; length];
            reader.read_exact(&mut sent).unwrap();
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            tell.send((head, sent)).unwrap();
        });
        (at, told)
    }

    fn by_key_at(base: &str) -> Hearing {
        Hearing {
            reach: Reach::Key,
            model: "a-model".into(),
            base_url: Some(base.into()),
            key: Some("sk-test".into()),
            program_model: None,
        }
    }

    #[test]
    fn a_key_agent_is_sent_the_recording_and_answers_its_words() {
        let (base, told) = one_answer("200 OK", r#"{"text":" Take me to the second note. "}"#);

        let heard =
            tauri::async_runtime::block_on(by_key(&by_key_at(&base), b"RIFFsound".to_vec()));

        assert_eq!(
            heard,
            Ok(Heard {
                said: "Take me to the second note.".into()
            })
        );
        let (head, sent) = told.recv().unwrap();
        assert!(head.starts_with("POST /v1/audio/transcriptions HTTP/1.1"));
        assert!(head
            .lines()
            .any(|line| line.eq_ignore_ascii_case("authorization: Bearer sk-test")));
        let boundary = head
            .lines()
            .find_map(|line| {
                line.split_once("boundary=")
                    .map(|(_, it)| it.trim().to_string())
            })
            .expect("a multipart body");
        let sent = String::from_utf8_lossy(&sent);
        assert!(sent.contains("name=\"model\"\r\n\r\na-model\r\n"));
        assert!(sent
            .contains("filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\nRIFFsound\r\n"));
        assert!(sent.ends_with(&format!("--{boundary}--\r\n")));
    }

    #[test]
    fn a_key_agent_that_refuses_is_heard_in_its_own_words() {
        let (base, _told) = one_answer(
            "401 Unauthorized",
            r#"{"error":{"message":"Invalid API Key","type":"invalid_request_error"}}"#,
        );

        let heard = tauri::async_runtime::block_on(by_key(&by_key_at(&base), b"RIFF".to_vec()));

        assert_eq!(heard, Err("Invalid API Key".to_string()));
    }

    #[test]
    fn a_key_agent_nobody_answers_for_says_so() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        drop(listener);

        let heard = tauri::async_runtime::block_on(by_key(&by_key_at(&base), b"RIFF".to_vec()));

        assert_eq!(heard, Err(UNREACHED.to_string()));
    }
}
