import SpriteKit

/// Mode 3 scene, landscape: 3–5 tap stations across the bottom, the customer
/// queue above. Hold a station to fill its glass, flick upward to serve the
/// customer the flick points at. Renders `RushState`; all rules live in
/// `RushEngine`.
final class RushScene: SKScene {
    weak var audio: AudioProviding?
    weak var haptics: HapticProviding?
    var onStateChange: ((RushState) -> Void)?
    var onGameOver: ((RushState) -> Void)?

    var stationCount = 3

    private var engine = RushEngine()
    private var lastUpdateTime: TimeInterval = 0
    private var running = false

    private var stationNodes: [SKNode] = []
    private var stationGlasses: [SKSpriteNode] = []
    private var stationHandles: [TapHandleNode] = []
    private var customerNodes: [UUID: CustomerNode] = [:]
    private var touchStations: [UITouch: (station: Int, origin: CGPoint)] = [:]

    /// Minimum upward flick distance that reads as a serve, in points.
    private let serveFlickDistance: CGFloat = 70

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.13, green: 0.10, blue: 0.08, alpha: 1)
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
        customerNodes.values.forEach { $0.recycle() }
        customerNodes = [:]
        stationNodes = []
        stationGlasses = []
        stationHandles = []

        // Bar counter strip.
        let counter = SKSpriteNode(
            color: SKColor(red: 0.22, green: 0.15, blue: 0.10, alpha: 1),
            size: CGSize(width: size.width, height: size.height * 0.16)
        )
        counter.position = CGPoint(x: 0, y: -size.height * 0.30)
        addChild(counter)

        for index in 0..<stationCount {
            let station = SKNode()
            station.position = CGPoint(x: stationX(index), y: -size.height * 0.30)

            let handle = TapHandleNode()
            handle.setScale(0.7)
            handle.position = CGPoint(x: 0, y: 56)
            station.addChild(handle)
            stationHandles.append(handle)

            let glassOutline = SKShapeNode(
                rectOf: CGSize(width: 40, height: 64), cornerRadius: 4
            )
            glassOutline.strokeColor = SKColor(white: 0.85, alpha: 0.9)
            glassOutline.lineWidth = 2
            glassOutline.position = CGPoint(x: 0, y: 0)
            station.addChild(glassOutline)

            let fill = SKSpriteNode(
                color: SKColor(red: 0.075, green: 0.055, blue: 0.045, alpha: 1),
                size: CGSize(width: 36, height: 0)
            )
            fill.anchorPoint = CGPoint(x: 0.5, y: 0)
            fill.position = CGPoint(x: 0, y: -32)
            station.addChild(fill)
            stationGlasses.append(fill)

            addChild(station)
            stationNodes.append(station)
        }
    }

    private func stationX(_ index: Int) -> CGFloat {
        let spacing = size.width / CGFloat(stationCount + 1)
        return -size.width / 2 + spacing * CGFloat(index + 1)
    }

    private func customerX(slot: Int) -> CGFloat {
        let spacing = size.width / CGFloat(RushEngine.maxQueuedCustomers + 1)
        return -size.width / 2 + spacing * CGFloat(slot + 1)
    }

    // MARK: - Lifecycle

    func startRun(stationCount: Int, seed: UInt64 = UInt64.random(in: 0...UInt64.max)) {
        self.stationCount = stationCount
        engine = RushEngine(stationCount: stationCount, seed: seed)
        buildLayout()
        engine.start()
        running = true
    }

    override func update(_ currentTime: TimeInterval) {
        defer { lastUpdateTime = currentTime }
        guard running, lastUpdateTime > 0 else { return }
        let deltaTime = min(currentTime - lastUpdateTime, 1.0 / 20.0)
        let state = engine.tick(deltaTime: deltaTime)
        render(state: state)
        onStateChange?(state)

        if !state.walkoutsThisTick.isEmpty {
            haptics?.playGradeStinger(success: false)
            audio?.playGradeStinger(success: false)
        }
        if state.spilledThisTick {
            haptics?.playGradeStinger(success: false)
        }
        if state.phase == .gameOver {
            running = false
            audio?.setFlowRate(0)
            haptics?.setFlowIntensity(0)
            onGameOver?(state)
        }
    }

    private func render(state: RushState) {
        var pouringAny = false
        for (index, station) in state.stations.enumerated()
        where stationGlasses.indices.contains(index) {
            stationGlasses[index].size.height = 60 * CGFloat(min(1.1, station.fillFraction))
            stationHandles[index].setEngaged(station.isPouring)
            pouringAny = pouringAny || station.isPouring
        }
        audio?.setFlowRate(pouringAny ? 0.8 : 0)
        haptics?.setFlowIntensity(pouringAny ? 0.5 : 0)

        // Sync the pooled customer nodes with engine state.
        var seen = Set<UUID>()
        for (slot, customer) in state.customers.enumerated() {
            seen.insert(customer.id)
            let node: CustomerNode
            if let existing = customerNodes[customer.id] {
                node = existing
            } else {
                node = CustomerNode.obtain()
                node.configure(with: customer)
                addChild(node)
                customerNodes[customer.id] = node
            }
            node.updatePatience(fraction: customer.patienceFraction)
            let target = CGPoint(x: customerX(slot: slot), y: size.height * 0.16)
            if node.position == .zero {
                node.position = target
            } else if abs(node.position.x - target.x) > 1 {
                node.run(SKAction.move(to: target, duration: 0.25))
            }
        }
        for (id, node) in customerNodes where !seen.contains(id) {
            node.recycle()
            customerNodes.removeValue(forKey: id)
        }
    }

    // MARK: - Input: hold to fill, flick up to serve

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            let location = touch.location(in: self)
            guard location.y < -size.height * 0.05 else { continue }
            var nearest = 0
            var bestDistance = CGFloat.greatestFiniteMagnitude
            for index in 0..<stationCount {
                let distance = abs(location.x - stationX(index))
                if distance < bestDistance {
                    bestDistance = distance
                    nearest = index
                }
            }
            touchStations[touch] = (nearest, location)
            engine.startFill(station: nearest)
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            guard let tracked = touchStations.removeValue(forKey: touch) else { continue }
            engine.stopFill(station: tracked.station)

            let location = touch.location(in: self)
            let rise = location.y - tracked.origin.y
            guard rise > serveFlickDistance else { continue }

            // Serve whichever customer the flick's endpoint lines up with.
            let customers = engine.state.customers
            guard let target = customers.min(by: { lhs, rhs in
                let lhsX = customerNodes[lhs.id]?.position.x ?? 0
                let rhsX = customerNodes[rhs.id]?.position.x ?? 0
                return abs(lhsX - location.x) < abs(rhsX - location.x)
            }) else { continue }

            if let result = engine.serve(station: tracked.station, customerID: target.id) {
                haptics?.playGradeStinger(success: result.inBand)
                audio?.playGradeStinger(success: result.inBand)
            }
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        for touch in touches {
            if let tracked = touchStations.removeValue(forKey: touch) {
                engine.stopFill(station: tracked.station)
            }
        }
    }
}
