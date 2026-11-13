//! The microphone through `AVCaptureDevice` for whether it may be used, and
//! `AVAudioRecorder` for a recording in the format `SPEECH_RATE` names.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::AllocAnyThread as _;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaType, AVMediaTypeAudio};
use objc2_avf_audio::{
    AVAudioRecorder, AVFormatIDKey, AVLinearPCMBitDepthKey, AVLinearPCMIsBigEndianKey,
    AVLinearPCMIsFloatKey, AVNumberOfChannelsKey, AVSampleRateKey,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

use crate::{Authorization, Error, Result};

/// `kAudioFormatLinearPCM`.
const LINEAR_PCM: u32 = u32::from_be_bytes(*b"lpcm");

const RATE: f64 = 16_000.0;

/// How long somebody may leave the system's question unanswered before the
/// app stops waiting; their answer still counts the next time it asks.
const ANSWERED_WITHIN: Duration = Duration::from_secs(300);

fn audio() -> &'static AVMediaType {
    // SAFETY: a constant AVFoundation exports, present on every macOS it links on.
    unsafe { AVMediaTypeAudio }.expect("AVFoundation names audio")
}

fn said(status: AVAuthorizationStatus) -> Authorization {
    match status {
        AVAuthorizationStatus::Authorized => Authorization::Authorized,
        AVAuthorizationStatus::Denied => Authorization::Denied,
        AVAuthorizationStatus::Restricted => Authorization::Restricted,
        _ => Authorization::Undecided,
    }
}

pub(crate) fn microphone() -> Authorization {
    // SAFETY: a class method reading the status; it asks nobody anything.
    said(unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio()) })
}

pub(crate) fn request_microphone() -> Authorization {
    let now = microphone();
    if now != Authorization::Undecided {
        return now;
    }
    let (tell, told) = mpsc::channel();
    let answered = RcBlock::new(move |_: Bool| {
        let _ = tell.send(());
    });
    // SAFETY: the app's Info.plist carries NSMicrophoneUsageDescription,
    // without which this call ends the process.
    unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(audio(), &answered) };
    let _ = told.recv_timeout(ANSWERED_WITHIN);
    microphone()
}

pub(crate) struct Recorder(Retained<AVAudioRecorder>);

impl Recorder {
    /// Records into `at`, which it overwrites; refused unless the person has
    /// let the app use the microphone.
    pub(crate) fn start(at: &Path) -> Result<Self> {
        match microphone() {
            Authorization::Authorized => {}
            Authorization::Restricted => return Err(Error::CannotRecord),
            Authorization::Denied | Authorization::Undecided => {
                return Err(Error::MicrophoneNotAllowed)
            }
        }
        // SAFETY: constants AVFAudio exports, present on every macOS it links on.
        let keys: [&NSString; 6] = unsafe {
            [
                AVFormatIDKey,
                AVSampleRateKey,
                AVNumberOfChannelsKey,
                AVLinearPCMBitDepthKey,
                AVLinearPCMIsFloatKey,
                AVLinearPCMIsBigEndianKey,
            ]
        }
        .map(|key| key.expect("AVFAudio names its settings"));
        let values = [
            NSNumber::new_u32(LINEAR_PCM),
            NSNumber::new_f64(RATE),
            NSNumber::new_u32(1),
            NSNumber::new_u32(16),
            NSNumber::new_bool(false),
            NSNumber::new_bool(false),
        ];
        let values: Vec<&AnyObject> = values.iter().map(|value| value.as_ref()).collect();
        let settings = NSDictionary::<NSString, AnyObject>::from_slices(&keys, &values);
        let url = NSURL::fileURLWithPath(&NSString::from_str(&at.to_string_lossy()));
        // SAFETY: the settings name only keys AVAudioRecorder documents, with
        // values of the types it documents for them.
        let recorder = unsafe {
            AVAudioRecorder::initWithURL_settings_error(AVAudioRecorder::alloc(), &url, &settings)
        }
        .map_err(|_| Error::Unrecorded)?;
        // SAFETY: a recorder made above, on this thread.
        if unsafe { recorder.record() } {
            Ok(Recorder(recorder))
        } else {
            Err(Error::Unrecorded)
        }
    }

    /// Ends the recording, leaving the file whole.
    pub(crate) fn stop(self) {
        // SAFETY: stopping a recorder that has already stopped is a no-op.
        unsafe { self.0.stop() };
    }
}
