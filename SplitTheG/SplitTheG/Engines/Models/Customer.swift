import Foundation

/// A pub customer in Mode 3. Pure data — rendering lives in `CustomerNode`.
struct Customer: Identifiable, Equatable, Codable {
    /// The 10 cartoon archetypes. Names map 1:1 to texture names in
    /// `Customers.atlas` (e.g. `customer_oldTimer`).
    enum Archetype: String, Codable, CaseIterable, Equatable {
        case oldTimer
        case tourist
        case dartsChamp
        case poet
        case fiddler
        case professor
        case bookmaker
        case sailor
        case chef
        case birdWatcher
    }

    /// What the customer wants poured. Target is a column fraction; the
    /// acceptable band is target ± `Balance.rushFillBandHalfWidth`.
    enum Order: String, Codable, CaseIterable, Equatable {
        case fullPour
        case emblemPour
        case halfPour

        var targetFraction: Double {
            switch self {
            case .fullPour: return 1.0
            case .emblemPour: return GlassGeometry.emblemLineFraction
            case .halfPour: return 0.5
            }
        }
    }

    let id: UUID
    var archetype: Archetype
    var order: Order
    /// Patience granted at spawn (already wave-scaled).
    var patienceTotal: TimeInterval
    var patienceRemaining: TimeInterval
    /// Wave index (0-based) the customer spawned in.
    var wave: Int

    var patienceFraction: Double {
        patienceTotal > 0 ? max(0.0, patienceRemaining / patienceTotal) : 0.0
    }
}
