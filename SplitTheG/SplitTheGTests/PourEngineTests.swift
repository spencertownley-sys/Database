import XCTest
@testable import SplitTheG

final class PourEngineTests: XCTestCase {
    private let dt = 1.0 / Balance.motionUpdateHz
    private let target = Balance.targetAngleRadians

    /// Tick with the tap open at a given tilt until `fillFraction` reaches `level`.
    private func pour(
        _ engine: inout PourEngine,
        toFill level: Double,
        tiltRadians: Double
    ) {
        var guardCounter = 0
        while engine.state.fillFraction < level, !engine.state.spilled {
            _ = engine.tick(deltaTime: dt, tiltRadians: tiltRadians, tapOpen: true)
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 100_000, "pour never reached \(level)")
        }
    }

    private func wait(
        _ engine: inout PourEngine,
        seconds: TimeInterval,
        tiltRadians: Double = 0
    ) {
        let ticks = Int((seconds / dt).rounded(.up))
        for _ in 0..<ticks {
            _ = engine.tick(deltaTime: dt, tiltRadians: tiltRadians, tapOpen: false)
        }
    }

    func testWeightsSumToOne() {
        let sum = Balance.pourWeightPartOne + Balance.pourWeightAngle
            + Balance.pourWeightSettle + Balance.pourWeightHead + Balance.pourWeightTiming
        XCTAssertEqual(sum, 1.0, accuracy: 1e-12)
    }

    func testPerfectPourScoresMaster() throws {
        var engine = PourEngine()

        pour(&engine, toFill: GlassGeometry.emblemLineFraction, tiltRadians: target)
        XCTAssertEqual(engine.state.phase, .pouringPartOne)

        // Release: cascade starts, and topping off is gated until it resolves.
        _ = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        XCTAssertEqual(engine.state.phase, .settling)

        wait(&engine, seconds: Balance.cascadeSettleDuration + 0.1)
        XCTAssertEqual(engine.state.phase, .readyForTopOff)
        XCTAssertEqual(engine.state.settleProgress, 1.0)

        wait(&engine, seconds: 0.5)
        pour(&engine, toFill: 1.0, tiltRadians: 0)
        XCTAssertEqual(engine.state.phase, .toppingOff)

        let final = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        XCTAssertEqual(final.phase, .complete)

        let score = try XCTUnwrap(final.score)
        XCTAssertFalse(score.spilled)
        XCTAssertFalse(score.earlyTopOff)
        XCTAssertEqual(score.settle, 1.0)
        XCTAssertGreaterThan(score.partOneFill, 0.9)
        XCTAssertGreaterThan(score.angle, 0.99)
        XCTAssertGreaterThan(score.head, 0.9)
        XCTAssertEqual(score.timing, 1.0)
        XCTAssertGreaterThanOrEqual(score.total, 95.0)
        XCTAssertEqual(score.grade, .masterPour)
        XCTAssertEqual(
            score.finalHeadMM, GlassGeometry.targetHeadMM,
            accuracy: Balance.headToleranceMM
        )
    }

    func testEarlyTopOffZeroesSettleScore() throws {
        var engine = PourEngine()
        pour(&engine, toFill: GlassGeometry.emblemLineFraction, tiltRadians: target)
        _ = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        XCTAssertEqual(engine.state.phase, .settling)

        // Get greedy one second into the four-second cascade.
        wait(&engine, seconds: 1.0)
        pour(&engine, toFill: 1.0, tiltRadians: 0)
        XCTAssertEqual(engine.state.phase, .toppingOff)

        let final = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        let score = try XCTUnwrap(final.score)
        XCTAssertTrue(score.earlyTopOff)
        XCTAssertEqual(score.settle, 0.0)
    }

    func testOverfillSpills() throws {
        var engine = PourEngine()
        pour(&engine, toFill: GlassGeometry.emblemLineFraction, tiltRadians: target)
        _ = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        wait(&engine, seconds: Balance.cascadeSettleDuration + 0.1)

        // Hold the tap far past the rim.
        for _ in 0..<(60 * 10) {
            _ = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: true)
            if engine.state.spilled { break }
        }
        XCTAssertTrue(engine.state.spilled)
        XCTAssertEqual(
            engine.state.fillFraction, 1.0 + Balance.spillGraceFraction,
            accuracy: 1e-9
        )

        let final = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        let score = try XCTUnwrap(final.score)
        XCTAssertTrue(score.spilled)
        XCTAssertEqual(score.head, 0.0)
    }

    func testBadAngleZeroesAngleScore() throws {
        var engine = PourEngine()
        // 70° is 25° off target — outside the 15° tolerance the whole pour.
        let badAngle = 70.0 * Double.pi / 180.0
        pour(&engine, toFill: GlassGeometry.emblemLineFraction, tiltRadians: badAngle)
        _ = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        wait(&engine, seconds: Balance.cascadeSettleDuration + 0.1)
        pour(&engine, toFill: 1.0, tiltRadians: 0)
        let final = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        let score = try XCTUnwrap(final.score)
        XCTAssertEqual(score.angle, 0.0)
        XCTAssertLessThan(score.total, 95.0)
    }

    func testLateTopOffSlidesTowardFloorNotZero() throws {
        var engine = PourEngine()
        pour(&engine, toFill: GlassGeometry.emblemLineFraction, tiltRadians: target)
        _ = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        // Wait out the cascade AND dawdle far past the grace window.
        wait(&engine, seconds: Balance.cascadeSettleDuration + Balance.cascadeTopOffGraceWindow * 3)
        pour(&engine, toFill: 1.0, tiltRadians: 0)
        let final = engine.tick(deltaTime: dt, tiltRadians: 0, tapOpen: false)
        let score = try XCTUnwrap(final.score)
        XCTAssertEqual(score.settle, Balance.settleLateFloor, accuracy: 1e-9)
    }

    func testTimingScoreCurve() {
        XCTAssertEqual(PourEngine.timingScore(activeSeconds: 10), 1.0)
        XCTAssertEqual(PourEngine.timingScore(activeSeconds: Balance.pourParTime), 1.0)
        XCTAssertEqual(
            PourEngine.timingScore(activeSeconds: Balance.pourParTime * 1.5),
            0.5, accuracy: 1e-9
        )
        XCTAssertEqual(PourEngine.timingScore(activeSeconds: Balance.pourParTime * 3), 0.0)
    }

    func testFillAccuracyIsSharedMath() {
        XCTAssertEqual(
            PourEngine.fillAccuracy(fillFraction: 0.5, targetFraction: 0.5, toleranceFraction: 0.06),
            1.0
        )
        XCTAssertEqual(
            PourEngine.fillAccuracy(fillFraction: 0.56, targetFraction: 0.5, toleranceFraction: 0.06),
            0.0, accuracy: 1e-9
        )
        XCTAssertEqual(
            PourEngine.fillAccuracy(fillFraction: 0.53, targetFraction: 0.5, toleranceFraction: 0.06),
            0.5, accuracy: 1e-9
        )
    }

    func testFumbledTapBelowMinimumStaysInPartOne() {
        var engine = PourEngine()
        // A couple of frames of pour, well under partOneMinimumFraction.
        _ = engine.tick(deltaTime: dt, tiltRadians: target, tapOpen: true)
        _ = engine.tick(deltaTime: dt, tiltRadians: target, tapOpen: true)
        let state = engine.tick(deltaTime: dt, tiltRadians: target, tapOpen: false)
        XCTAssertEqual(state.phase, .pouringPartOne)
    }
}
