import Foundation
import Combine
import CoreMotion

/// Abstraction over device motion so engines, scenes, and previews can run
/// against fakes (and the Simulator, where CoreMotion does not exist).
protocol MotionProviding: AnyObject {
    /// Filtered tilt from the calibrated upright pose, in radians. This is the
    /// ONE boundary where raw motion becomes game input.
    var tiltRadians: Double { get }
    /// Signed angular velocity around the tipping axis, radians/second.
    var angularVelocity: Double { get }
    var isAvailable: Bool { get }
    func start()
    func stop()
    /// Capture the current attitude as "upright, glass full". Called on every
    /// attempt start — without this the game breaks for anyone not standing
    /// perfectly straight.
    func calibrate()
}

final class MotionService: ObservableObject, MotionProviding {
    @Published private(set) var tiltRadians: Double = 0
    @Published private(set) var angularVelocity: Double = 0

    private let manager = CMMotionManager()

    /// Gravity direction captured at `calibrate()`. Tilt is measured as the
    /// angle between live gravity and this reference — computed from the
    /// gravity vector, NOT Euler pitch, because pitch gimbal-locks as the
    /// device approaches vertical and this game lives in that range.
    private var referenceGravity: CMAcceleration?
    private var pendingCalibration = false
    private var filteredTilt: Double = 0

    var isAvailable: Bool { manager.isDeviceMotionAvailable }

    func start() {
        guard isAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / Balance.motionUpdateHz
        manager.startDeviceMotionUpdates(
            using: .xArbitraryZVertical,
            to: .main
        ) { [weak self] motion, _ in
            guard let self, let motion else { return }
            self.ingest(motion)
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
        referenceGravity = nil
        filteredTilt = 0
        tiltRadians = 0
        angularVelocity = 0
    }

    func calibrate() {
        // Capture on the next sample so we never store a stale pose.
        pendingCalibration = true
        filteredTilt = 0
    }

    private func ingest(_ motion: CMDeviceMotion) {
        let gravity = motion.gravity
        if pendingCalibration || referenceGravity == nil {
            referenceGravity = gravity
            pendingCalibration = false
        }
        guard let reference = referenceGravity else { return }

        let dot = gravity.x * reference.x + gravity.y * reference.y + gravity.z * reference.z
        let magProduct = magnitude(gravity) * magnitude(reference)
        let cosine = magProduct > 0 ? max(-1.0, min(1.0, dot / magProduct)) : 1.0
        let rawTilt = acos(cosine)

        // Single low-pass keeps the drain from chattering on hand tremor while
        // staying responsive enough to feel 1:1.
        filteredTilt += Balance.tiltLowPassAlpha * (rawTilt - filteredTilt)
        tiltRadians = filteredTilt

        // Tipping the glass to the mouth is a rotation about the device's
        // x-axis in portrait — that component carries the sip's direction sign
        // for the shake detector.
        angularVelocity = motion.rotationRate.x
    }

    private func magnitude(_ vector: CMAcceleration) -> Double {
        sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
    }
}

/// Touch-driven stand-in for the Simulator and the accessibility fallback.
/// The scene feeds it drag deltas; attempts made through it are `assisted`.
final class TouchMotionProvider: MotionProviding {
    private(set) var tiltRadians: Double = 0
    private(set) var angularVelocity: Double = 0
    let isAvailable = true

    func start() {}
    func stop() { setTilt(radians: 0) }
    func calibrate() { setTilt(radians: 0) }

    func setTilt(radians: Double) {
        let clamped = max(0, min(Balance.maxTiltRadians, radians))
        // Approximate angular velocity from the tilt delta at the motion rate,
        // so integrity checks behave the same as on hardware.
        angularVelocity = (clamped - tiltRadians) * Balance.motionUpdateHz
        tiltRadians = clamped
    }
}
