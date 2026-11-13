use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::{async_runtime::spawn_blocking, command, AppHandle, Runtime};

use crate::{Authorization, Error, Recorded, Result, SpeechExt, Transcribed};

#[command]
pub(crate) async fn available<R: Runtime>(app: AppHandle<R>) -> bool {
    spawn_blocking(move || app.speech().available())
        .await
        .unwrap_or(false)
}

#[command]
pub(crate) async fn authorization<R: Runtime>(app: AppHandle<R>) -> Authorization {
    app.speech().authorization()
}

#[command]
pub(crate) async fn request_authorization<R: Runtime>(app: AppHandle<R>) -> Authorization {
    spawn_blocking(move || app.speech().request_authorization())
        .await
        .unwrap_or(Authorization::Undecided)
}

/// `wav` is base64: the bridge carries JSON.
#[command]
pub(crate) async fn transcribe<R: Runtime>(
    app: AppHandle<R>,
    wav: String,
    locale: Option<String>,
) -> Result<Transcribed> {
    let wav = BASE64.decode(wav).map_err(|_| Error::Unreadable)?;
    spawn_blocking(move || app.speech().transcribe(&wav, locale.as_deref()))
        .await
        .map_err(|_| Error::Unheard)?
}

#[command]
pub(crate) async fn microphone<R: Runtime>(app: AppHandle<R>) -> Authorization {
    app.speech().microphone()
}

#[command]
pub(crate) async fn request_microphone<R: Runtime>(app: AppHandle<R>) -> Authorization {
    spawn_blocking(move || app.speech().request_microphone())
        .await
        .unwrap_or(Authorization::Undecided)
}

#[command]
pub(crate) async fn start_recording<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    spawn_blocking(move || app.speech().start_recording())
        .await
        .map_err(|_| Error::Unrecorded)?
}

#[command]
pub(crate) async fn stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<Recorded> {
    let wav = spawn_blocking(move || app.speech().stop_recording())
        .await
        .map_err(|_| Error::Unrecorded)??;
    Ok(Recorded {
        wav: BASE64.encode(wav),
    })
}
