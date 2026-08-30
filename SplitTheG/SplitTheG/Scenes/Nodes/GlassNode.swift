import SpriteKit

/// The Griffin's Extra Stout pint, shared by every mode: glass outline, liquid
/// body, separate head layer, the G roundel, and a surface quad that
/// counter-rotates so the liquid line stays level with gravity.
///
/// The liquid is a bottom-anchored sprite whose height tracks the level —
/// deliberately NOT an `SKCropNode` mask, which is expensive when the mask
/// changes every frame.
final class GlassNode: SKNode {
    private static let bodyColor = SKColor(red: 0.075, green: 0.055, blue: 0.045, alpha: 1.0)
    private static let headColor = SKColor(red: 0.93, green: 0.88, blue: 0.78, alpha: 1.0)
    private static let glassLineColor = SKColor(white: 0.85, alpha: 0.9)
    private static let roundelColor = SKColor(red: 0.85, green: 0.72, blue: 0.35, alpha: 1.0)

    let glassSize: CGSize

    private let liquid: SKSpriteNode
    private let head: SKSpriteNode
    private let surface: SKSpriteNode
    private let outline: SKShapeNode
    private let roundel: SKNode
    private let emblemLine: SKShapeNode

    private(set) var totalFraction: Double = 0

    init(size: CGSize, showRoundel: Bool = true) {
        glassSize = size

        liquid = SKSpriteNode(color: Self.bodyColor, size: CGSize(width: size.width, height: 0))
        liquid.anchorPoint = CGPoint(x: 0.5, y: 0)
        liquid.position = CGPoint(x: 0, y: -size.height / 2)

        head = SKSpriteNode(color: Self.headColor, size: CGSize(width: size.width, height: 0))
        head.anchorPoint = CGPoint(x: 0.5, y: 0)

        surface = SKSpriteNode(
            color: Self.headColor.withAlphaComponent(0.001),
            size: CGSize(width: size.width * 1.02, height: max(3, size.height * 0.02))
        )
        surface.zPosition = 3

        outline = SKShapeNode(
            rectOf: CGSize(width: size.width + 6, height: size.height + 6),
            cornerRadius: 6
        )
        outline.strokeColor = Self.glassLineColor
        outline.lineWidth = 3
        outline.fillColor = .clear
        outline.zPosition = 4

        roundel = GlassNode.makeRoundel(glassWidth: size.width)
        roundel.position = CGPoint(
            x: 0,
            y: -size.height / 2 + size.height * GlassGeometry.gCenterFraction
        )
        roundel.zPosition = 5
        roundel.isHidden = !showRoundel

        let emblemPath = CGMutablePath()
        emblemPath.move(to: CGPoint(x: -size.width / 2, y: 0))
        emblemPath.addLine(to: CGPoint(x: size.width / 2, y: 0))
        emblemLine = SKShapeNode(path: emblemPath)
        emblemLine.strokeColor = Self.roundelColor.withAlphaComponent(0.8)
        emblemLine.lineWidth = 2
        emblemLine.position = CGPoint(
            x: 0,
            y: -size.height / 2 + size.height * GlassGeometry.emblemLineFraction
        )
        emblemLine.zPosition = 5
        emblemLine.isHidden = true

        super.init()

        // Liquid surface shimmer; failure to load leaves a plain quad — fine.
        if let shaderSource = GlassNode.loadShaderSource(named: "liquid_surface") {
            let shader = SKShader(source: shaderSource)
            shader.uniforms = [SKUniform(name: "u_agitation", float: 0.0)]
            surface.shader = shader
        }

        [liquid, head, surface, outline, roundel, emblemLine].forEach(addChild)
        isAccessibilityElement = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("GlassNode is code-constructed only") }

    /// The griffin roundel: gold ring, serif G, tiny griffin mark above.
    /// Placeholder-art tier — real art replaces this whole node later.
    private static func makeRoundel(glassWidth: CGFloat) -> SKNode {
        let container = SKNode()
        let radius = glassWidth * 0.30
        let ring = SKShapeNode(circleOfRadius: radius)
        ring.strokeColor = roundelColor
        ring.lineWidth = 3
        ring.fillColor = .clear
        container.addChild(ring)

        let letter = SKLabelNode(text: "G")
        letter.fontName = "Georgia-Bold"
        letter.fontSize = radius * 1.5
        letter.fontColor = roundelColor
        letter.verticalAlignmentMode = .center
        letter.horizontalAlignmentMode = .center
        container.addChild(letter)

        let griffin = SKLabelNode(text: "Griffin's")
        griffin.fontName = "Georgia-Italic"
        griffin.fontSize = radius * 0.34
        griffin.fontColor = roundelColor
        griffin.verticalAlignmentMode = .center
        griffin.position = CGPoint(x: 0, y: radius * 1.35)
        container.addChild(griffin)
        return container
    }

    static func loadShaderSource(named name: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "fsh") else {
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    // MARK: - State

    /// Render a fill level. `totalFraction` is the whole column (liquid + head);
    /// `headFraction` is how much of it is head right now.
    func setFill(totalFraction: Double, headFraction: Double, agitation: Double = 0) {
        self.totalFraction = totalFraction
        let clampedTotal = max(0, min(1.0 + Balance.spillGraceFraction, totalFraction))
        let headPart = max(0, min(clampedTotal, headFraction))
        let liquidPart = clampedTotal - headPart

        let columnHeight = glassSize.height
        liquid.size.height = columnHeight * liquidPart
        head.size.height = columnHeight * headPart
        head.position = CGPoint(x: 0, y: -columnHeight / 2 + columnHeight * liquidPart)

        surface.position = CGPoint(
            x: 0,
            y: -columnHeight / 2 + columnHeight * clampedTotal
        )
        surface.isHidden = clampedTotal <= 0.001
        if let uniform = surface.shader?.uniformNamed("u_agitation") {
            uniform.floatValue = Float(max(0, min(1, agitation)))
        }
    }

    /// Rotate the glass while keeping the liquid surface level with gravity.
    func setGlassRotation(_ radians: CGFloat) {
        zRotation = radians
        surface.zRotation = -radians
    }

    /// Easy difficulty shows the part-one emblem guide; Normal/Hard do not.
    func setEmblemGuideVisible(_ visible: Bool) {
        emblemLine.isHidden = !visible
    }

    func setRoundelVisible(_ visible: Bool) {
        roundel.isHidden = !visible
    }

    /// Y position (in this node's coordinates) of a column fraction — used by
    /// scenes to draw measurement lines and the G band.
    func yFor(fraction: Double) -> CGFloat {
        -glassSize.height / 2 + glassSize.height * fraction
    }
}
