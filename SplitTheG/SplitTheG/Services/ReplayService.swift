import Foundation

/// Records the level line and tilt at 60Hz during a Mode 2 attempt so the
/// player can watch the blind sip back in slow motion. In-memory, last attempt
/// only — image export happens from `ReplayView`.
final class ReplayService: ObservableObject {
    struct Sample: Codable, Equatable {
        var t: TimeInterval
        var levelFraction: Double
        var tiltDegrees: Double
    }

    struct Replay: Codable, Equatable {
        var samples: [Sample]
        var result: SplitResult?
        var duration: TimeInterval { samples.last?.t ?? 0 }
    }

    @Published private(set) var lastReplay: Replay?

    private var activeSamples: [Sample] = []
    private var recording = false

    func beginAttempt() {
        activeSamples = []
        recording = true
    }

    func record(state: SplitState) {
        guard recording else { return }
        activeSamples.append(
            Sample(
                t: state.elapsedSeconds,
                levelFraction: state.levelFraction,
                tiltDegrees: state.tiltDegrees
            )
        )
    }

    func endAttempt(result: SplitResult?) {
        guard recording else { return }
        recording = false
        lastReplay = Replay(samples: activeSamples, result: result)
        activeSamples = []
    }

    /// Level at a playback timestamp, linearly interpolated between samples.
    func level(at time: TimeInterval) -> Double? {
        guard let replay = lastReplay, let first = replay.samples.first else { return nil }
        guard time > first.t else { return first.levelFraction }
        var previous = first
        for sample in replay.samples {
            if sample.t >= time {
                let span = sample.t - previous.t
                guard span > 0 else { return sample.levelFraction }
                let mix = (time - previous.t) / span
                return previous.levelFraction
                    + (sample.levelFraction - previous.levelFraction) * mix
            }
            previous = sample
        }
        return replay.samples.last?.levelFraction
    }
}
