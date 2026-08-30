import XCTest
@testable import SplitTheG

final class RushEngineTests: XCTestCase {
    private let dt = 1.0 / Balance.motionUpdateHz

    /// Tick station `index` until its fill reaches `target`.
    private func fill(_ engine: inout RushEngine, station index: Int, to target: Double) {
        engine.startFill(station: index)
        var guardCounter = 0
        while engine.state.stations[index].fillFraction < target {
            _ = engine.tick(deltaTime: dt)
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 100_000, "fill never reached \(target)")
        }
        engine.stopFill(station: index)
    }

    // MARK: - Wave escalation math

    func testWaveZeroUsesBaseValues() {
        XCTAssertEqual(RushEngine.spawnInterval(forWave: 0), Balance.rushBaseSpawnInterval)
        XCTAssertEqual(RushEngine.patience(forWave: 0), Balance.rushBasePatience)
    }

    func testWaveCurveDecaysGeometrically() {
        let expectedSpawn = Balance.rushBaseSpawnInterval * pow(Balance.rushSpawnDecay, 5)
        XCTAssertEqual(RushEngine.spawnInterval(forWave: 5), expectedSpawn, accuracy: 1e-9)
        let expectedPatience = Balance.rushBasePatience * pow(Balance.rushPatienceDecay, 5)
        XCTAssertEqual(RushEngine.patience(forWave: 5), expectedPatience, accuracy: 1e-9)
    }

    func testWaveCurveClampsAtFloor() {
        XCTAssertEqual(RushEngine.spawnInterval(forWave: 60), Balance.rushMinSpawnInterval)
        XCTAssertEqual(RushEngine.patience(forWave: 60), Balance.rushMinPatience)
    }

    // MARK: - Serving

    func testInBandServeScores() throws {
        var engine = RushEngine(stationCount: 3, seed: 1)
        engine.start()
        _ = engine.tick(deltaTime: dt)
        let customer = try XCTUnwrap(engine.state.customers.first)

        fill(&engine, station: 0, to: customer.order.targetFraction)
        let result = try XCTUnwrap(engine.serve(station: 0, customerID: customer.id))

        XCTAssertTrue(result.inBand)
        // One 60Hz fill tick of overshoot at most — accuracy stays high.
        XCTAssertGreaterThan(result.accuracy, 0.9)
        XCTAssertGreaterThanOrEqual(result.pointsAwarded, 95)
        XCTAssertLessThanOrEqual(
            result.pointsAwarded, Int(Balance.rushServeBasePoints)
        )
        XCTAssertEqual(engine.state.score, result.pointsAwarded)
        XCTAssertEqual(engine.state.servedCount, 1)
        // The glass is gone; the station starts fresh.
        XCTAssertEqual(engine.state.stations[0].fillFraction, 0.0)
    }

    func testComboBuildsAndResets() throws {
        var engine = RushEngine(stationCount: 3, seed: 2)
        engine.start()

        for expectedStreak in 1...3 {
            var guardCounter = 0
            while engine.state.customers.isEmpty {
                _ = engine.tick(deltaTime: dt)
                guardCounter += 1
                XCTAssertLessThan(guardCounter, 100_000)
            }
            let customer = engine.state.customers[0]
            fill(&engine, station: 0, to: customer.order.targetFraction)
            let result = try XCTUnwrap(engine.serve(station: 0, customerID: customer.id))
            XCTAssertTrue(result.inBand)
            XCTAssertEqual(engine.state.comboStreak, expectedStreak)
            XCTAssertEqual(
                engine.state.comboMultiplier,
                min(
                    Balance.rushMaxComboMultiplier,
                    1.0 + Balance.rushComboStep * Double(expectedStreak)
                ),
                accuracy: 1e-9
            )
        }
        XCTAssertEqual(engine.state.comboMultiplier, 1.75, accuracy: 1e-9)

        // Serve an empty glass: out of every band, combo dies, no walkout.
        var guardCounter = 0
        while engine.state.customers.isEmpty {
            _ = engine.tick(deltaTime: dt)
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 100_000)
        }
        let victim = engine.state.customers[0]
        let flop = try XCTUnwrap(engine.serve(station: 1, customerID: victim.id))
        XCTAssertFalse(flop.inBand)
        XCTAssertEqual(flop.pointsAwarded, 0)
        XCTAssertEqual(engine.state.comboStreak, 0)
        XCTAssertEqual(engine.state.comboMultiplier, 1.0)
        XCTAssertEqual(engine.state.walkouts, 0)
    }

    func testComboMultiplierAppliesToNextServePoints() throws {
        var engine = RushEngine(stationCount: 3, seed: 3)
        engine.start()

        _ = engine.tick(deltaTime: dt)
        let first = try XCTUnwrap(engine.state.customers.first)
        fill(&engine, station: 0, to: first.order.targetFraction)
        _ = try XCTUnwrap(engine.serve(station: 0, customerID: first.id))

        var guardCounter = 0
        while engine.state.customers.isEmpty {
            _ = engine.tick(deltaTime: dt)
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 100_000)
        }
        let second = engine.state.customers[0]
        fill(&engine, station: 0, to: second.order.targetFraction)
        let result = try XCTUnwrap(engine.serve(station: 0, customerID: second.id))
        // Second serve carries the 1.25× built by the first.
        XCTAssertGreaterThan(
            Double(result.pointsAwarded),
            Balance.rushServeBasePoints * 1.0
        )
    }

    // MARK: - Walkouts and run end

    func testThreeWalkoutsEndTheRun() {
        var engine = RushEngine(stationCount: 3, seed: 4)
        engine.start()
        var walkoutsSeen = 0
        var guardCounter = 0
        while engine.state.phase == .running {
            let state = engine.tick(deltaTime: dt)
            walkoutsSeen += state.walkoutsThisTick.count
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 1_000_000, "run never ended")
        }
        XCTAssertEqual(engine.state.phase, .gameOver)
        XCTAssertEqual(engine.state.walkouts, Balance.rushMaxWalkouts)
        XCTAssertEqual(walkoutsSeen, Balance.rushMaxWalkouts)
        // Nobody can walk out before the first patience budget elapses.
        XCTAssertGreaterThan(engine.state.elapsedSeconds, Balance.rushBasePatience)
    }

    func testWalkoutResetsCombo() throws {
        var engine = RushEngine(stationCount: 3, seed: 5)
        engine.start()
        _ = engine.tick(deltaTime: dt)
        let customer = try XCTUnwrap(engine.state.customers.first)
        fill(&engine, station: 0, to: customer.order.targetFraction)
        _ = engine.serve(station: 0, customerID: customer.id)
        XCTAssertEqual(engine.state.comboStreak, 1)

        // Let the next customer rot until they leave.
        var guardCounter = 0
        while engine.state.walkouts == 0 {
            _ = engine.tick(deltaTime: dt)
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 1_000_000)
        }
        XCTAssertEqual(engine.state.comboStreak, 0)
        XCTAssertEqual(engine.state.comboMultiplier, 1.0)
    }

    // MARK: - Spills

    func testOverflowSpillsAndPenalizes() throws {
        var engine = RushEngine(stationCount: 3, seed: 6)
        engine.start()
        _ = engine.tick(deltaTime: dt)
        let customer = try XCTUnwrap(engine.state.customers.first)
        fill(&engine, station: 0, to: customer.order.targetFraction)
        _ = engine.serve(station: 0, customerID: customer.id)
        let scoreBefore = engine.state.score
        XCTAssertGreaterThan(scoreBefore, 0)

        engine.startFill(station: 1)
        var guardCounter = 0
        while !engine.state.spilledThisTick {
            _ = engine.tick(deltaTime: dt)
            guardCounter += 1
            XCTAssertLessThan(guardCounter, 100_000, "station never overflowed")
        }
        XCTAssertEqual(engine.state.spillCount, 1)
        XCTAssertEqual(engine.state.stations[1].fillFraction, 0.0)
        XCTAssertFalse(engine.state.stations[1].isPouring)
        XCTAssertEqual(
            engine.state.score,
            max(0, scoreBefore - Int(Balance.rushSpillPenalty))
        )
        XCTAssertEqual(engine.state.comboMultiplier, 1.0)
    }

    // MARK: - Determinism & queue cap

    func testSameSeedSameRun() {
        var a = RushEngine(stationCount: 4, seed: 42)
        var b = RushEngine(stationCount: 4, seed: 42)
        a.start()
        b.start()
        for _ in 0..<600 {
            _ = a.tick(deltaTime: dt)
            _ = b.tick(deltaTime: dt)
        }
        XCTAssertEqual(
            a.state.customers.map(\.archetype),
            b.state.customers.map(\.archetype)
        )
        XCTAssertEqual(a.state.customers.map(\.order), b.state.customers.map(\.order))
    }

    func testQueueNeverExceedsCap() {
        var engine = RushEngine(stationCount: 5, seed: 7)
        engine.start()
        var maxSeen = 0
        for _ in 0..<(60 * 30) {
            let state = engine.tick(deltaTime: dt)
            maxSeen = max(maxSeen, state.customers.count)
            if state.phase == .gameOver { break }
        }
        XCTAssertLessThanOrEqual(maxSeen, RushEngine.maxQueuedCustomers)
    }
}
