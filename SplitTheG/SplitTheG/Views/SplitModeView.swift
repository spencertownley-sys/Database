import SwiftUI
import SpriteKit

/// Mode 2 host: SpriteView + SwiftUI HUD. The screen is against the player's
/// face during play, so the HUD is for setup and results only.
struct SplitModeView: View {
    @EnvironmentObject private var persistence: PersistenceService
    @EnvironmentObject private var services: GameServices
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var scene = SplitScene(size: CGSize(width: 390, height: 700))
    @State private var attemptState: SplitState = SplitState()
    @State private var result: SplitResult?
    @State private var attemptActive = false
    @State private var useTouchFallback = false
    @State private var showTutorial = false

    var body: some View {
        ZStack {
            SpriteView(scene: scene)
                .ignoresSafeArea()
            hud
        }
        .navigationTitle("Split the G")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: configure)
        .onDisappear { services.stopAfterGameplay() }
        .sheet(item: $result) { scored in
            ResultsCardView(payload: .split(scored)) {
                result = nil
            }
            .environmentObject(persistence)
            .environmentObject(services)
        }
        .overlay {
            if showTutorial {
                TutorialOverlayView(mode: .split) {
                    showTutorial = false
                    persistence.markTutorialSeen(TutorialOverlayView.Mode.split.rawValue)
                }
            }
        }
    }

    private var hud: some View {
        VStack {
            if attemptActive {
                Text(attemptState.phase == .armed ? "Raise the glass…" : "Drinking…")
                    .font(.headline)
                    .foregroundStyle(.white.opacity(0.8))
                    .padding(.top, 12)
                    .accessibilityHidden(true) // the player can't see this anyway
            }
            Spacer()
            if !attemptActive {
                VStack(spacing: 14) {
                    Text("Tip the phone like a glass. Set it back down when you think the line is on the G. You won't see the screen — listen and feel.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)

                    Toggle(isOn: $useTouchFallback) {
                        Text("Touch control (drag instead of tilt)")
                            .font(.footnote)
                    }
                    .padding(.horizontal, 40)
                    .toggleStyle(.switch)

                    Button(action: start) {
                        Text("Start attempt")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 0.85, green: 0.72, blue: 0.35))
                    .padding(.horizontal, 40)
                    .accessibilityHint("Calibrates the phone and starts a blind sip attempt")
                }
                .padding(.bottom, 30)
            } else {
                Button("Give up", role: .destructive) {
                    scene.cancelAttempt()
                }
                .padding(.bottom, 30)
            }
        }
    }

    private func configure() {
        services.startForGameplay()
        services.applySettings(from: persistence.records)
        scene.motion = services.motion
        scene.audio = services.audio
        scene.haptics = services.haptics
        scene.replay = services.replay

        // Reduce Motion prefers the drag fallback and says so up front.
        if reduceMotion || !services.motion.isAvailable {
            useTouchFallback = true
        }

        scene.onStateChange = { state in
            attemptState = state
        }
        scene.onScored = { scored in
            attemptActive = false
            result = scored
            persistence.record(split: scored)
            announce(result: scored)
        }
        if !persistence.records.tutorialsSeen.contains(TutorialOverlayView.Mode.split.rawValue) {
            showTutorial = true
        }
    }

    private func start() {
        scene.usesTouchFallback = useTouchFallback
        attemptActive = true
        scene.startAttempt()
    }

    private func announce(result: SplitResult) {
        let text: String
        switch result.grade {
        case .perfectSplit: text = "Perfect split! \(Self.formattedMM(result.deltaMM)) from center."
        case .cleanSplit: text = "Clean split, \(Self.formattedMM(result.deltaMM)) from center."
        case .onTheG: text = "On the G, \(Self.formattedMM(result.deltaMM)) off center."
        case .shy: text = "Too shy — the line stopped above the G."
        case .sunk: text = "Sunk it — the line went below the G."
        case .noAttempt: text = "No attempt registered. Try one smooth sip."
        }
        AccessibilityNotification.Announcement(text).post()
    }

    static func formattedMM(_ value: Double) -> String {
        String(format: "%.1f mm", abs(value))
    }
}

extension SplitResult: Identifiable {
    // Results are sheet-presented; date+delta is unique enough for identity.
    var id: String { "\(date.timeIntervalSince1970)-\(deltaMM)" }
}
