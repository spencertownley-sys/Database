import SpriteKit

/// The two-part pour's surge: a fragment shader over the glass rect driven by
/// the engine's settle timer, with a discrete bubble emitter on top. If the
/// shader source can't be loaded, the node degrades to emitter-only rather
/// than crashing.
final class CascadeNode: SKNode {
    private let shaderSprite: SKSpriteNode?
    private let bubbles: SKEmitterNode
    private let progressUniform: SKUniform?

    init(size: CGSize) {
        if let source = GlassNode.loadShaderSource(named: "cascade") {
            let sprite = SKSpriteNode(color: .white, size: size)
            let shader = SKShader(source: source)
            let progress = SKUniform(name: "u_progress", float: 0)
            shader.uniforms = [
                progress,
                SKUniform(
                    name: "u_samples",
                    float: Float(Balance.cascadeQuality.shaderSampleCount)
                ),
                SKUniform(
                    name: "u_headFrac",
                    float: Float(GlassGeometry.targetHeadFraction)
                ),
            ]
            sprite.shader = shader
            shaderSprite = sprite
            progressUniform = progress
        } else {
            shaderSprite = nil
            progressUniform = nil
        }

        bubbles = CascadeNode.makeBubbleEmitter(size: size)
        super.init()
        if let shaderSprite { addChild(shaderSprite) }
        bubbles.zPosition = 1
        addChild(bubbles)
        isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("CascadeNode is code-constructed only") }

    func begin() {
        isHidden = false
        bubbles.resetSimulation()
        setProgress(0)
    }

    /// Drive from `PourState.settleProgress` every frame.
    func setProgress(_ progress: Double) {
        progressUniform?.floatValue = Float(max(0, min(1, progress)))
        // Bubbles thin out as the body settles.
        bubbles.particleBirthRate = CGFloat(90.0 * (1.0 - progress) + 6.0)
        if progress >= 1 { finish() }
    }

    func finish() {
        isHidden = true
        bubbles.particleBirthRate = 0
    }

    /// Programmatic emitter — no .sks archives, no image assets.
    private static func makeBubbleEmitter(size: CGSize) -> SKEmitterNode {
        let emitter = SKEmitterNode()
        emitter.particleTexture = circleTexture(radius: 3)
        emitter.particleBirthRate = 0
        emitter.particleLifetime = 1.6
        emitter.particleLifetimeRange = 0.8
        emitter.particlePositionRange = CGVector(dx: size.width * 0.85, dy: size.height * 0.2)
        emitter.position = CGPoint(x: 0, y: -size.height * 0.35)
        emitter.particleSpeed = CGFloat(size.height * 0.22)
        emitter.particleSpeedRange = CGFloat(size.height * 0.12)
        emitter.emissionAngle = .pi / 2
        emitter.emissionAngleRange = .pi / 10
        emitter.particleAlpha = 0.55
        emitter.particleAlphaSpeed = -0.35
        emitter.particleScale = 0.5
        emitter.particleScaleRange = 0.35
        emitter.particleColor = SKColor(red: 0.9, green: 0.85, blue: 0.75, alpha: 1)
        emitter.particleColorBlendFactor = 1
        return emitter
    }

    static func circleTexture(radius: CGFloat) -> SKTexture {
        let diameter = radius * 2
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: diameter, height: diameter))
        let image = renderer.image { context in
            UIColor.white.setFill()
            context.cgContext.fillEllipse(
                in: CGRect(x: 0, y: 0, width: diameter, height: diameter)
            )
        }
        return SKTexture(image: image)
    }
}
