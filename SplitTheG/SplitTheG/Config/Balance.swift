import Foundation

/// Single source of truth for every tunable in the game.
/// If you type a float literal into a scene or engine, it is a bug — it belongs here
/// or in `GlassGeometry`.
enum Balance {
    // MARK: - Cascade

    /// NOT the real ~119.5s settle. Deliberately compressed — a mobile session cannot
    /// carry a two-minute forced wait, and the fantasy survives the cut.
    static let cascadeSettleDuration: TimeInterval = 4.0
    static let cascadeTopOffGraceWindow: TimeInterval = 3.0

    // MARK: - Pour flow

    static let baseFlowPerSecond: Double = 0.22      // full glass ≈ 4.5s
    static let topOffFlowMultiplier: Double = 0.40

    // MARK: - Split drain

    static let pourThresholdDegrees: Double = 20.0
    static let maxTiltDegrees: Double = 70.0
    static let maxDrainPerSecond: Double = 0.45      // full drain ≈ 2.2s
    static let drainExponent: Double = 1.5

    // MARK: - Motion

    static let motionUpdateHz: Double = 60.0
    static let tiltLowPassAlpha: Double = 0.15

    // MARK: - Split integrity

    static let minAttemptDuration: TimeInterval = 0.6
    static let minPeakTiltDegrees: Double = 30.0
    static let minAngularVelocity: Double = 0.5
    static let maxDirectionChanges: Int = 8

    // MARK: - Pour scoring

    static let targetAngleDegrees: Double = 45.0
    static let angleToleranceDegrees: Double = 15.0
    static let fillLineTolerance: Double = 0.08
    static let headToleranceMM: Double = 6.0
    static let pourParTime: TimeInterval = 18.0

    // MARK: - Rush

    static let rushBaseSpawnInterval: TimeInterval = 4.2
    static let rushSpawnDecay: Double = 0.93
    static let rushMinSpawnInterval: TimeInterval = 0.9
    static let rushBasePatience: TimeInterval = 12.0
    static let rushPatienceDecay: Double = 0.94
    static let rushMinPatience: TimeInterval = 4.0
    static let rushCustomersPerWave: Int = 8
    static let rushMaxWalkouts: Int = 3
    static let rushMaxComboMultiplier: Double = 3.0

    // MARK: - Derived / extended tunables
    // Everything below exists so no engine or scene ever holds a bare literal.

    /// Split grading bands, measured from the center of the G.
    static let splitPerfectDeltaMM: Double = 0.75
    static let splitCleanDeltaMM: Double = 2.0

    /// Meniscus grace: how far past the rim the column can climb before it spills.
    static let spillGraceFraction: Double = 0.015

    /// A part-one release below this fraction is treated as a fumbled tap, not a pour.
    static let partOneMinimumFraction: Double = 0.05

    /// Settle score floor when the player dawdles long past the grace window.
    /// A stale pour is a flaw, not a failure — early top-off is the real sin (score 0).
    static let settleLateFloor: Double = 0.6

    /// Five-component pour score weights. Must sum to 1.0 (asserted in tests).
    static let pourWeightPartOne: Double = 0.20
    static let pourWeightAngle: Double = 0.20
    static let pourWeightSettle: Double = 0.20
    static let pourWeightHead: Double = 0.25
    static let pourWeightTiming: Double = 0.15

    /// Rush serve economy.
    static let rushServeBasePoints: Double = 100.0
    static let rushComboStep: Double = 0.25
    static let rushSpillPenalty: Double = 50.0
    /// Half-width of an order's acceptable fill band, as a fraction of the column.
    static let rushFillBandHalfWidth: Double = 0.06

    /// Number of equal level bands that fire a `zoneCross` haptic/audio tick in
    /// Mode 2 — the blind player's altimeter.
    static let splitFeedbackZones: Int = 10

    /// Attempts in Mode 2 auto-finalize after this long armed without a scored
    /// lock, so a distracted player isn't stuck forever.
    static let splitAttemptTimeout: TimeInterval = 20.0

    // MARK: - Cascade quality

    enum CascadeQuality {
        case high, low

        /// Noise samples the cascade shader accumulates per fragment.
        var shaderSampleCount: Int {
            switch self {
            case .high: return 6
            case .low: return 3
            }
        }
    }

    /// Auto-selected render tier. Devices below the A15 class (proxied by RAM —
    /// every A15+ iPhone ships ≥ 4GB) take the reduced shader loop.
    static var cascadeQuality: CascadeQuality {
        ProcessInfo.processInfo.physicalMemory >= 4 * 1024 * 1024 * 1024 ? .high : .low
    }

    #if DEBUG
    // Runtime multipliers for the debug balance tuner ONLY. Compiled out of
    // Release; tests run with the defaults.
    static var debugDrainMultiplier: Double = 1.0
    static var debugFlowMultiplier: Double = 1.0
    #endif

    /// Effective rates the engines consume — identical to the constants in
    /// Release, tuner-adjustable in DEBUG.
    static var effectiveMaxDrainPerSecond: Double {
        #if DEBUG
        return maxDrainPerSecond * debugDrainMultiplier
        #else
        return maxDrainPerSecond
        #endif
    }

    static var effectiveBaseFlowPerSecond: Double {
        #if DEBUG
        return baseFlowPerSecond * debugFlowMultiplier
        #else
        return baseFlowPerSecond
        #endif
    }

    // MARK: - Radian accessors
    // Balance constants are authored in degrees for readability; CoreMotion speaks
    // radians. This is the ONE place degrees become radians for engine use —
    // `MotionService` is the one place raw motion becomes filtered radians.

    static var pourThresholdRadians: Double { pourThresholdDegrees * .pi / 180.0 }
    static var maxTiltRadians: Double { maxTiltDegrees * .pi / 180.0 }
    static var minPeakTiltRadians: Double { minPeakTiltDegrees * .pi / 180.0 }
    static var targetAngleRadians: Double { targetAngleDegrees * .pi / 180.0 }
    static var angleToleranceRadians: Double { angleToleranceDegrees * .pi / 180.0 }
}
