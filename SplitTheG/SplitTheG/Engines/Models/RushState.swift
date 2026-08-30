import Foundation

/// Snapshot of a Mode 3 run, produced by `RushEngine.tick`.
struct RushState: Equatable {
    enum Phase: Equatable {
        case ready
        case running
        case gameOver
    }

    /// One tap station along the bottom of the bar.
    struct Station: Equatable {
        /// Current glass fill as a column fraction.
        var fillFraction: Double = 0.0
        var isPouring: Bool = false
    }

    /// Outcome of the most recent serve, for the scene to flash feedback.
    struct ServeResult: Equatable {
        var customerID: UUID
        var inBand: Bool
        var accuracy: Double
        var pointsAwarded: Int
        var comboMultiplier: Double
    }

    var phase: Phase = .ready
    var stations: [Station] = []
    var customers: [Customer] = []
    var score: Int = 0
    var wave: Int = 0
    var walkouts: Int = 0
    var servedCount: Int = 0
    var comboStreak: Int = 0
    var comboMultiplier: Double = 1.0
    var spillCount: Int = 0
    var elapsedSeconds: TimeInterval = 0.0
    var lastServe: ServeResult?
    /// IDs of customers who walked out this tick (one-shot, for scene feedback).
    var walkoutsThisTick: [UUID] = []
    /// True when a station overflowed this tick (one-shot, for spill effects).
    var spilledThisTick: Bool = false
}
