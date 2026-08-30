import SpriteKit

/// A cartoon pub customer: atlas-backed sprite, order card, draining patience
/// meter. Nodes are pooled — The Rush churns through customers and must never
/// allocate node trees mid-wave.
final class CustomerNode: SKNode {
    static let spriteSize = CGSize(width: 86, height: 110)

    private static var pool: [CustomerNode] = []
    private static var textureCache: [String: SKTexture] = [:]

    private let sprite: SKSpriteNode
    private let patienceBackground: SKSpriteNode
    private let patienceBar: SKSpriteNode
    private let orderLabel: SKLabelNode
    private let orderGlass: SKShapeNode
    private let orderFill: SKSpriteNode

    private(set) var customerID: UUID?

    // MARK: - Pooling

    static func obtain() -> CustomerNode {
        pool.popLast() ?? CustomerNode()
    }

    func recycle() {
        removeAllActions()
        removeFromParent()
        customerID = nil
        Self.pool.append(self)
    }

    override init() {
        sprite = SKSpriteNode(color: .clear, size: Self.spriteSize)

        patienceBackground = SKSpriteNode(
            color: SKColor(white: 0.2, alpha: 0.8),
            size: CGSize(width: Self.spriteSize.width, height: 8)
        )
        patienceBackground.position = CGPoint(x: 0, y: Self.spriteSize.height / 2 + 12)

        patienceBar = SKSpriteNode(
            color: .green, size: CGSize(width: Self.spriteSize.width, height: 8)
        )
        patienceBar.anchorPoint = CGPoint(x: 0, y: 0.5)
        patienceBar.position = CGPoint(x: -Self.spriteSize.width / 2, y: 0)
        patienceBackground.addChild(patienceBar)

        orderLabel = SKLabelNode(text: "")
        orderLabel.fontName = "AvenirNext-Bold"
        orderLabel.fontSize = 13
        orderLabel.fontColor = .white
        orderLabel.verticalAlignmentMode = .center
        orderLabel.position = CGPoint(x: -6, y: Self.spriteSize.height / 2 + 32)

        // Tiny glass icon showing the target fill band.
        orderGlass = SKShapeNode(rectOf: CGSize(width: 14, height: 24), cornerRadius: 2)
        orderGlass.strokeColor = .white
        orderGlass.lineWidth = 1.5
        orderGlass.fillColor = .clear
        orderGlass.position = CGPoint(x: 34, y: Self.spriteSize.height / 2 + 32)

        orderFill = SKSpriteNode(color: SKColor(red: 0.85, green: 0.72, blue: 0.35, alpha: 1),
                                 size: CGSize(width: 12, height: 4))
        orderFill.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        orderGlass.addChild(orderFill)

        super.init()
        addChild(sprite)
        addChild(patienceBackground)
        addChild(orderLabel)
        addChild(orderGlass)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("CustomerNode is code-constructed only") }

    // MARK: - Configuration

    func configure(with customer: Customer) {
        customerID = customer.id
        sprite.texture = Self.texture(for: customer.archetype)
        sprite.size = Self.spriteSize
        orderLabel.text = Self.orderText(customer.order)
        let bandY = -12.0 + 24.0 * customer.order.targetFraction
        orderFill.position = CGPoint(x: 0, y: bandY - 12.0)
        updatePatience(fraction: customer.patienceFraction)

        isAccessibilityElement = true
        accessibilityLabel = "\(customer.archetype.rawValue), wants \(Self.orderText(customer.order))"
    }

    func updatePatience(fraction: Double) {
        let clamped = max(0, min(1, fraction))
        patienceBar.xScale = CGFloat(clamped)
        switch clamped {
        case ..<0.25: patienceBar.color = .red
        case ..<0.55: patienceBar.color = .orange
        default: patienceBar.color = .green
        }
    }

    private static func orderText(_ order: Customer.Order) -> String {
        switch order {
        case .fullPour: return "Full pint"
        case .emblemPour: return "To the griffin"
        case .halfPour: return "Half"
        }
    }

    // MARK: - Textures

    /// Atlas texture when the art exists, generated placeholder otherwise.
    private static func texture(for archetype: Customer.Archetype) -> SKTexture {
        let key = "customer_\(archetype.rawValue)"
        if let cached = textureCache[key] { return cached }
        let texture: SKTexture
        if UIImage(named: key) != nil {
            texture = SKTexture(imageNamed: key)
        } else {
            texture = placeholderTexture(for: archetype)
        }
        textureCache[key] = texture
        return texture
    }

    private static func placeholderTexture(for archetype: Customer.Archetype) -> SKTexture {
        let index = Customer.Archetype.allCases.firstIndex(of: archetype) ?? 0
        let hue = CGFloat(index) / CGFloat(Customer.Archetype.allCases.count)
        let color = UIColor(hue: hue, saturation: 0.55, brightness: 0.85, alpha: 1)
        let renderer = UIGraphicsImageRenderer(size: spriteSize)
        let image = renderer.image { context in
            color.setFill()
            let body = UIBezierPath(
                roundedRect: CGRect(origin: .zero, size: spriteSize), cornerRadius: 18
            )
            body.fill()
            let initial = String(archetype.rawValue.prefix(1)).uppercased()
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 40),
                .foregroundColor: UIColor.white,
            ]
            let textSize = initial.size(withAttributes: attributes)
            initial.draw(
                at: CGPoint(
                    x: (spriteSize.width - textSize.width) / 2,
                    y: (spriteSize.height - textSize.height) / 2
                ),
                withAttributes: attributes
            )
            _ = context
        }
        return SKTexture(image: image)
    }
}
