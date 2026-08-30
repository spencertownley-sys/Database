import SwiftUI
import SpriteKit

/// Mode 3 host. Landscape-locked while on screen; portrait restored on exit.
struct RushModeView: View {
    @EnvironmentObject private var persistence: PersistenceService
    @EnvironmentObject private var services: GameServices
    @EnvironmentObject private var orientationLock: OrientationLock

    @State private var scene = RushScene(size: CGSize(width: 844, height: 390))
    @State private var runState = RushState()
    @State private var finalState: RushState?
    @State private var runActive = false
    @State private var tapCount = 3
    @State private var showTutorial = false

    var body: some View {
        ZStack {
            SpriteView(scene: scene)
                .ignoresSafeArea()
            hud
        }
        .navigationTitle("The Rush")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            orientationLock.set(.landscape)
            configure()
        }
        .onDisappear {
            orientationLock.set(.portrait)
            services.stopAfterGameplay()
        }
        .sheet(item: $finalState) { finished in
            ResultsCardView(payload: .rush(finished)) {
                finalState = nil
                runActive = false
            }
            .environmentObject(persistence)
            .environmentObject(services)
        }
        .overlay {
            if showTutorial {
                TutorialOverlayView(mode: .rush) {
                    showTutorial = false
                    persistence.markTutorialSeen(TutorialOverlayView.Mode.rush.rawValue)
                }
            }
        }
    }

    private var hud: some View {
        VStack {
            if runActive {
                HStack(spacing: 18) {
                    statChip("Score", "\(runState.score)")
                    statChip("Wave", "\(runState.wave + 1)")
                    statChip("Combo", String(format: "×%.2f", runState.comboMultiplier))
                    statChip(
                        "Walkouts",
                        "\(runState.walkouts)/\(Balance.rushMaxWalkouts)"
                    )
                }
                .padding(.top, 4)
            }
            Spacer()
            if !runActive {
                VStack(spacing: 14) {
                    Picker("Taps", selection: $tapCount) {
                        ForEach(3...5, id: \.self) { count in
                            Text("\(count) taps").tag(count)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 320)

                    Button(action: start) {
                        Text("Open the bar")
                            .font(.headline)
                            .frame(maxWidth: 320, minHeight: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 0.85, green: 0.72, blue: 0.35))
                    .accessibilityHint("Starts a rush shift. Hold a tap to fill, flick up to serve.")
                }
                .padding(.bottom, 24)
            }
        }
    }

    private func statChip(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline.monospacedDigit()).foregroundStyle(.white)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.black.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }

    private func configure() {
        services.startForGameplay()
        services.applySettings(from: persistence.records)
        scene.audio = services.audio
        scene.haptics = services.haptics
        scene.onStateChange = { state in
            runState = state
        }
        scene.onGameOver = { finished in
            finalState = finished
            persistence.record(rushScore: finished.score, wave: finished.wave)
            AccessibilityNotification.Announcement(
                "Last orders. Final score \(finished.score)."
            ).post()
        }
        if !persistence.records.tutorialsSeen.contains(TutorialOverlayView.Mode.rush.rawValue) {
            showTutorial = true
        }
    }

    private func start() {
        runActive = true
        scene.startRun(stationCount: tapCount)
    }
}

extension RushState: Identifiable {
    var id: String { "\(elapsedSeconds)-\(score)" }
}
