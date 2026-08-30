import Foundation

/// Mode 2 rules and scoring. Pure value type — no SpriteKit, no CoreMotion.
/// The scene feeds it filtered motion samples and renders the returned state;
/// all rules live here.
struct SplitEngine {
    private(set) var state = SplitState()

    /// Set by the controller when the attempt uses the on-screen touch fallback.
    var assisted: Bool = false

    /// Sign of the last significant angular velocity sample (-1, 0, +1),
    /// for the shake detector.
    private var previousOmegaSign: Int = 0
    private var wasInGBand: Bool = false

    // MARK: - Lifecycle

    /// Called after `MotionService.calibrate()` — the glass is full and the
    /// player may begin the sip.
    mutating func arm() {
        state = SplitState()
        state.phase = .armed
        previousOmegaSign = 0
        wasInGBand = false
    }

    /// Advance the simulation by one motion sample.
    /// - Parameters:
    ///   - tiltRadians: filtered tilt from calibrated upright, radians.
    ///   - angularVelocity: signed pitch angular velocity, radians/second.
    mutating func tick(
        deltaTime: TimeInterval,
        tiltRadians: Double,
        angularVelocity: Double
    ) -> SplitState {
        state.enteredGBandThisTick = false
        guard state.phase == .armed || state.phase == .flowing, deltaTime > 0 else {
            return state
        }

        state.elapsedSeconds += deltaTime
        let tiltDegrees = tiltRadians * 180.0 / .pi
        state.tiltDegrees = tiltDegrees
        state.peakTiltDegrees = max(state.peakTiltDegrees, tiltDegrees)
        trackDirectionChanges(angularVelocity: angularVelocity)

        if tiltRadians >= Balance.pourThresholdRadians {
            state.phase = .flowing
            state.flowDurationSeconds += deltaTime
            drain(deltaTime: deltaTime, tiltRadians: tiltRadians)
            // Emptying the glass ends the attempt even if the player is still tipped.
            if state.levelFraction <= 0 {
                score()
            }
        } else {
            state.drainRatePerSecond = 0
            // Returning below the pour threshold after flowing locks the attempt —
            // that is the "set the glass down" moment.
            if state.phase == .flowing {
                score()
            }
        }
        return state
    }

    /// Score whatever we have — used when the player taps Stop or the attempt
    /// times out without the tilt ever returning below the threshold.
    @discardableResult
    mutating func finalize() -> SplitState {
        guard state.phase != .scored, state.phase != .idle else { return state }
        score()
        return state
    }

    // MARK: - Drain model

    private mutating func drain(deltaTime: TimeInterval, tiltRadians: Double) {
        // Drain ramps non-linearly with tilt past the threshold: shallow tips
        // trickle, committed tips gush. The exponent > 1 keeps the fine control
        // near the threshold where splitting happens.
        let range = Balance.maxTiltRadians - Balance.pourThresholdRadians
        let normalized = min(1.0, max(0.0, (tiltRadians - Balance.pourThresholdRadians) / range))
        let rate = Balance.effectiveMaxDrainPerSecond * pow(normalized, Balance.drainExponent)
        state.drainRatePerSecond = rate
        state.levelFraction = max(0.0, state.levelFraction - rate * deltaTime)

        let inBand = state.levelFraction <= GlassGeometry.gBandTopFraction
            && state.levelFraction >= GlassGeometry.gBandBottomFraction
        state.enteredGBandThisTick = inBand && !wasInGBand
        wasInGBand = inBand
    }

    private mutating func trackDirectionChanges(angularVelocity: Double) {
        // Only count sign flips at meaningful speed — slow corrections are
        // steering, fast alternation is shaking the glass to cheat the drain.
        guard abs(angularVelocity) >= Balance.minAngularVelocity else { return }
        let sign = angularVelocity > 0 ? 1 : -1
        if previousOmegaSign != 0 && sign != previousOmegaSign {
            state.directionChanges += 1
        }
        previousOmegaSign = sign
    }

    // MARK: - Scoring

    private mutating func score() {
        state.drainRatePerSecond = 0
        state.phase = .scored

        let (grade, deltaMM) = integrityFailure()
            ?? SplitEngine.gradeAndDelta(levelFraction: state.levelFraction)

        state.result = SplitResult(
            grade: grade,
            deltaMM: deltaMM,
            finalLevelFraction: state.levelFraction,
            flowDurationSeconds: state.flowDurationSeconds,
            assisted: assisted
        )
    }

    /// The integrity check: reject "attempts" that were never a real sip.
    private func integrityFailure() -> (SplitGrade, Double)? {
        let neverTilted = state.flowDurationSeconds <= 0
        let tooShort = state.flowDurationSeconds < Balance.minAttemptDuration
        let tooShallow = state.peakTiltDegrees < Balance.minPeakTiltDegrees
        let shaken = state.directionChanges > Balance.maxDirectionChanges
        guard neverTilted || tooShort || tooShallow || shaken else { return nil }
        let deltaMM = GlassGeometry.millimetres(
            fromFraction: state.levelFraction - GlassGeometry.gCenterFraction
        )
        return (.noAttempt, deltaMM)
    }

    /// Pure grading: where did the liquid line land relative to the G?
    static func gradeAndDelta(levelFraction: Double) -> (SplitGrade, Double) {
        let deltaMM = GlassGeometry.millimetres(
            fromFraction: levelFraction - GlassGeometry.gCenterFraction
        )
        let magnitude = abs(deltaMM)
        if magnitude <= Balance.splitPerfectDeltaMM {
            return (.perfectSplit, deltaMM)
        }
        if magnitude <= Balance.splitCleanDeltaMM {
            return (.cleanSplit, deltaMM)
        }
        if levelFraction >= GlassGeometry.gBandBottomFraction
            && levelFraction <= GlassGeometry.gBandTopFraction {
            return (.onTheG, deltaMM)
        }
        return deltaMM > 0 ? (.shy, deltaMM) : (.sunk, deltaMM)
    }
}
