import SpriteKit

/// Mode 1 scene: tilt rotates the glass, press-and-hold on the tap pours.
/// Renders `PourState`; every rule lives in `PourEngine`.
final class PourScene: SKScene {
    weak var motion: MotionProviding?
    weak var audio: AudioProviding?
    weak var haptics: HapticProviding?
    var onStateChange: ((PourState) -> Void)?
    var onComplete: ((PourScore) -> Void)?

    private var engine = PourEngine()
    private var lastUpdateTime: TimeInterval = 0
    private var tapOpen = false
    private var running = false
    private var lastPhase: PourState.Phase = .empty

    private var glass: GlassNode?
    private var cascade: CascadeNode?
    private let tapHandle = TapHandleNode()
    private let stream = SKSpriteNode(
        color: SKColor(red: 0.35, green: 0.25, blue: 0.16, alpha: 0.9), size: .zero
    )
    private var spillEmitter: SKEmitterNode?

    private var glassSize: CGSize {
        let height = size.height * 0.45
        return CGSize(width: height * 0.42, height: height)
    }

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.12, green: 0.10, blue: 0.09, alpha: 1)
        anchorPoint = CGPoint(x: 0.5, y: 0.5)
        scaleMode = .resizeFill
        buildLayout()
    }

    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        guard view != nil else { return }
        buildLayout()
    }

    private func buildLayout() {
        removeAllChildren()

        let glassNode = GlassNode(size: glassSize, showRoundel: true)
        glassNode.position = CGPoint(x: 0, y: -size.height * 0.18)
        addChild(glassNode)
        glass = glassNode

        let cascadeNode = CascadeNode(size: CGSize(
            width: glassSize.width * 0.96, height: glassSize.height * 0.96
        ))
        cascadeNode.zPosition = 2
        glassNode.addChild(cascadeNode)
        cascade = cascadeNode

        tapHandle.position = CGPoint(x: 0, y: size.height * 0.30)
        addChild(tapHandle)

        stream.anchorPoint = CGPoint(x: 0.5, y: 1)
        stream.position = CGPoint(x: 0, y: size.height * 0.30 - 20)
        stream.zPosition = 1
        addChild(stream)

        let spill = CascadeNode.makeSpillEmitter()
        spill.position = CGPoint(
            x: 0, y: glassNode.position.y + glassSize.height / 2
        )
        spill.zPosition = 6
        addChild(spill)
        spillEmitter = spill
    }

    // MARK: - Lifecycle

    func startPour(difficulty showsEmblemGuide: Bool) {
        engine.reset()
        running = true
        lastPhase = .empty
        tapOpen = false
        glass?.setFill(totalFraction: 0, headFraction: 0)
        glass?.setEmblemGuideVisible(showsEmblemGuide)
        cascade?.finish()
        spillEmitter?.particleBirthRate = 0
        motion?.start()
        motion?.calibrate()
    }

    override func update(_ currentTime: TimeInterval) {
        defer { lastUpdateTime = currentTime }
        guard running, lastUpdateTime > 0 else { return }
        let deltaTime = min(currentTime - lastUpdateTime, 1.0 / 20.0)

        let tilt = motion?.tiltRadians ?? 0
        let state = engine.tick(
            deltaTime: deltaTime, tiltRadians: tilt, tapOpen: tapOpen
        )

        render(state: state, tiltRadians: tilt)
        driveFeedback(state: state)
        onStateChange?(state)

        if state.phase == .complete, let score = state.score {
            running = false
            audio?.setFlowRate(0)
            haptics?.setFlowIntensity(0)
            let success = score.grade == .masterPour || score.grade == .solid
            audio?.playGradeStinger(success: success)
            haptics?.playGradeStinger(success: success)
            onComplete?(score)
        }
        lastPhase = state.phase
    }

    private func render(state: PourState, tiltRadians: Double) {
        guard let glass else { return }
        glass.setGlassRotation(CGFloat(-tiltRadians))

        // Head grows in as the cascade resolves; during part one the pour is
        // all churn, so the head layer stays thin until settling begins.
        let headFraction: Double
        switch state.phase {
        case .empty, .pouringPartOne:
            headFraction = state.fillFraction * 0.05
        case .settling:
            headFraction = GlassGeometry.targetHeadFraction * state.settleProgress
        default:
            headFraction = GlassGeometry.targetHeadFraction
        }
        glass.setFill(
            totalFraction: state.fillFraction,
            headFraction: headFraction,
            agitation: state.flowRatePerSecond / Balance.effectiveBaseFlowPerSecond
        )

        let pouring = state.flowRatePerSecond > 0
        stream.isHidden = !pouring
        if pouring {
            let glassTopY = glass.position.y + glassSize.height / 2
            stream.size = CGSize(
                width: 8 + state.flowRatePerSecond / Balance.effectiveBaseFlowPerSecond * 6,
                height: stream.position.y - glassTopY
            )
        }
        tapHandle.setEngaged(tapOpen && pouring)

        if state.spilled {
            spillEmitter?.particleBirthRate = 120
        } else {
            spillEmitter?.particleBirthRate = 0
        }
    }

    private func driveFeedback(state: PourState) {
        audio?.setFlowRate(state.flowRatePerSecond / Balance.effectiveBaseFlowPerSecond)
        haptics?.setFlowIntensity(state.flowRatePerSecond / Balance.effectiveBaseFlowPerSecond)

        // Phase edges carry the audio story: surge kickoff, ready cue.
        if lastPhase != .settling, state.phase == .settling {
            audio?.playCascade()
            cascade?.begin()
            haptics?.playZoneCross()
        }
        if state.phase == .settling {
            cascade?.setProgress(state.settleProgress)
        }
        if lastPhase == .settling, state.phase == .readyForTopOff {
            haptics?.playEnterGBand()
        }
        if !state.spilled { return }
        if lastPhase != state.phase { haptics?.playGradeStinger(success: false) }
    }

    // MARK: - Input: press-and-hold on the tap handle

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first else { return }
        let location = touch.location(in: self)
        // Generous hit area: anywhere in the tap's upper-screen zone works —
        // 44pt minimums matter more than realism here.
        if nodes(at: location).contains(where: { $0.name == TapHandleNode.nodeName })
            || location.y > size.height * 0.18 {
            tapOpen = true
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        tapOpen = false
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        tapOpen = false
    }
}

extension CascadeNode {
    /// Overflow foam spraying off the rim — Mode 1's spill effect.
    static func makeSpillEmitter() -> SKEmitterNode {
        let emitter = SKEmitterNode()
        emitter.particleTexture = circleTexture(radius: 2.5)
        emitter.particleBirthRate = 0
        emitter.particleLifetime = 0.8
        emitter.particlePositionRange = CGVector(dx: 60, dy: 4)
        emitter.particleSpeed = 90
        emitter.particleSpeedRange = 40
        emitter.emissionAngle = .pi / 2
        emitter.emissionAngleRange = .pi / 3
        emitter.yAcceleration = -350
        emitter.particleAlpha = 0.8
        emitter.particleAlphaSpeed = -1.0
        emitter.particleColor = SKColor(red: 0.9, green: 0.85, blue: 0.75, alpha: 1)
        emitter.particleColorBlendFactor = 1
        return emitter
    }
}
