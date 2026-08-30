import SpriteKit

/// Mode 2 scene. Deliberately greybox: the player's face is over the screen, so
/// the render exists for calibration, spectators, and the replay — audio and
/// haptics are the real feedback channel. The scene renders state and forwards
/// input; every rule lives in `SplitEngine`.
final class SplitScene: SKScene {
    // Injected by SplitModeView.
    weak var motion: MotionProviding?
    weak var audio: AudioProviding?
    weak var haptics: HapticProviding?
    weak var replay: ReplayService?
    var onStateChange: ((SplitState) -> Void)?
    var onScored: ((SplitResult) -> Void)?

    /// Accessibility / Simulator path: drag vertically to tip the glass.
    var usesTouchFallback = false

    private var engine = SplitEngine()
    private let touchProvider = TouchMotionProvider()
    private var lastUpdateTime: TimeInterval = 0
    private var lastFeedbackZone: Int?
    private var attemptRunning = false

    // Greybox nodes: plain rects and lines, no textures. Feel first, art later.
    private let glassRect = SKShapeNode()
    private let liquidRect = SKSpriteNode(
        color: SKColor(red: 0.075, green: 0.055, blue: 0.045, alpha: 1), size: .zero
    )
    private let gBandRect = SKSpriteNode(
        color: SKColor(red: 0.85, green: 0.72, blue: 0.35, alpha: 0.35), size: .zero
    )
    private let gCenterLine = SKShapeNode()
    private var touchOrigin: CGPoint?

    private var glassFrame: CGRect {
        let height = size.height * 0.6
        let width = height * 0.42
        return CGRect(
            x: -width / 2, y: -height / 2 - size.height * 0.05,
            width: width, height: height
        )
    }

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.10, green: 0.09, blue: 0.11, alpha: 1)
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        scaleMode = .resizeFill
        [glassRect, liquidRect, gBandRect, gCenterLine].forEach { node in
            if node.parent == nil { addChild(node) }
        }
        layout()
    }

    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        layout()
    }

    private func layout() {
        let frame = glassFrame
        glassRect.path = CGPath(
            roundedRect: frame, cornerWidth: 6, cornerHeight: 6, transform: nil
        )
        glassRect.strokeColor = SKColor(white: 0.85, alpha: 0.9)
        glassRect.lineWidth = 3
        glassRect.fillColor = .clear
        glassRect.zPosition = 2

        liquidRect.anchorPoint = CGPoint(x: 0.5, y: 0)
        liquidRect.position = CGPoint(x: frame.midX, y: frame.minY)
        liquidRect.zPosition = 1

        gBandRect.size = CGSize(
            width: frame.width,
            height: frame.height * GlassGeometry.gHeightFraction
        )
        gBandRect.position = CGPoint(
            x: frame.midX,
            y: frame.minY + frame.height * GlassGeometry.gCenterFraction
        )
        gBandRect.zPosition = 3

        let linePath = CGMutablePath()
        linePath.move(to: CGPoint(x: frame.minX - 14, y: 0))
        linePath.addLine(to: CGPoint(x: frame.maxX + 14, y: 0))
        gCenterLine.path = linePath
        gCenterLine.strokeColor = SKColor(red: 0.85, green: 0.72, blue: 0.35, alpha: 0.9)
        gCenterLine.lineWidth = 1.5
        gCenterLine.position = CGPoint(
            x: 0, y: frame.minY + frame.height * GlassGeometry.gCenterFraction
        )
        gCenterLine.zPosition = 3

        render(level: engine.state.levelFraction)
    }

    // MARK: - Attempt lifecycle

    /// idle → calibrate → armed. The view calls this on the Start tap.
    func startAttempt() {
        if usesTouchFallback {
            touchProvider.calibrate()
        } else {
            motion?.start()
            motion?.calibrate()
        }
        engine = SplitEngine()
        engine.assisted = usesTouchFallback
        engine.arm()
        attemptRunning = true
        lastFeedbackZone = feedbackZone(for: 1.0)
        replay?.beginAttempt()
        audio?.playGlassSetDown()
    }

    func cancelAttempt() {
        guard attemptRunning else { return }
        attemptRunning = false
        _ = engine.finalize()
        finishAttempt()
    }

    override func update(_ currentTime: TimeInterval) {
        defer { lastUpdateTime = currentTime }
        guard attemptRunning, lastUpdateTime > 0 else { return }
        // Clamp so a dropped frame or background hop can't teleport the drain.
        let deltaTime = min(currentTime - lastUpdateTime, 1.0 / 20.0)

        let provider: MotionProviding = usesTouchFallback ? touchProvider : (motion ?? touchProvider)
        let state = engine.tick(
            deltaTime: deltaTime,
            tiltRadians: provider.tiltRadians,
            angularVelocity: provider.angularVelocity
        )

        render(level: state.levelFraction)
        driveFeedback(state: state)
        replay?.record(state: state)
        onStateChange?(state)

        if state.elapsedSeconds > Balance.splitAttemptTimeout, state.phase != .scored {
            _ = engine.finalize()
        }
        if engine.state.phase == .scored {
            attemptRunning = false
            finishAttempt()
        }
    }

    private func finishAttempt() {
        audio?.setFlowRate(0)
        haptics?.setFlowIntensity(0)
        guard let result = engine.state.result else { return }
        replay?.endAttempt(result: result)
        let success = result.grade == .perfectSplit || result.grade == .cleanSplit
        audio?.playGradeStinger(success: success)
        haptics?.playGradeStinger(success: success)
        onScored?(result)
    }

    // MARK: - Rendering & feedback

    private func render(level: Double) {
        let frame = glassFrame
        liquidRect.size = CGSize(
            width: frame.width,
            height: frame.height * CGFloat(max(0, min(1, level)))
        )
    }

    private func driveFeedback(state: SplitState) {
        let normalizedFlow = state.drainRatePerSecond / Balance.effectiveMaxDrainPerSecond
        audio?.setFlowRate(normalizedFlow)
        haptics?.setFlowIntensity(normalizedFlow)

        if state.enteredGBandThisTick {
            haptics?.playEnterGBand()
        }
        let zone = feedbackZone(for: state.levelFraction)
        if let last = lastFeedbackZone, zone != last {
            haptics?.playZoneCross()
        }
        lastFeedbackZone = zone
    }

    private func feedbackZone(for level: Double) -> Int {
        Int(max(0, min(1, level)) * Double(Balance.splitFeedbackZones))
    }

    // MARK: - Touch fallback (drag vertically to tip)

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard usesTouchFallback, let touch = touches.first else { return }
        touchOrigin = touch.location(in: self)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard usesTouchFallback, let touch = touches.first, let origin = touchOrigin else { return }
        let dragDown = origin.y - touch.location(in: self).y
        // Half the scene height of downward drag = maximum tilt.
        let normalized = max(0, min(1, dragDown / (size.height * 0.5)))
        touchProvider.setTilt(radians: normalized * Balance.maxTiltRadians)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard usesTouchFallback else { return }
        touchOrigin = nil
        touchProvider.setTilt(radians: 0)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        touchesEnded(touches, with: event)
    }
}
