import SpriteKit

/// The bar tap: press and hold to pour. Pure rendering — the scene owns hit
/// testing and forwards press state to the engine.
final class TapHandleNode: SKNode {
    static let nodeName = "tapHandle"

    private let handle: SKShapeNode
    private let spout: SKShapeNode

    override init() {
        handle = SKShapeNode(
            rectOf: CGSize(width: 26, height: 74), cornerRadius: 12
        )
        handle.fillColor = SKColor(red: 0.16, green: 0.12, blue: 0.10, alpha: 1)
        handle.strokeColor = SKColor(red: 0.85, green: 0.72, blue: 0.35, alpha: 1)
        handle.lineWidth = 2
        handle.position = CGPoint(x: 0, y: 48)

        spout = SKShapeNode(
            rectOf: CGSize(width: 18, height: 34), cornerRadius: 4
        )
        spout.fillColor = SKColor(red: 0.75, green: 0.75, blue: 0.78, alpha: 1)
        spout.strokeColor = .clear

        super.init()
        name = Self.nodeName
        handle.name = Self.nodeName
        spout.name = Self.nodeName
        addChild(spout)
        addChild(handle)

        isAccessibilityElement = true
        accessibilityLabel = "Tap handle"
        accessibilityHint = "Press and hold to pour"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("TapHandleNode is code-constructed only") }

    func setEngaged(_ engaged: Bool) {
        handle.zRotation = engaged ? -0.5 : 0
        handle.fillColor = engaged
            ? SKColor(red: 0.28, green: 0.20, blue: 0.14, alpha: 1)
            : SKColor(red: 0.16, green: 0.12, blue: 0.10, alpha: 1)
    }
}
