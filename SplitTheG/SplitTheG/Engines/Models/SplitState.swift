import Foundation

/// Snapshot of a Mode 2 attempt, produced by `SplitEngine.tick`.
/// Scenes render this; services (audio/haptics) modulate off `drainRatePerSecond`.
struct SplitState: Equatable {
    enum Phase: Equatable {
        /// Not yet calibrated/armed.
        case idle
        /// Calibrated, waiting for the first tilt past the pour threshold.
        case armed
        /// Tilted past `Balance.pourThresholdDegrees`; liquid is draining.
        case flowing
        /// Returned below the threshold after flowing; attempt is over and scored.
        case scored
    }

    var phase: Phase = .idle

    /// Liquid line as a fraction of the column. 1.0 = full, 0.0 = empty.
    var levelFraction: Double = 1.0

    /// Current drain rate in column-fraction per second (0 when not flowing).
    /// This is the sole driver for flow audio pitch/gain and haptic intensity.
    var drainRatePerSecond: Double = 0.0

    /// Filtered tilt, degrees from calibrated upright. For HUD/debug only.
    var tiltDegrees: Double = 0.0

    /// Seconds since the attempt was armed.
    var elapsedSeconds: TimeInterval = 0.0

    /// Seconds spent past the pour threshold (the actual "sip").
    var flowDurationSeconds: TimeInterval = 0.0

    var peakTiltDegrees: Double = 0.0

    /// Sign flips of angular velocity above `Balance.minAngularVelocity` — the
    /// shake detector's evidence.
    var directionChanges: Int = 0

    /// True when the liquid line just crossed into the G band this tick
    /// (one-shot flag for the `enterGBand` haptic transient).
    var enteredGBandThisTick: Bool = false

    var result: SplitResult?
}

/// Final outcome of a scored Mode 2 attempt.
struct SplitResult: Codable, Equatable {
    var grade: SplitGrade
    /// Signed distance from the center of the G, in millimetres.
    /// Positive = stopped above center (shy side), negative = below (sunk side).
    var deltaMM: Double
    var finalLevelFraction: Double
    var flowDurationSeconds: TimeInterval
    /// True when the attempt used the on-screen touch fallback instead of motion.
    var assisted: Bool
    var date: Date = .now
}
