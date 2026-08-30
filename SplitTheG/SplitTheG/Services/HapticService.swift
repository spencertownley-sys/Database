import Foundation
import CoreHaptics
import UIKit

/// Haptics are Mode 2's primary feedback channel — the screen is against the
/// player's face. Failures degrade silently to a working game: CoreHaptics →
/// UIImpactFeedbackGenerator → nothing. Never an error, never a crash.
protocol HapticProviding: AnyObject {
    func prepare()
    func shutdown()
    /// Modulate the continuous flow bed. 0 = no flow, 1 = max drain/pour.
    func setFlowIntensity(_ intensity: Double)
    /// Transient tick when the liquid line crosses a feedback zone boundary.
    func playZoneCross()
    /// Distinct heavy transient when the line enters the G band.
    func playEnterGBand()
    func playGradeStinger(success: Bool)
    var isEnabled: Bool { get set }
}

final class HapticService: HapticProviding {
    var isEnabled = true

    private var engine: CHHapticEngine?
    private var flowPlayer: CHHapticAdvancedPatternPlayer?
    private var supportsCoreHaptics: Bool {
        CHHapticEngine.capabilitiesForHardware().supportsHaptics
    }

    // Fallback generators, prepared up front — creating them per-event stutters.
    private let impactLight = UIImpactFeedbackGenerator(style: .light)
    private let impactHeavy = UIImpactFeedbackGenerator(style: .heavy)
    private let notification = UINotificationFeedbackGenerator()

    func prepare() {
        impactLight.prepare()
        impactHeavy.prepare()
        notification.prepare()
        guard supportsCoreHaptics else { return }
        do {
            let engine = try CHHapticEngine()
            engine.playsHapticsOnly = true
            // Recover quietly from interruptions — audio sessions, phone calls.
            engine.resetHandler = { [weak self] in self?.restart() }
            engine.stoppedHandler = { _ in }
            try engine.start()
            self.engine = engine
            makeFlowPlayer()
        } catch {
            engine = nil // fall back to UIKit generators
        }
    }

    func shutdown() {
        try? flowPlayer?.stop(atTime: CHHapticTimeImmediate)
        engine?.stop()
        engine = nil
        flowPlayer = nil
    }

    private func restart() {
        try? engine?.start()
        makeFlowPlayer()
    }

    /// One continuous player for the whole attempt, modulated with dynamic
    /// parameters. Recreating players per frame stutters — never do it.
    private func makeFlowPlayer() {
        guard let engine else { return }
        do {
            let continuous = CHHapticEvent(
                eventType: .hapticContinuous,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.0),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.3),
                ],
                relativeTime: 0,
                duration: 3600
            )
            let pattern = try CHHapticPattern(events: [continuous], parameters: [])
            flowPlayer = try engine.makeAdvancedPlayer(with: pattern)
            try flowPlayer?.start(atTime: CHHapticTimeImmediate)
        } catch {
            flowPlayer = nil
        }
    }

    func setFlowIntensity(_ intensity: Double) {
        guard isEnabled else { return }
        let clamped = Float(max(0.0, min(1.0, intensity)))
        guard let flowPlayer else { return }
        let intensityParameter = CHHapticDynamicParameter(
            parameterID: .hapticIntensityControl,
            value: clamped,
            relativeTime: 0
        )
        // Sharpness rises with flow: a trickle purrs, a gush buzzes.
        let sharpnessParameter = CHHapticDynamicParameter(
            parameterID: .hapticSharpnessControl,
            value: 0.2 + clamped * 0.6,
            relativeTime: 0
        )
        try? flowPlayer.sendParameters(
            [intensityParameter, sharpnessParameter],
            atTime: CHHapticTimeImmediate
        )
    }

    func playZoneCross() {
        guard isEnabled else { return }
        if !playTransient(intensity: 0.5, sharpness: 0.7) {
            impactLight.impactOccurred()
        }
    }

    func playEnterGBand() {
        guard isEnabled else { return }
        if !playTransient(intensity: 1.0, sharpness: 0.4) {
            impactHeavy.impactOccurred()
        }
    }

    func playGradeStinger(success: Bool) {
        guard isEnabled else { return }
        notification.notificationOccurred(success ? .success : .error)
    }

    private func playTransient(intensity: Float, sharpness: Float) -> Bool {
        guard let engine else { return false }
        do {
            let event = CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
                ],
                relativeTime: 0
            )
            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
            return true
        } catch {
            return false
        }
    }
}
