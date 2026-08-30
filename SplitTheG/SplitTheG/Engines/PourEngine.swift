import Foundation

/// Mode 1 rules and five-component scoring. Pure value type — the scene renders
/// the returned state and never holds a rule of its own.
struct PourEngine {
    private(set) var state = PourState()

    /// Time-weighted angle credit accumulated while the tap is open in part one.
    private var angleCreditSeconds: Double = 0.0
    private var anglePourSeconds: Double = 0.0
    private var partOneFillAtRelease: Double = 0.0
    private var settleElapsed: TimeInterval = 0.0
    /// How long the player waited in `.readyForTopOff` before opening the tap.
    private var topOffDelaySeconds: TimeInterval = 0.0
    private var earlyTopOff: Bool = false
    private var started: Bool = false

    mutating func reset() {
        self = PourEngine()
    }

    /// Advance the pour by one frame.
    /// - Parameters:
    ///   - tiltRadians: glass tilt from upright (device tilt), radians.
    ///   - tapOpen: whether the player is holding the tap handle.
    mutating func tick(
        deltaTime: TimeInterval,
        tiltRadians: Double,
        tapOpen: Bool
    ) -> PourState {
        guard deltaTime > 0, state.phase != .complete else { return state }

        state.tiltDegrees = tiltRadians * 180.0 / .pi
        state.flowRatePerSecond = 0
        if started {
            state.activeSeconds += deltaTime
        }

        switch state.phase {
        case .empty:
            if tapOpen {
                started = true
                state.phase = .pouringPartOne
                pourPartOne(deltaTime: deltaTime, tiltRadians: tiltRadians)
            }

        case .pouringPartOne:
            if tapOpen {
                pourPartOne(deltaTime: deltaTime, tiltRadians: tiltRadians)
            } else if state.fillFraction >= Balance.partOneMinimumFraction {
                // Glass set down — the surge begins.
                partOneFillAtRelease = state.fillFraction
                settleElapsed = 0
                state.phase = .settling
            }
            // Releasing below the minimum is a fumbled tap: stay in part one.

        case .settling:
            settleElapsed += deltaTime
            state.settleProgress = min(1.0, settleElapsed / Balance.cascadeSettleDuration)
            if state.settleProgress >= 1.0 {
                state.phase = .readyForTopOff
                topOffDelaySeconds = 0
            } else if tapOpen {
                // The gate: topping off through an unsettled cascade forfeits the
                // settle component entirely. The tap still pours — the game lets
                // you ruin the pint, then tells you exactly how you ruined it.
                earlyTopOff = true
                state.phase = .toppingOff
                topOff(deltaTime: deltaTime)
            }

        case .readyForTopOff:
            topOffDelaySeconds += deltaTime
            if tapOpen {
                state.phase = .toppingOff
                topOff(deltaTime: deltaTime)
            }

        case .toppingOff:
            if tapOpen {
                topOff(deltaTime: deltaTime)
            } else {
                complete()
            }

        case .complete:
            break
        }
        return state
    }

    // MARK: - Pour phases

    private mutating func pourPartOne(deltaTime: TimeInterval, tiltRadians: Double) {
        let flow = Balance.effectiveBaseFlowPerSecond
        state.flowRatePerSecond = flow
        addFill(flow * deltaTime)

        // Angle is judged only while liquid is actually flowing in part one —
        // that's when the 45° matters.
        let angleErrorRadians = abs(tiltRadians - Balance.targetAngleRadians)
        let tickCredit = max(0.0, 1.0 - angleErrorRadians / Balance.angleToleranceRadians)
        angleCreditSeconds += tickCredit * deltaTime
        anglePourSeconds += deltaTime
    }

    private mutating func topOff(deltaTime: TimeInterval) {
        let flow = Balance.effectiveBaseFlowPerSecond * Balance.topOffFlowMultiplier
        state.flowRatePerSecond = flow
        addFill(flow * deltaTime)
    }

    private mutating func addFill(_ amount: Double) {
        state.fillFraction += amount
        let capacity = 1.0 + Balance.spillGraceFraction
        if state.fillFraction > capacity {
            state.fillFraction = capacity
            state.spilled = true
        }
    }

    private mutating func complete() {
        state.phase = .complete
        state.flowRatePerSecond = 0

        let partOne = PourEngine.fillAccuracy(
            fillFraction: partOneFillAtRelease,
            targetFraction: GlassGeometry.emblemLineFraction,
            toleranceFraction: Balance.fillLineTolerance
        )
        let angle = anglePourSeconds > 0 ? angleCreditSeconds / anglePourSeconds : 0.0
        let head = state.spilled ? 0.0 : PourEngine.fillAccuracy(
            fillFraction: state.fillFraction,
            targetFraction: 1.0,
            toleranceFraction: Balance.headToleranceMM / GlassGeometry.columnHeightMM
        )
        let timing = PourEngine.timingScore(activeSeconds: state.activeSeconds)

        // Head thickness follows the final column: exactly full leaves the target
        // head; every millimetre short or over comes straight off/onto the head.
        let finalHeadMM = max(
            0.0,
            GlassGeometry.targetHeadMM
                + GlassGeometry.millimetres(fromFraction: state.fillFraction - 1.0)
        )

        state.score = PourScore(
            partOneFill: partOne,
            angle: angle,
            settle: settleScore(),
            head: head,
            timing: timing,
            spilled: state.spilled,
            earlyTopOff: earlyTopOff,
            finalHeadMM: finalHeadMM,
            activeSeconds: state.activeSeconds
        )
    }

    private func settleScore() -> Double {
        // Early top-off is the cardinal sin: zero, no partial credit.
        if earlyTopOff { return 0.0 }
        // Full credit inside the grace window after the cascade resolves, then a
        // linear slide to the late floor — a stale pour is a flaw, not a failure.
        let lateBy = max(0.0, topOffDelaySeconds - Balance.cascadeTopOffGraceWindow)
        let slide = min(1.0, lateBy / Balance.cascadeTopOffGraceWindow)
        return 1.0 - slide * (1.0 - Balance.settleLateFloor)
    }

    // MARK: - Shared fill math

    /// The one fill-accuracy implementation in the game. `RushEngine` scores its
    /// serves through this — never a second pour implementation.
    static func fillAccuracy(
        fillFraction: Double,
        targetFraction: Double,
        toleranceFraction: Double
    ) -> Double {
        max(0.0, 1.0 - abs(fillFraction - targetFraction) / toleranceFraction)
    }

    static func timingScore(activeSeconds: TimeInterval) -> Double {
        guard activeSeconds > Balance.pourParTime else { return 1.0 }
        return max(0.0, 1.0 - (activeSeconds - Balance.pourParTime) / Balance.pourParTime)
    }
}
