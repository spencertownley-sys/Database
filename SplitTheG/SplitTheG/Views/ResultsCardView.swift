import SwiftUI

/// Shared results card for all three modes: grade, numbers, one plain-language
/// critique, share image, and the local leaderboard save.
struct ResultsCardView: View {
    enum Payload {
        case split(SplitResult)
        case pour(PourScore)
        case rush(RushState)
    }

    let payload: Payload
    let onDismiss: () -> Void

    @EnvironmentObject private var persistence: PersistenceService
    @EnvironmentObject private var services: GameServices
    @State private var initials = ""
    @State private var savedToBoard = false

    var body: some View {
        VStack(spacing: 18) {
            card
            shareButton
            leaderboardRow
            replayLink
            Button("Done") { onDismiss() }
                .font(.headline)
                .frame(minHeight: 44)
        }
        .padding()
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Card body

    private var card: some View {
        VStack(spacing: 12) {
            switch payload {
            case .split(let result): splitBody(result)
            case .pour(let score): pourBody(score)
            case .rush(let state): rushBody(state)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(
            Color(red: 0.12, green: 0.10, blue: 0.12),
            in: RoundedRectangle(cornerRadius: 20)
        )
    }

    @ViewBuilder
    private func splitBody(_ result: SplitResult) -> some View {
        Text(Self.title(for: result.grade))
            .font(.system(.largeTitle, design: .serif).weight(.bold))
            .foregroundStyle(Color(red: 0.85, green: 0.72, blue: 0.35))
        if result.grade != .noAttempt {
            Text("\(SplitModeView.formattedMM(result.deltaMM)) from dead center")
                .font(.title3)
                .foregroundStyle(.white)
            Text(result.deltaMM >= 0 ? "Stopped high" : "Stopped low")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        Text(Self.critique(for: result))
            .font(.callout)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        if result.assisted {
            Label("Touch-assisted attempt", systemImage: "hand.draw")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func pourBody(_ score: PourScore) -> some View {
        Text(Self.title(for: score.grade))
            .font(.system(.largeTitle, design: .serif).weight(.bold))
            .foregroundStyle(Color(red: 0.85, green: 0.72, blue: 0.35))
        Text("\(Int(score.total.rounded())) / 100")
            .font(.title2.monospacedDigit())
            .foregroundStyle(.white)

        VStack(spacing: 6) {
            componentRow("Part-one fill", score.partOneFill)
            componentRow("Pour angle", score.angle)
            componentRow("Settle patience", score.settle)
            componentRow("Head", score.head)
            componentRow("Timing", score.timing)
        }
        .padding(.vertical, 6)

        Text(Self.critique(for: score))
            .font(.callout)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
    }

    @ViewBuilder
    private func rushBody(_ state: RushState) -> some View {
        Text("Last Orders")
            .font(.system(.largeTitle, design: .serif).weight(.bold))
            .foregroundStyle(Color(red: 0.85, green: 0.72, blue: 0.35))
        Text("\(state.score) points")
            .font(.title2.monospacedDigit())
            .foregroundStyle(.white)
        HStack(spacing: 22) {
            summaryStat("Waves", "\(state.wave + 1)")
            summaryStat("Served", "\(state.servedCount)")
            summaryStat("Spills", "\(state.spillCount)")
        }
    }

    private func componentRow(_ label: String, _ value: Double) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            ProgressView(value: value)
                .frame(width: 110)
                .tint(Color(red: 0.85, green: 0.72, blue: 0.35))
            Text("\(Int((value * 100).rounded()))")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.white)
                .frame(width: 34, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(Int((value * 100).rounded())) out of 100")
    }

    private func summaryStat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline.monospacedDigit()).foregroundStyle(.white)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }

    // MARK: - Actions

    private var shareButton: some View {
        ShareLink(
            item: renderShareImage(),
            preview: SharePreview("Split the G result", image: renderShareImage())
        ) {
            Label("Share result", systemImage: "square.and.arrow.up")
                .frame(minHeight: 44)
        }
    }

    @ViewBuilder
    private var replayLink: some View {
        if case .split = payload, services.replay.lastReplay != nil {
            NavigationLink("Watch the replay") {
                ReplayView(replay: services.replay)
            }
            .frame(minHeight: 44)
        }
    }

    private var leaderboardRow: some View {
        HStack {
            TextField("AAA", text: $initials)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .frame(width: 76)
                .textFieldStyle(.roundedBorder)
                .onChange(of: initials) { _, new in
                    initials = String(new.prefix(3)).uppercased()
                }
                .accessibilityLabel("Leaderboard initials, three letters")
            Button(savedToBoard ? "Saved" : "Save to leaderboard") {
                saveToLeaderboard()
            }
            .disabled(initials.count != 3 || savedToBoard || !payloadQualifies)
            .frame(minHeight: 44)
        }
    }

    private var payloadQualifies: Bool {
        if case .split(let result) = payload { return result.grade != .noAttempt }
        return true
    }

    private func saveToLeaderboard() {
        let entry: LeaderboardEntry
        switch payload {
        case .split(let result):
            entry = LeaderboardEntry(
                initials: initials,
                mode: .split,
                // Closer splits rank higher.
                value: -abs(result.deltaMM),
                displayValue: SplitModeView.formattedMM(result.deltaMM),
                assisted: result.assisted
            )
        case .pour(let score):
            entry = LeaderboardEntry(
                initials: initials,
                mode: .pour,
                value: score.total,
                displayValue: "\(Int(score.total.rounded()))",
                assisted: false
            )
        case .rush(let state):
            entry = LeaderboardEntry(
                initials: initials,
                mode: .rush,
                value: Double(state.score),
                displayValue: "\(state.score)",
                assisted: false
            )
        }
        persistence.addLeaderboardEntry(entry)
        savedToBoard = true
    }

    @MainActor
    private func renderShareImage() -> Image {
        let renderer = ImageRenderer(content: card.frame(width: 360).padding())
        renderer.scale = 3
        if let image = renderer.uiImage {
            return Image(uiImage: image)
        }
        return Image(systemName: "photo")
    }

    // MARK: - Copy

    static func title(for grade: SplitGrade) -> String {
        switch grade {
        case .perfectSplit: return "PERFECT SPLIT"
        case .cleanSplit: return "Clean Split"
        case .onTheG: return "On the G"
        case .shy: return "Shy"
        case .sunk: return "Sunk"
        case .noAttempt: return "No Attempt"
        }
    }

    static func title(for grade: PourGrade) -> String {
        switch grade {
        case .masterPour: return "MASTER POUR"
        case .solid: return "Solid Pint"
        case .decent: return "Decent Effort"
        case .sloppy: return "Bit Sloppy"
        case .disaster: return "Start Again"
        }
    }

    static func critique(for result: SplitResult) -> String {
        switch result.grade {
        case .perfectSplit: return "That's the one. Frame it."
        case .cleanSplit: return "A hair off. One steadier set-down and it's perfect."
        case .onTheG: return "You found the letter — now find its middle."
        case .shy: return "You bailed early. Commit to the sip a beat longer."
        case .sunk: return "Greedy. Ease off the tilt sooner next time."
        case .noAttempt: return "One smooth tip and one smooth return — no shakes."
        }
    }

    /// One plain-language line derived from the lowest-scoring component.
    static func critique(for score: PourScore) -> String {
        if score.spilled { return "It's on the floor. Watch the rim on the top-off." }
        switch score.lowestComponent {
        case .partOneFill:
            return "Part one is the foundation — ease off right at the griffin."
        case .angle:
            return "Keep the glass at 45 degrees until the griffin, then straighten."
        case .settle:
            return score.earlyTopOff
                ? "You poured through the surge. Let it settle fully next time."
                : "Time your top-off closer to the settle."
        case .head:
            return "The head wants to sit proud at the rim — about 15 millimetres."
        case .timing:
            return "A good pint doesn't take all night. Tighten it up."
        }
    }
}
