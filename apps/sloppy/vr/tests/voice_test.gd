## The recording a headset sends, made from a generated tone rather than a
## microphone. Run from apps/sloppy/vr with
## `Godot --headless --script res://tests/voice_test.gd`.
extends SceneTree

const VoiceScript := preload("res://interaction/voice.gd")
const TONE := 440.0
const SOURCE_RATE := 44_100

var _failed := 0


func _initialize() -> void:
	var made := VoiceScript.resampled(_tone(2.0, SOURCE_RATE, true))
	_check(made.slice(0, 4).get_string_from_ascii() == "RIFF" and made.slice(8, 12).get_string_from_ascii() == "WAVE", "is a WAV file")
	_check(made.decode_u16(22) == 1, "is mono: %d" % made.decode_u16(22))
	_check(made.decode_u32(24) == VoiceScript.RATE, "is at the rate the desk hears: %d" % made.decode_u32(24))
	_check(made.decode_u16(34) == 16, "is 16-bit")
	var samples := (made.size() - 44) / 2
	_check(made.decode_u32(40) == samples * 2, "says how long its sound is")
	_check(absf(samples / float(VoiceScript.RATE) - 2.0) <= 0.02, "keeps its length: %d samples" % samples)
	var heard := _frequency(made)
	_check(absf(heard - TONE) <= TONE * 0.01, "keeps its pitch: %.1f Hz" % heard)

	var long := VoiceScript.resampled(_tone(61.0, 22_050, false))
	var kept := (long.size() - 44) / 2.0 / VoiceScript.RATE
	_check(absf(kept - VoiceScript.LONGEST) < 0.001, "is cut to the longest the desk hears: %.3f s" % kept)

	var odd := AudioStreamWAV.new()
	odd.format = AudioStreamWAV.FORMAT_IMA_ADPCM
	odd.data = PackedByteArray([1, 2, 3, 4])
	_check(VoiceScript.resampled(odd).is_empty(), "makes nothing of a recording it cannot read")

	print("voice_test: %s" % ("FAILED %d" % _failed if _failed > 0 else "passed"))
	quit(1 if _failed > 0 else 0)


func _tone(seconds: float, rate: int, stereo: bool) -> AudioStreamWAV:
	var channels := 2 if stereo else 1
	var frames := int(seconds * rate)
	var data := PackedByteArray()
	data.resize(frames * channels * 2)
	for frame in frames:
		var sample := roundi(sin(TAU * TONE * frame / rate) * 12_000.0)
		for channel in channels:
			data.encode_s16((frame * channels + channel) * 2, sample)
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.stereo = stereo
	wav.data = data
	return wav


## The tone's frequency, from how often it crosses zero going up.
func _frequency(wav: PackedByteArray) -> float:
	var count := (wav.size() - 44) / 2
	var first := -1
	var last := -1
	var crossings := 0
	var was := wav.decode_s16(44)
	for at in range(1, count):
		var now := wav.decode_s16(44 + at * 2)
		if was < 0 and now >= 0:
			if first < 0:
				first = at
			else:
				crossings += 1
			last = at
		was = now
	return crossings * VoiceScript.RATE / float(last - first) if crossings > 0 else 0.0


func _check(held: bool, what: String) -> void:
	if not held:
		_failed += 1
		print("voice_test: does not hold: %s" % what)
