import Foundation

/// One container owning the live service instances, injected through the
/// environment so every screen shares the same motion/audio/haptic state.
/// Views depend on the protocols; this is the composition root.
final class GameServices: ObservableObject {
    let motion = MotionService()
    let haptics = HapticService()
    let audio = AudioService()
    let replay = ReplayService()

    func startForGameplay() {
        audio.start()
        haptics.prepare()
    }

    func stopAfterGameplay() {
        motion.stop()
        audio.setFlowRate(0)
        haptics.setFlowIntensity(0)
    }

    func applySettings(from records: PlayerRecords) {
        audio.isEnabled = records.audioEnabled
        haptics.isEnabled = records.hapticsEnabled
    }
}
