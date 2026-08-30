import Foundation

/// Everything the game remembers, as one Codable document. Local only — this
/// app makes zero network requests.
struct PlayerRecords: Codable, Equatable {
    /// Bump when the shape changes; `PersistenceService` refuses newer schemas
    /// and migrates older ones.
    static let currentSchemaVersion = 1

    var schemaVersion: Int = PlayerRecords.currentSchemaVersion

    // Mode 2
    var bestSplit: SplitResult?
    var splitAttemptCount: Int = 0
    /// Histogram keyed by `SplitGrade.rawValue`.
    var splitGradeCounts: [String: Int] = [:]

    // Mode 1
    var bestPour: PourScore?
    var pourAttemptCount: Int = 0

    // Mode 3
    var bestRushScore: Int = 0
    var bestRushWave: Int = 0
    var rushRunCount: Int = 0

    var leaderboard: [LeaderboardEntry] = []

    var ageVerified: Bool = false
    /// Mode identifiers whose one-time tutorial has been seen.
    var tutorialsSeen: Set<String> = []

    var audioEnabled: Bool = true
    var hapticsEnabled: Bool = true

    // MARK: - Recording helpers (pure, testable)

    mutating func record(split result: SplitResult) {
        splitAttemptCount += 1
        splitGradeCounts[result.grade.rawValue, default: 0] += 1
        guard result.grade != .noAttempt else { return }
        if let best = bestSplit {
            if abs(result.deltaMM) < abs(best.deltaMM) { bestSplit = result }
        } else {
            bestSplit = result
        }
    }

    mutating func record(pour score: PourScore) {
        pourAttemptCount += 1
        if score.total > (bestPour?.total ?? -1) { bestPour = score }
    }

    mutating func record(rushScore: Int, wave: Int) {
        rushRunCount += 1
        bestRushScore = max(bestRushScore, rushScore)
        bestRushWave = max(bestRushWave, wave)
    }
}

/// Local pass-and-play leaderboard row.
struct LeaderboardEntry: Codable, Equatable, Identifiable {
    enum Mode: String, Codable {
        case pour, split, rush
    }

    var id: UUID = UUID()
    /// Exactly three characters, arcade style.
    var initials: String
    var mode: Mode
    /// Higher is better: pour/rush use their scores; split uses negative |deltaMM|
    /// scaled so closer splits rank higher.
    var value: Double
    var displayValue: String
    /// True when the run used the touch fallback instead of motion.
    var assisted: Bool
    var date: Date = .now
}
