#if DEBUG
import SwiftUI

/// Live tuner for the feel-critical rates, plus a read-only dump of every
/// Balance constant. DEBUG builds only — compiled out of Release entirely.
struct BalanceTunerView: View {
    @State private var drainMultiplier = Balance.debugDrainMultiplier
    @State private var flowMultiplier = Balance.debugFlowMultiplier

    var body: some View {
        List {
            Section("Live multipliers (this launch only)") {
                VStack(alignment: .leading) {
                    Text(String(format: "Split drain × %.2f", drainMultiplier))
                    Slider(value: $drainMultiplier, in: 0.25...2.0, step: 0.05)
                        .onChange(of: drainMultiplier) { _, new in
                            Balance.debugDrainMultiplier = new
                        }
                }
                VStack(alignment: .leading) {
                    Text(String(format: "Pour flow × %.2f", flowMultiplier))
                    Slider(value: $flowMultiplier, in: 0.25...2.0, step: 0.05)
                        .onChange(of: flowMultiplier) { _, new in
                            Balance.debugFlowMultiplier = new
                        }
                }
                Button("Reset") {
                    drainMultiplier = 1.0
                    flowMultiplier = 1.0
                    Balance.debugDrainMultiplier = 1.0
                    Balance.debugFlowMultiplier = 1.0
                }
            }

            Section("Constants (edit Balance.swift to change)") {
                constantRow("cascadeSettleDuration", Balance.cascadeSettleDuration)
                constantRow("cascadeTopOffGraceWindow", Balance.cascadeTopOffGraceWindow)
                constantRow("baseFlowPerSecond", Balance.baseFlowPerSecond)
                constantRow("topOffFlowMultiplier", Balance.topOffFlowMultiplier)
                constantRow("pourThresholdDegrees", Balance.pourThresholdDegrees)
                constantRow("maxTiltDegrees", Balance.maxTiltDegrees)
                constantRow("maxDrainPerSecond", Balance.maxDrainPerSecond)
                constantRow("drainExponent", Balance.drainExponent)
                constantRow("minAttemptDuration", Balance.minAttemptDuration)
                constantRow("minPeakTiltDegrees", Balance.minPeakTiltDegrees)
                constantRow("targetAngleDegrees", Balance.targetAngleDegrees)
                constantRow("pourParTime", Balance.pourParTime)
                constantRow("rushBaseSpawnInterval", Balance.rushBaseSpawnInterval)
                constantRow("rushBasePatience", Balance.rushBasePatience)
            }

            Section {
                NavigationLink("Motion trace recorder") { MotionTraceRecorderView() }
            }
        }
        .navigationTitle("Balance Tuner")
    }

    private func constantRow(_ name: String, _ value: Double) -> some View {
        LabeledContent(name, value: String(format: "%.3g", value))
            .font(.system(.footnote, design: .monospaced))
    }
}
#endif
