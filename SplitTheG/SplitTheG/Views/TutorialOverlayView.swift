import SwiftUI

/// One-time, skippable ~30-second interactive tutorial per mode: three short
/// pages the player taps through before their first round.
struct TutorialOverlayView: View {
    enum Mode: String {
        case pour, split, rush

        var pages: [(symbol: String, title: String, text: String)] {
            switch self {
            case .pour:
                return [
                    ("angle", "Hold 45°", "Tilt the phone like the glass. Keep it at 45 degrees while you hold the tap."),
                    ("hourglass", "Two parts", "Ease off at the griffin line, then let the surge settle. Don't touch the tap while it storms."),
                    ("drop.fill", "Top it off", "When it's still, pour gently to the rim. The head should sit about 15 mm proud."),
                ]
            case .split:
                return [
                    ("iphone.gen3", "Raise it blind", "Lift the phone to your lips like a pint. You won't see the screen — that's the point."),
                    ("waveform", "Listen and feel", "The flow hums and buzzes as it drains. Ticks mark each level, a thump means you've reached the G."),
                    ("scope", "Set it down", "Tip back level to stop. Land the liquid line dead on the middle of the G."),
                ]
            case .rush:
                return [
                    ("person.3.fill", "They keep coming", "Customers queue with orders and patience meters. Three walkouts and the shift's over."),
                    ("hand.tap.fill", "Hold to pour", "Hold a tap to fill its glass. Watch the order card for the target line."),
                    ("arrow.up", "Flick to serve", "Flick the glass up at a customer to serve. Accuracy builds your combo."),
                ]
            }
        }
    }

    let mode: Mode
    let onFinish: () -> Void

    @State private var page = 0

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            let current = mode.pages[page]
            Image(systemName: current.symbol)
                .font(.system(size: 56))
                .foregroundStyle(Color(red: 0.85, green: 0.72, blue: 0.35))
                .accessibilityHidden(true)
            Text(current.title)
                .font(.title2.weight(.bold))
                .foregroundStyle(.white)
            Text(current.text)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 36)
            Spacer()

            HStack(spacing: 6) {
                ForEach(0..<mode.pages.count, id: \.self) { index in
                    Circle()
                        .fill(index == page ? Color.white : Color.white.opacity(0.3))
                        .frame(width: 7, height: 7)
                }
            }
            .accessibilityHidden(true)

            Button {
                if page < mode.pages.count - 1 {
                    page += 1
                } else {
                    onFinish()
                }
            } label: {
                Text(page < mode.pages.count - 1 ? "Next" : "Let's pour")
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.85, green: 0.72, blue: 0.35))
            .padding(.horizontal, 40)

            Button("Skip") { onFinish() }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(minHeight: 44)
                .padding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black.opacity(0.92))
        .transition(.opacity)
    }
}
