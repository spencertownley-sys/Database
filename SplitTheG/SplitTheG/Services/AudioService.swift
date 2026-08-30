import Foundation
import AVFoundation

/// Flow audio is a looping bed modulated by flow rate — never one-shots per
/// frame. All buffers are synthesized in code so the MVP ships with zero audio
/// assets; drop real recordings into `Resources/Audio` and swap the loaders
/// later. Failures degrade silently to a working (quieter) game.
protocol AudioProviding: AnyObject {
    func start()
    func shutdown()
    /// 0 = no flow, 1 = max drain/pour. Drives playback rate and gain.
    func setFlowRate(_ rate: Double)
    func playGlassSetDown()
    func playCascade()
    func playGradeStinger(success: Bool)
    var isEnabled: Bool { get set }
}

final class AudioService: AudioProviding {
    var isEnabled = true {
        didSet { engine.mainMixerNode.outputVolume = isEnabled ? 1.0 : 0.0 }
    }

    private let engine = AVAudioEngine()
    private let flowPlayer = AVAudioPlayerNode()
    private let oneShotPlayer = AVAudioPlayerNode()
    private let timePitch = AVAudioUnitTimePitch()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    private var started = false

    func start() {
        guard !started else { return }
        do {
            // .ambient: never interrupt the player's own music, no ducking.
            // The silent switch kills this category — which is exactly why
            // haptics carry Mode 2, not audio.
            try AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)

            engine.attach(flowPlayer)
            engine.attach(timePitch)
            engine.attach(oneShotPlayer)
            engine.connect(flowPlayer, to: timePitch, format: format)
            engine.connect(timePitch, to: engine.mainMixerNode, format: format)
            engine.connect(oneShotPlayer, to: engine.mainMixerNode, format: format)
            try engine.start()

            let bed = AudioSynth.flowBed(format: format, seconds: 2.0)
            flowPlayer.scheduleBuffer(bed, at: nil, options: [.loops])
            flowPlayer.volume = 0
            flowPlayer.play()
            started = true
        } catch {
            started = false // silent degrade
        }
    }

    func shutdown() {
        guard started else { return }
        flowPlayer.stop()
        oneShotPlayer.stop()
        engine.stop()
        started = false
    }

    func setFlowRate(_ rate: Double) {
        guard started else { return }
        let clamped = Float(max(0.0, min(1.0, rate)))
        // Faster flow reads as a higher, louder rush. Rate 0 fades the bed out
        // rather than stopping the player — restarting a node each sip clicks.
        flowPlayer.volume = clamped * 0.9
        timePitch.rate = 0.75 + clamped * 0.7
        timePitch.pitch = -200 + clamped * 500 // cents
    }

    func playGlassSetDown() {
        playOneShot(AudioSynth.setDownThump(format: format))
    }

    func playCascade() {
        playOneShot(AudioSynth.cascadeWash(format: format))
    }

    func playGradeStinger(success: Bool) {
        playOneShot(AudioSynth.stinger(format: format, success: success))
    }

    private func playOneShot(_ buffer: AVAudioPCMBuffer) {
        guard started, isEnabled else { return }
        oneShotPlayer.scheduleBuffer(buffer, at: nil)
        if !oneShotPlayer.isPlaying { oneShotPlayer.play() }
    }
}

/// Procedural stand-ins for recorded audio. Deliberately simple DSP — the point
/// is responsive feedback, not fidelity.
enum AudioSynth {
    /// Brown-ish noise loop: the liquid rushing bed.
    static func flowBed(format: AVAudioFormat, seconds: Double) -> AVAudioPCMBuffer {
        render(format: format, seconds: seconds) { samples, rate in
            _ = rate
            var last: Float = 0
            var rng = SystemRandomNumberGenerator()
            for index in samples.indices {
                let white = Float.random(in: -1...1, using: &rng)
                last = (last + 0.02 * white) / 1.02
                samples[index] = last * 3.5
            }
            // Crossfade head into tail so the loop point is seamless.
            let fade = min(2048, samples.count / 4)
            for offset in 0..<fade {
                let mix = Float(offset) / Float(fade)
                samples[offset] = samples[offset] * mix
                    + samples[samples.count - fade + offset] * (1 - mix)
            }
        }
    }

    /// Low decaying thud: glass on wood.
    static func setDownThump(format: AVAudioFormat) -> AVAudioPCMBuffer {
        tone(format: format, seconds: 0.25) { time in
            let envelope = exp(-time * 18)
            return (sin(2 * .pi * 90 * time) + 0.4 * sin(2 * .pi * 55 * time)) * envelope * 0.8
        }
    }

    /// Soft noise swell for the surge kicking off.
    static func cascadeWash(format: AVAudioFormat) -> AVAudioPCMBuffer {
        render(format: format, seconds: 1.2) { samples, rate in
            var last: Float = 0
            var rng = SystemRandomNumberGenerator()
            for index in samples.indices {
                let time = Float(index) / Float(rate)
                let white = Float.random(in: -1...1, using: &rng)
                last = (last + 0.05 * white) / 1.05
                let envelope = min(time / 0.2, 1) * exp(-max(0, time - 0.2) * 3)
                samples[index] = last * 2.5 * envelope
            }
        }
    }

    /// Little triad up = success, minor second down = failure.
    static func stinger(format: AVAudioFormat, success: Bool) -> AVAudioPCMBuffer {
        let notes: [Double] = success ? [523.25, 659.25, 784.0] : [440.0, 415.3]
        return tone(format: format, seconds: 0.6) { time in
            let step = min(notes.count - 1, Int(time / 0.15))
            let envelope = exp(-time * 4)
            return sin(2 * .pi * notes[step] * time) * envelope * 0.5
        }
    }

    private static func tone(
        format: AVAudioFormat,
        seconds: Double,
        _ sample: @escaping (Double) -> Double
    ) -> AVAudioPCMBuffer {
        render(format: format, seconds: seconds) { samples, rate in
            for frame in samples.indices {
                samples[frame] = Float(sample(Double(frame) / rate))
            }
        }
    }

    private static func render(
        format: AVAudioFormat,
        seconds: Double,
        fill: (inout UnsafeMutableBufferPointer<Float>, Double) -> Void
    ) -> AVAudioPCMBuffer {
        let rate = format.sampleRate
        let frames = AVAudioFrameCount(rate * seconds)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        var samples = UnsafeMutableBufferPointer(
            start: buffer.floatChannelData![0], count: Int(frames)
        )
        fill(&samples, rate)
        return buffer
    }
}
