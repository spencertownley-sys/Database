import Foundation

/// Snapshot of a Mode 1 attempt, produced by `PourEngine.tick`.
struct PourState: Equatable {
    enum Phase: Equatable {
        case empty
        case pouringPartOne
        case settling
        case readyForTopOff
        case toppingOff
        case complete
    }

    var phase: Phase = .empty

    /// Total poured volume as a fraction of the column. 1.0 = flush with the rim
    /// (ideal finished pint: liquid + `GlassGeometry.targetHeadMM` of head).
    var fillFraction: Double = 0.0

    /// Current flow in column-fraction per second; drives audio/haptic beds.
    var flowRatePerSecond: Double = 0.0

    /// 0→1 progress through the cascade settle. Fed straight into the shader's
    /// `u_progress`.
    var settleProgress: Double = 0.0

    /// Glass tilt in degrees, for rendering the glass rotation.
    var tiltDegrees: Double = 0.0

    var spilled: Bool = false

    /// Seconds of active attempt time (first tap-open → completion).
    var activeSeconds: TimeInterval = 0.0

    var score: PourScore?
}

/// Five-component pour score. Components are 0…1; `total` is the weighted 0–100.
struct PourScore: Codable, Equatable {
    var partOneFill: Double
    var angle: Double
    var settle: Double
    var head: Double
    var timing: Double

    var spilled: Bool
    var earlyTopOff: Bool
    var finalHeadMM: Double
    var activeSeconds: TimeInterval
    var date: Date = .now

    var total: Double {
        (partOneFill * Balance.pourWeightPartOne
            + angle * Balance.pourWeightAngle
            + settle * Balance.pourWeightSettle
            + head * Balance.pourWeightHead
            + timing * Balance.pourWeightTiming) * 100.0
    }

    var grade: PourGrade { PourGrade.from(total: total) }

    /// The weakest of the five components — the source of the critique line.
    var lowestComponent: PourComponent {
        let pairs: [(PourComponent, Double)] = [
            (.partOneFill, partOneFill),
            (.angle, angle),
            (.settle, settle),
            (.head, head),
            (.timing, timing),
        ]
        return pairs.min { $0.1 < $1.1 }!.0
    }

    func value(of component: PourComponent) -> Double {
        switch component {
        case .partOneFill: return partOneFill
        case .angle: return angle
        case .settle: return settle
        case .head: return head
        case .timing: return timing
        }
    }
}
