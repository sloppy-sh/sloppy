//! `SFSpeechRecognizer`, asked on a queue of its own so nothing waits on the
//! main thread. Only a recogniser that hears on this computer is used: one that
//! would send the recording to Apple is answered as no recogniser at all.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::AllocAnyThread as _;
use objc2_foundation::{NSError, NSLocale, NSOperationQueue, NSString, NSURL};
use objc2_speech::{
    SFSpeechRecognitionResult, SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
    SFSpeechURLRecognitionRequest,
};

pub(crate) use super::microphone::{microphone, request_microphone, Recorder};
use crate::wav::Recording;
use crate::{Authorization, Error, Result, Transcribed};

const LONGEST: Duration = Duration::from_secs(120);

/// How long somebody may leave the system's question unanswered before the
/// app stops waiting; their answer still counts the next time it asks.
const ANSWERED_WITHIN: Duration = Duration::from_secs(300);

fn recognizer(locale: Option<&str>) -> Option<Retained<SFSpeechRecognizer>> {
    // SAFETY: both initialisers answer nil for a language there is no recogniser for.
    unsafe {
        match locale {
            Some(id) => {
                let locale =
                    NSLocale::initWithLocaleIdentifier(NSLocale::alloc(), &NSString::from_str(id));
                SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
            }
            None => SFSpeechRecognizer::init(SFSpeechRecognizer::alloc()),
        }
    }
}

fn said(status: SFSpeechRecognizerAuthorizationStatus) -> Authorization {
    match status {
        SFSpeechRecognizerAuthorizationStatus::Authorized => Authorization::Authorized,
        SFSpeechRecognizerAuthorizationStatus::Denied => Authorization::Denied,
        SFSpeechRecognizerAuthorizationStatus::Restricted => Authorization::Restricted,
        _ => Authorization::Undecided,
    }
}

pub(crate) fn authorization() -> Authorization {
    // SAFETY: a class method reading the status; it asks nobody anything.
    said(unsafe { SFSpeechRecognizer::authorizationStatus() })
}

/// A recogniser for `locale` that hears on this computer.
fn on_device(locale: Option<&str>) -> Option<Retained<SFSpeechRecognizer>> {
    // SAFETY: a property read on a live recogniser.
    recognizer(locale).filter(|recognizer| unsafe { recognizer.supportsOnDeviceRecognition() })
}

pub(crate) fn available() -> bool {
    authorization() != Authorization::Restricted && on_device(None).is_some()
}

pub(crate) fn request_authorization() -> Authorization {
    let now = authorization();
    if now != Authorization::Undecided {
        return now;
    }
    let (tell, told) = mpsc::channel();
    let answered = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
        let _ = tell.send(status);
    });
    // SAFETY: the app's Info.plist carries NSSpeechRecognitionUsageDescription,
    // without which this call ends the process.
    unsafe { SFSpeechRecognizer::requestAuthorization(&answered) };
    told.recv_timeout(ANSWERED_WITHIN)
        .map(said)
        .unwrap_or(Authorization::Undecided)
}

pub(crate) fn transcribe(wav: &[u8], locale: Option<&str>) -> Result<Transcribed> {
    match authorization() {
        Authorization::Authorized => {}
        Authorization::Restricted => return Err(Error::Unavailable),
        Authorization::Denied | Authorization::Undecided => return Err(Error::NotAllowed),
    }
    let recognizer = on_device(locale).ok_or(Error::Unavailable)?;
    let recording = Recording::written(wav)?;
    let (tell, told) = mpsc::channel::<Result<String>>();
    let heard = RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
            // SAFETY: the recogniser hands either a live result, a live error, or both.
            match unsafe { result.as_ref() } {
                Some(result) if unsafe { result.isFinal() } => {
                    let words = unsafe { result.bestTranscription().formattedString() };
                    let _ = tell.send(Ok(words.to_string()));
                }
                _ if !error.is_null() => {
                    let _ = tell.send(Err(Error::Unheard));
                }
                _ => {}
            }
        },
    );
    // SAFETY: every object below lives on this thread until the answer is in
    // or the task is cancelled; the handler runs on `queue`.
    let task = unsafe {
        if !recognizer.isAvailable() {
            return Err(Error::Unavailable);
        }
        let queue = NSOperationQueue::new();
        recognizer.setQueue(&queue);
        let url = NSURL::fileURLWithPath(&NSString::from_str(&recording.path().to_string_lossy()));
        let request = SFSpeechURLRecognitionRequest::initWithURL(
            SFSpeechURLRecognitionRequest::alloc(),
            &url,
        );
        request.setShouldReportPartialResults(false);
        request.setRequiresOnDeviceRecognition(true);
        recognizer.recognitionTaskWithRequest_resultHandler(&request, &heard)
    };
    let answer = told.recv_timeout(LONGEST);
    if answer.is_err() {
        // SAFETY: cancelling a task that may already have finished is a no-op.
        unsafe { task.cancel() };
    }
    drop(recording);
    let said = answer.map_err(|_| Error::TooSlow)??;
    Ok(Transcribed {
        said: said.trim().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whether_the_computer_can_hear_is_answered_without_asking_anyone() {
        let can = available();
        let now = authorization();

        if now == Authorization::Restricted {
            assert!(!can);
        }
    }

    /// Runs only where somebody has already let this program hear: a test must
    /// never put the system's question in front of the person.
    #[test]
    fn a_recording_of_silence_is_heard_as_nothing_or_said_to_be_unheard() {
        if !available() || authorization() != Authorization::Authorized {
            eprintln!("skipped: this computer has not let the tests hear");
            return;
        }
        let silence = wav_of_silence(16_000, 1);

        match transcribe(&silence, None) {
            Ok(heard) => assert_eq!(heard.said, ""),
            Err(error) => assert!(matches!(error, Error::Unheard | Error::Unavailable)),
        }
    }

    fn wav_of_silence(rate: u32, seconds: u32) -> Vec<u8> {
        let sound = rate * seconds * 2;
        let mut wav = Vec::with_capacity(44 + sound as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + sound).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&sound.to_le_bytes());
        wav.resize(44 + sound as usize, 0);
        wav
    }
}
