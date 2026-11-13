## The reader's voice while a button is held, made into the recording the desk
## hears — docs/ARCHITECTURE.md § "A headset beside the desk". Nothing of it is
## kept once it is sent.
extends Node

## Recording has begun (`true`) or ended (`false`).
signal listening(on: bool)
## The desk heard `said` in what was recorded last.
signal heard(said: String)

## `SPEECH_RATE` in `@sloppy/types`.
const RATE := 16_000
## `SPEECH_LONGEST_MS` in `@sloppy/types`, in seconds.
const LONGEST := 60.0
## A press shorter than this is a bump, and is not listened to.
const SHORTEST := 0.3
const BUS := "Voice"

var _player: AudioStreamPlayer
var _record: AudioEffectRecord
var _asked := false
var _since := -1.0


func _ready() -> void:
	var bus := AudioServer.get_bus_index(BUS)
	if bus < 0:
		AudioServer.add_bus()
		bus = AudioServer.bus_count - 1
		AudioServer.set_bus_name(bus, BUS)
		# Heard by the recording, never played back into the room.
		AudioServer.set_bus_mute(bus, true)
		_record = AudioEffectRecord.new()
		_record.format = AudioStreamWAV.FORMAT_16_BITS
		AudioServer.add_bus_effect(bus, _record)
	else:
		_record = AudioServer.get_bus_effect(bus, 0) as AudioEffectRecord
	_player = AudioStreamPlayer.new()
	_player.stream = AudioStreamMicrophone.new()
	_player.bus = BUS
	add_child(_player)


## Whether the microphone is being listened to now.
func is_listening() -> bool:
	return _since >= 0.0


## Begin listening. The first time, on the headset, the reader is asked to let
## the app hear them.
func start() -> void:
	if is_listening() or _record == null:
		return
	if not _asked and OS.get_name() == "Android":
		_asked = true
		OS.request_permissions()
	_player.play()
	_record.set_recording_active(true)
	_since = Time.get_ticks_msec() / 1000.0
	listening.emit(true)


## Stop listening: the recording as `RATE` mono 16-bit WAV bytes, no longer
## than `LONGEST`, or empty where it was held shorter than `SHORTEST`.
func stop() -> PackedByteArray:
	if not is_listening():
		return PackedByteArray()
	var held := Time.get_ticks_msec() / 1000.0 - _since
	_end()
	var recording := _record.get_recording()
	if held < SHORTEST or recording == null:
		return PackedByteArray()
	return resampled(recording)


## Stop listening and let the recording go.
func cancel() -> void:
	if is_listening():
		_end()


## Stop listening and have the desk hear it, in `project` ("" is the desk's
## first): `{said}`, saying `heard`, or `{error, code}` in the desk's words.
## `{}` where it was held too briefly to send.
func hear(project: String, language := "") -> Dictionary:
	var wav := stop()
	if wav.is_empty():
		return {}
	var answer: Dictionary = await get_node("/root/Client").hear(project, wav, language)
	if answer.has("said"):
		heard.emit(str(answer.said))
	return answer


func _end() -> void:
	_record.set_recording_active(false)
	_player.stop()
	_since = -1.0
	listening.emit(false)


## `wav` as a `RATE` mono 16-bit WAV file, cut to `LONGEST`. Each sample is the
## mean of the source samples it stands for, so nothing above half of `RATE`
## folds back into what is heard. Empty where `wav` is not 8- or 16-bit PCM.
static func resampled(wav: AudioStreamWAV) -> PackedByteArray:
	var source := _samples(wav)
	if source.is_empty():
		return PackedByteArray()
	var step := float(wav.mix_rate) / RATE
	var count := mini(int(source.size() / step), int(LONGEST * RATE))
	var pcm := PackedByteArray()
	pcm.resize(count * 2)
	for at in count:
		var from := int(at * step)
		var to := maxi(from + 1, mini(int((at + 1) * step), source.size()))
		var sum := 0.0
		for one in range(from, to):
			sum += source[one]
		pcm.encode_s16(at * 2, clampi(roundi(sum / (to - from)), -32768, 32767))
	return wav_of(pcm)


## The samples of `wav`, the channels of a stereo one averaged.
static func _samples(wav: AudioStreamWAV) -> PackedFloat32Array:
	var data := wav.data
	var width := 0
	match wav.format:
		AudioStreamWAV.FORMAT_8_BITS:
			width = 1
		AudioStreamWAV.FORMAT_16_BITS:
			width = 2
		_:
			return PackedFloat32Array()
	var channels := 2 if wav.stereo else 1
	var frames := data.size() / (width * channels)
	var samples := PackedFloat32Array()
	samples.resize(frames)
	for frame in frames:
		var sum := 0.0
		for channel in channels:
			var at := (frame * channels + channel) * width
			sum += data.decode_s16(at) if width == 2 else data.decode_s8(at) * 256.0
		samples[frame] = sum / channels
	return samples


## `pcm` — `RATE` mono 16-bit samples — as a WAV file.
static func wav_of(pcm: PackedByteArray) -> PackedByteArray:
	var file := "RIFF".to_ascii_buffer()
	file.append_array(_u32(36 + pcm.size()))
	file.append_array("WAVEfmt ".to_ascii_buffer())
	file.append_array(_u32(16))
	file.append_array(_u16(1)) # PCM
	file.append_array(_u16(1)) # mono
	file.append_array(_u32(RATE))
	file.append_array(_u32(RATE * 2))
	file.append_array(_u16(2))
	file.append_array(_u16(16))
	file.append_array("data".to_ascii_buffer())
	file.append_array(_u32(pcm.size()))
	file.append_array(pcm)
	return file


static func _u32(value: int) -> PackedByteArray:
	var bytes := PackedByteArray()
	bytes.resize(4)
	bytes.encode_u32(0, value)
	return bytes


static func _u16(value: int) -> PackedByteArray:
	var bytes := PackedByteArray()
	bytes.resize(2)
	bytes.encode_u16(0, value)
	return bytes
