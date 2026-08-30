import Foundation

/// Grade for a Mode 2 (Split the G) attempt.
enum SplitGrade: String, Codable, CaseIterable, Equatable {
    /// |delta| ≤ `Balance.splitPerfectDeltaMM` from the center of the G.
    case perfectSplit
    /// |delta| ≤ `Balance.splitCleanDeltaMM`.
    case cleanSplit
    /// Inside the G band but outside the clean-split window.
    case onTheG
    /// Stopped above the G band — didn't commit to the sip.
    case shy
    /// Blew past the bottom of the G band.
    case sunk
    /// The attempt failed the integrity check (too short, too shallow, or shaken).
    case noAttempt
}

/// Grade for a Mode 1 (Perfect Pour) attempt, from the five-component total (0–100).
enum PourGrade: String, Codable, CaseIterable, Equatable {
    case masterPour   // ≥ 95
    case solid        // ≥ 85
    case decent       // ≥ 70
    case sloppy       // ≥ 50
    case disaster     // < 50

    static func from(total: Double) -> PourGrade {
        switch total {
        case 95...: return .masterPour
        case 85..<95: return .solid
        case 70..<85: return .decent
        case 50..<70: return .sloppy
        default: return .disaster
        }
    }
}

/// The five pour-score components. Ordered so views can find the weakest link
/// and derive the one-line critique.
enum PourComponent: String, Codable, CaseIterable, Equatable {
    case partOneFill
    case angle
    case settle
    case head
    case timing
}
