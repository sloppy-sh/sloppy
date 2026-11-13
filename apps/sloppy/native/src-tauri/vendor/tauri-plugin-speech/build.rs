const COMMANDS: &[&str] = &[
    "available",
    "authorization",
    "request_authorization",
    "transcribe",
    "microphone",
    "request_microphone",
    "start_recording",
    "stop_recording",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
