import Foundation

/// Physical model of the Griffin's Extra Stout glass, shared by every mode.
/// All fractions are measured up the liquid column: 0.0 = inside bottom of the
/// glass, 1.0 = the rim.
enum GlassGeometry {
    /// Usable liquid column height of the pint glass, in millimetres.
    static let columnHeightMM: Double = 155.0

    /// Vertical center of the serif G in the roundel, as a fraction of the column.
    static let gCenterFraction: Double = 0.61

    /// Full height of the G glyph, as a fraction of the column.
    static let gHeightFraction: Double = 0.09

    /// The griffin emblem line — the part-one pour target in Mode 1.
    static let emblemLineFraction: Double = 0.68

    /// Ideal head thickness on a finished pour, in millimetres.
    static let targetHeadMM: Double = 15.0

    // MARK: - Derived geometry

    /// Bottom and top edges of the G band, as column fractions.
    static var gBandBottomFraction: Double { gCenterFraction - gHeightFraction / 2.0 }
    static var gBandTopFraction: Double { gCenterFraction + gHeightFraction / 2.0 }

    /// Ideal head thickness expressed as a column fraction.
    static var targetHeadFraction: Double { targetHeadMM / columnHeightMM }

    /// Convert a signed column-fraction delta into millimetres.
    static func millimetres(fromFraction fraction: Double) -> Double {
        fraction * columnHeightMM
    }
}
