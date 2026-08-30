import XCTest
@testable import SplitTheG

final class SplitEngineTests: XCTestCase {
    private let dt = 1.0 / Balance.motionUpdateHz

    private func radians(_ degrees: Double) -> Double { degrees * .pi / 180.0 }

    /// Drive an armed engine at a constant tilt until the level drops to `target`,
    /// then return the engine still flowing.
    private func drain(
        _ engine: inout SplitEngine,
        toLevel target: Double,
        tiltDegrees: Double,
        angularVelocity: Double = 0.2
    ) {
        var guardCounter = 0
        while engine.state.levelFraction > target {
            _ = engine.tick(
                deltaTime: dt,
                tiltRadians: radians(tiltDegrees),
                angularVelocity: angularVelocity
            )
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 100_000, "drain never reached \(target)")
            if engine.state.phase == .scored { return }
        }
    }

    private func lock(_ engine: inout SplitEngine) -> SplitState {
        engine.tick(deltaTime: dt, tiltRadians: 0, angularVelocity: -0.2)
    }

    // MARK: - Grading boundaries (pure math)

    func testGradeDeadCenterIsPerfect() {
        let (grade, deltaMM) = SplitEngine.gradeAndDelta(
            levelFraction: GlassGeometry.gCenterFraction
        )
        XCTAssertEqual(grade, .perfectSplit)
        XCTAssertEqual(deltaMM, 0.0, accuracy: 1e-9)
    }

    func testGradeBoundaryAtPerfectWindow() {
        let justInside = GlassGeometry.gCenterFraction
            + (Balance.splitPerfectDeltaMM - 1e-6) / GlassGeometry.columnHeightMM
        XCTAssertEqual(SplitEngine.gradeAndDelta(levelFraction: justInside).0, .perfectSplit)

        let justOutside = GlassGeometry.gCenterFraction
            + (Balance.splitPerfectDeltaMM + 1e-6) / GlassGeometry.columnHeightMM
        XCTAssertEqual(SplitEngine.gradeAndDelta(levelFraction: justOutside).0, .cleanSplit)
    }

    func testGradeBoundaryAtCleanWindow() {
        let justInside = GlassGeometry.gCenterFraction
            - (Balance.splitCleanDeltaMM - 1e-6) / GlassGeometry.columnHeightMM
        XCTAssertEqual(SplitEngine.gradeAndDelta(levelFraction: justInside).0, .cleanSplit)

        // Just past 2.0mm is still inside the G band (half-height ≈ 7mm): on the G.
        let justOutside = GlassGeometry.gCenterFraction
            - (Balance.splitCleanDeltaMM + 1e-6) / GlassGeometry.columnHeightMM
        XCTAssertEqual(SplitEngine.gradeAndDelta(levelFraction: justOutside).0, .onTheG)
    }

    func testGradeAboveBandIsShy() {
        let level = GlassGeometry.gBandTopFraction + 0.02
        let (grade, deltaMM) = SplitEngine.gradeAndDelta(levelFraction: level)
        XCTAssertEqual(grade, .shy)
        XCTAssertGreaterThan(deltaMM, 0)
    }

    func testGradeBelowBandIsSunk() {
        let level = GlassGeometry.gBandBottomFraction - 0.02
        let (grade, deltaMM) = SplitEngine.gradeAndDelta(levelFraction: level)
        XCTAssertEqual(grade, .sunk)
        XCTAssertLessThan(deltaMM, 0)
    }

    // MARK: - Full attempt lifecycle

    func testPerfectSplitAttempt() {
        var engine = SplitEngine()
        engine.arm()
        XCTAssertEqual(engine.state.phase, .armed)

        drain(&engine, toLevel: GlassGeometry.gCenterFraction, tiltDegrees: 45)
        XCTAssertEqual(engine.state.phase, .flowing)

        let final = lock(&engine)
        XCTAssertEqual(final.phase, .scored)
        let result = try! XCTUnwrap(final.result)
        // One 60Hz tick at 45° drains ≈ 0.41mm, well inside the 0.75mm window.
        XCTAssertEqual(result.grade, .perfectSplit)
        XCTAssertLessThanOrEqual(abs(result.deltaMM), Balance.splitPerfectDeltaMM)
        XCTAssertFalse(result.assisted)
        XCTAssertGreaterThanOrEqual(result.flowDurationSeconds, Balance.minAttemptDuration)
    }

    func testOverdrinkIsSunk() {
        var engine = SplitEngine()
        engine.arm()
        drain(&engine, toLevel: GlassGeometry.gBandBottomFraction - 0.05, tiltDegrees: 50)
        let final = lock(&engine)
        XCTAssertEqual(final.result?.grade, .sunk)
    }

    func testTimidSipIsShy() {
        var engine = SplitEngine()
        engine.arm()
        drain(&engine, toLevel: 0.85, tiltDegrees: 45)
        let final = lock(&engine)
        XCTAssertEqual(final.result?.grade, .shy)
    }

    func testEmptyingTheGlassScoresWithoutLock() {
        var engine = SplitEngine()
        engine.arm()
        drain(&engine, toLevel: 0.0, tiltDegrees: 70)
        XCTAssertEqual(engine.state.phase, .scored)
        XCTAssertEqual(engine.state.result?.grade, .sunk)
    }

    // MARK: - Integrity: no-attempt conditions

    func testNeverTiltedIsNoAttempt() {
        var engine = SplitEngine()
        engine.arm()
        for _ in 0..<60 {
            _ = engine.tick(deltaTime: dt, tiltRadians: radians(5), angularVelocity: 0.1)
        }
        XCTAssertEqual(engine.state.levelFraction, 1.0)
        let final = engine.finalize()
        XCTAssertEqual(final.result?.grade, .noAttempt)
    }

    func testTooBriefFlowIsNoAttempt() {
        var engine = SplitEngine()
        engine.arm()
        // 0.3s at a steep angle: real drain, but under minAttemptDuration.
        for _ in 0..<18 {
            _ = engine.tick(deltaTime: dt, tiltRadians: radians(65), angularVelocity: 0.3)
        }
        let final = lock(&engine)
        XCTAssertEqual(final.result?.grade, .noAttempt)
    }

    func testShallowPeakTiltIsNoAttempt() {
        var engine = SplitEngine()
        engine.arm()
        // Long, slow dribble at 25° — flows (past 20°) but never a committed sip.
        for _ in 0..<180 {
            _ = engine.tick(deltaTime: dt, tiltRadians: radians(25), angularVelocity: 0.1)
        }
        let final = lock(&engine)
        XCTAssertEqual(final.result?.grade, .noAttempt)
    }

    func testShakenAttemptIsNoAttempt() {
        var engine = SplitEngine()
        engine.arm()
        // Alternate fast angular velocity every sample: a shake, not a sip.
        for index in 0..<120 {
            let omega = index.isMultiple(of: 2) ? 2.0 : -2.0
            _ = engine.tick(deltaTime: dt, tiltRadians: radians(45), angularVelocity: omega)
        }
        XCTAssertGreaterThan(engine.state.directionChanges, Balance.maxDirectionChanges)
        let final = lock(&engine)
        XCTAssertEqual(final.result?.grade, .noAttempt)
    }

    func testSlowCorrectionsAreNotShaking() {
        var engine = SplitEngine()
        engine.arm()
        // Sign flips below minAngularVelocity are steering and must not count.
        for index in 0..<120 {
            let omega = index.isMultiple(of: 2) ? 0.3 : -0.3
            _ = engine.tick(deltaTime: dt, tiltRadians: radians(45), angularVelocity: omega)
        }
        XCTAssertEqual(engine.state.directionChanges, 0)
    }

    // MARK: - Feedback flags

    func testEnterGBandFiresExactlyOnce() {
        var engine = SplitEngine()
        engine.arm()
        var entries = 0
        while engine.state.phase != .scored,
              engine.state.levelFraction > GlassGeometry.gBandBottomFraction + 0.01 {
            let state = engine.tick(
                deltaTime: dt, tiltRadians: radians(45), angularVelocity: 0.2
            )
            if state.enteredGBandThisTick { entries += 1 }
        }
        XCTAssertEqual(entries, 1)
    }

    func testAssistedFlagPropagates() {
        var engine = SplitEngine()
        engine.assisted = true
        engine.arm()
        drain(&engine, toLevel: GlassGeometry.gCenterFraction, tiltDegrees: 45)
        let final = lock(&engine)
        XCTAssertEqual(final.result?.assisted, true)
    }

    // MARK: - Recorded motion-trace fixture

    func testRecordedPerfectSplitTraceReplaysToPerfect() throws {
        let trace = try MotionTraceFixture.load(named: "perfect-split")
        var engine = SplitEngine()
        engine.arm()
        var state = engine.state
        for sample in trace.samples {
            state = engine.tick(
                deltaTime: 1.0 / trace.sampleRateHz,
                tiltRadians: sample[1],
                angularVelocity: sample[2]
            )
        }
        if state.phase != .scored { state = engine.finalize() }
        let result = try XCTUnwrap(state.result)
        XCTAssertEqual(result.grade, .perfectSplit)
        XCTAssertLessThanOrEqual(abs(result.deltaMM), Balance.splitPerfectDeltaMM)
    }
}

/// Loads recorded motion traces from the test bundle, under both SwiftPM
/// (`Bundle.module`) and the Xcode test target.
enum MotionTraceFixture {
    struct Trace: Decodable {
        let sampleRateHz: Double
        /// Each sample is [t, tiltRadians, angularVelocity].
        let samples: [[Double]]
    }

    private final class BundleToken {}

    static func load(named name: String) throws -> Trace {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle(for: BundleToken.self)
        #endif
        let url = bundle.url(
            forResource: name, withExtension: "json",
            subdirectory: "Fixtures/motion-traces"
        )
        ?? bundle.url(forResource: name, withExtension: "json")
        guard let url else {
            throw NSError(
                domain: "MotionTraceFixture", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "missing fixture \(name).json"]
            )
        }
        return try JSONDecoder().decode(Trace.self, from: Data(contentsOf: url))
    }
}
