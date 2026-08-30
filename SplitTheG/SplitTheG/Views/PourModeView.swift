import SwiftUI
import SpriteKit

/// Mode 1 host: tilt the phone to angle the glass, hold the tap to pour.
struct PourModeView: View {
    enum Difficulty: String, CaseIterable, Identifiable {
        case easy = "Easy"
        case normal = "Normal"
        case hard = "Hard"
        var id: String { rawValue }

        /// Easy shows the emblem-line guide; Normal and Hard do not.
        var showsEmblemGuide: Bool { self == .easy }
    }

    @EnvironmentObject private var persistence: PersistenceService
    @EnvironmentObject private var services: GameServices

    @State private var scene = PourScene(size: CGSize(width: 390, height: 700))
    @State private var pourState = PourState()
    @State private var score: PourScore?
    @State private var pourActive = false
    @State private var difficulty: Difficulty = .easy
    @State private var showTutorial = false

    var body: some View {
        ZStack {
            SpriteView(scene: scene)
                .ignoresSafeArea()
            hud
        }
        .navigationTitle("The Perfect Pour")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: configure)
        .onDisappear { services.stopAfterGameplay() }
        .sheet(item: $score) { finished in
            ResultsCardView(payload: .pour(finished)) {
                score = nil
                pourActive = false
            }
            .environmentObject(persistence)
            .environmentObject(services)
        }
        .overlay {
            if showTutorial {
                TutorialOverlayView(mode: .pour) {
                    showTutorial = false
                    persistence.markTutorialSeen(TutorialOverlayView.Mode.pour.rawValue)
                }
            }
        }
    }

    private var hud: some View {
        VStack {
            if pourActive {
                phaseBanner
                    .padding(.top, 8)
            }
            Spacer()
            if !pourActive {
                VStack(spacing: 14) {
                    Picker("Difficulty", selection: $difficulty) {
                        ForEach(Difficulty.allCases) { level in
                            Text(level.rawValue).tag(level)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 40)

                    Button(action: start) {
                        Text("Pull a pint")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 0.85, green: 0.72, blue: 0.35))
                    .padding(.horizontal, 40)
                    .accessibilityHint("Starts a two-part pour. Hold the top half of the screen to pour.")
                }
                .padding(.bottom, 30)
            }
        }
    }

    private var phaseBanner: some View {
        let text: String
        switch pourState.phase {
        case .empty: text = "Hold the tap to pour"
        case .pouringPartOne: text = "Part one — ease off at the griffin"
        case .settling: text = "Let it settle…"
        case .readyForTopOff: text = "Ready — top it off"
        case .toppingOff: text = "Easy… stop at the rim"
        case .complete: text = "Done"
        }
        return Text(text)
            .font(.headline)
            .foregroundStyle(.white.opacity(0.85))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.black.opacity(0.4), in: Capsule())
            .accessibilityLabel(text)
    }

    private func configure() {
        services.startForGameplay()
        services.applySettings(from: persistence.records)
        scene.motion = services.motion
        scene.audio = services.audio
        scene.haptics = services.haptics
        scene.onStateChange = { state in
            pourState = state
        }
        scene.onComplete = { finished in
            score = finished
            persistence.record(pour: finished)
            AccessibilityNotification.Announcement(
                "Pour complete. \(Int(finished.total)) points."
            ).post()
        }
        if !persistence.records.tutorialsSeen.contains(TutorialOverlayView.Mode.pour.rawValue) {
            showTutorial = true
        }
    }

    private func start() {
        pourActive = true
        scene.startPour(difficulty: difficulty.showsEmblemGuide)
    }
}

extension PourScore: Identifiable {
    var id: String { "\(date.timeIntervalSince1970)-\(total)" }
}
