import SwiftUI

/// Plays the last Mode 2 attempt back at quarter speed with a measurement line
/// showing exactly where the sip ended relative to the G.
struct ReplayView: View {
    @ObservedObject var replay: ReplayService
    @State private var startDate = Date.now

    private let playbackSpeed = 0.25

    var body: some View {
        Group {
            if let recorded = replay.lastReplay {
                TimelineView(.animation) { context in
                    let elapsed = context.date.timeIntervalSince(startDate) * playbackSpeed
                    let time = recorded.duration > 0
                        ? elapsed.truncatingRemainder(dividingBy: recorded.duration + 1.0)
                        : 0
                    replayCanvas(recorded: recorded, time: min(time, recorded.duration))
                }
            } else {
                ContentUnavailableView(
                    "No replay yet",
                    systemImage: "film",
                    description: Text("Finish a Split the G attempt first.")
                )
            }
        }
        .navigationTitle("Replay · ¼ speed")
        .navigationBarTitleDisplayMode(.inline)
        .background(Color(red: 0.08, green: 0.07, blue: 0.09).ignoresSafeArea())
        .onAppear { startDate = .now }
    }

    private func replayCanvas(recorded: ReplayService.Replay, time: TimeInterval) -> some View {
        Canvas { context, size in
            let glassWidth = size.width * 0.42
            let glassHeight = size.height * 0.62
            let glassRect = CGRect(
                x: (size.width - glassWidth) / 2,
                y: (size.height - glassHeight) / 2,
                width: glassWidth,
                height: glassHeight
            )

            func y(forFraction fraction: Double) -> CGFloat {
                glassRect.maxY - glassRect.height * CGFloat(fraction)
            }

            // Glass outline.
            context.stroke(
                Path(roundedRect: glassRect, cornerRadius: 6),
                with: .color(.white.opacity(0.85)),
                lineWidth: 3
            )

            // G band.
            let bandRect = CGRect(
                x: glassRect.minX,
                y: y(forFraction: GlassGeometry.gBandTopFraction),
                width: glassRect.width,
                height: glassRect.height * CGFloat(GlassGeometry.gHeightFraction)
            )
            context.fill(
                Path(bandRect),
                with: .color(Color(red: 0.85, green: 0.72, blue: 0.35).opacity(0.3))
            )

            // Liquid at this playback moment.
            let level = replay.level(at: time) ?? 1.0
            let liquidRect = CGRect(
                x: glassRect.minX,
                y: y(forFraction: level),
                width: glassRect.width,
                height: glassRect.height * CGFloat(level)
            )
            context.fill(
                Path(liquidRect),
                with: .color(Color(red: 0.075, green: 0.055, blue: 0.045))
            )

            // Horizontal measurement line through the liquid surface, with the
            // live delta from the G center in millimetres.
            let lineY = y(forFraction: level)
            var line = Path()
            line.move(to: CGPoint(x: glassRect.minX - 24, y: lineY))
            line.addLine(to: CGPoint(x: glassRect.maxX + 24, y: lineY))
            context.stroke(line, with: .color(.red), lineWidth: 1.5)

            let deltaMM = GlassGeometry.millimetres(
                fromFraction: level - GlassGeometry.gCenterFraction
            )
            let label = Text(String(format: "%+.1f mm", deltaMM))
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(.red)
            context.draw(
                label,
                at: CGPoint(x: glassRect.maxX + 30, y: lineY),
                anchor: .leading
            )

            // Center-of-G reference line.
            let centerY = y(forFraction: GlassGeometry.gCenterFraction)
            var centerLine = Path()
            centerLine.move(to: CGPoint(x: glassRect.minX - 24, y: centerY))
            centerLine.addLine(to: CGPoint(x: glassRect.maxX + 24, y: centerY))
            context.stroke(
                centerLine,
                with: .color(Color(red: 0.85, green: 0.72, blue: 0.35)),
                style: StrokeStyle(lineWidth: 1, dash: [4, 4])
            )
        }
        .accessibilityLabel("Replay of the last attempt at quarter speed")
    }
}
