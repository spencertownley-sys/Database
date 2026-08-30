import Foundation

/// Mode 3 rules: the accelerating queue, patience, combos, walkouts.
/// Pure value type; deterministic under a fixed seed so runs are testable.
/// Fill/accuracy math is `PourEngine.fillAccuracy` — never a second pour
/// implementation.
struct RushEngine {
    private(set) var state = RushState()

    private var rng: SeededGenerator
    private var spawnTimer: TimeInterval = 0.0
    private var spawnedCount: Int = 0

    /// How many customers can queue at once before spawning pauses.
    /// Kept here (not Balance) because it is layout capacity, not difficulty.
    static let maxQueuedCustomers = 6

    init(stationCount: Int = 3, seed: UInt64 = 0x5EED) {
        precondition((3...5).contains(stationCount), "The Rush runs 3–5 taps")
        rng = SeededGenerator(seed: seed)
        state.stations = Array(repeating: RushState.Station(), count: stationCount)
    }

    // MARK: - Wave curve

    static func spawnInterval(forWave wave: Int) -> TimeInterval {
        max(
            Balance.rushMinSpawnInterval,
            Balance.rushBaseSpawnInterval * pow(Balance.rushSpawnDecay, Double(wave))
        )
    }

    static func patience(forWave wave: Int) -> TimeInterval {
        max(
            Balance.rushMinPatience,
            Balance.rushBasePatience * pow(Balance.rushPatienceDecay, Double(wave))
        )
    }

    // MARK: - Lifecycle

    mutating func start() {
        guard state.phase == .ready else { return }
        state.phase = .running
        spawnTimer = 0 // first customer arrives on the first tick
    }

    @discardableResult
    mutating func tick(deltaTime: TimeInterval) -> RushState {
        state.walkoutsThisTick = []
        state.spilledThisTick = false
        guard state.phase == .running, deltaTime > 0 else { return state }

        state.elapsedSeconds += deltaTime
        spawnCustomers(deltaTime: deltaTime)
        drainPatience(deltaTime: deltaTime)
        pourStations(deltaTime: deltaTime)
        return state
    }

    mutating func startFill(station index: Int) {
        guard state.phase == .running, state.stations.indices.contains(index) else { return }
        state.stations[index].isPouring = true
    }

    mutating func stopFill(station index: Int) {
        guard state.stations.indices.contains(index) else { return }
        state.stations[index].isPouring = false
    }

    /// Flick the glass at `station` to the customer with `customerID`.
    @discardableResult
    mutating func serve(station index: Int, customerID: UUID) -> RushState.ServeResult? {
        guard state.phase == .running,
              state.stations.indices.contains(index),
              let customerIndex = state.customers.firstIndex(where: { $0.id == customerID })
        else { return nil }

        let customer = state.customers[customerIndex]
        let fill = state.stations[index].fillFraction
        let accuracy = PourEngine.fillAccuracy(
            fillFraction: fill,
            targetFraction: customer.order.targetFraction,
            toleranceFraction: Balance.rushFillBandHalfWidth
        )
        let inBand = accuracy > 0.0

        var points = 0
        if inBand {
            // Points scale from half to full base with accuracy, times the combo
            // the player walked in with; the streak grows afterwards.
            let raw = Balance.rushServeBasePoints
                * (0.5 + 0.5 * accuracy)
                * state.comboMultiplier
            points = Int(raw.rounded())
            state.score += points
            state.comboStreak += 1
            state.comboMultiplier = min(
                Balance.rushMaxComboMultiplier,
                1.0 + Balance.rushComboStep * Double(state.comboStreak)
            )
        } else {
            // They got a glass, just not the one they ordered — no walkout,
            // no points, and the combo dies.
            resetCombo()
        }

        state.customers.remove(at: customerIndex)
        state.stations[index].fillFraction = 0
        state.stations[index].isPouring = false
        state.servedCount += 1

        let result = RushState.ServeResult(
            customerID: customerID,
            inBand: inBand,
            accuracy: accuracy,
            pointsAwarded: points,
            comboMultiplier: state.comboMultiplier
        )
        state.lastServe = result
        return result
    }

    // MARK: - Tick internals

    private mutating func spawnCustomers(deltaTime: TimeInterval) {
        spawnTimer -= deltaTime
        while spawnTimer <= 0 {
            guard state.customers.count < Self.maxQueuedCustomers else {
                // Bar's full — hold the door until a seat frees up.
                spawnTimer = 0
                return
            }
            let wave = spawnedCount / Balance.rushCustomersPerWave
            state.wave = wave
            let patience = Self.patience(forWave: wave)
            let archetype = Customer.Archetype.allCases.randomElement(using: &rng)!
            let order = Customer.Order.allCases.randomElement(using: &rng)!
            state.customers.append(
                Customer(
                    id: UUID(),
                    archetype: archetype,
                    order: order,
                    patienceTotal: patience,
                    patienceRemaining: patience,
                    wave: wave
                )
            )
            spawnedCount += 1
            spawnTimer += Self.spawnInterval(forWave: spawnedCount / Balance.rushCustomersPerWave)
        }
    }

    private mutating func drainPatience(deltaTime: TimeInterval) {
        var remaining: [Customer] = []
        for var customer in state.customers {
            customer.patienceRemaining -= deltaTime
            if customer.patienceRemaining <= 0 {
                state.walkouts += 1
                state.walkoutsThisTick.append(customer.id)
                resetCombo()
            } else {
                remaining.append(customer)
            }
        }
        state.customers = remaining
        if state.walkouts >= Balance.rushMaxWalkouts {
            state.phase = .gameOver
        }
    }

    private mutating func pourStations(deltaTime: TimeInterval) {
        for index in state.stations.indices where state.stations[index].isPouring {
            state.stations[index].fillFraction += Balance.effectiveBaseFlowPerSecond * deltaTime
            if state.stations[index].fillFraction > 1.0 + Balance.spillGraceFraction {
                // Overflow dumps the glass: penalty, dead combo, start over.
                state.stations[index].fillFraction = 0
                state.stations[index].isPouring = false
                state.score = max(0, state.score - Int(Balance.rushSpillPenalty))
                state.spillCount += 1
                state.spilledThisTick = true
                resetCombo()
            }
        }
    }

    private mutating func resetCombo() {
        state.comboStreak = 0
        state.comboMultiplier = 1.0
    }
}
