import SwiftUI

/// Local records: bests, attempt counts, split-grade histogram.
struct StatsView: View {
    @EnvironmentObject private var persistence: PersistenceService

    var body: some View {
        List {
            if isEmpty {
                ContentUnavailableView(
                    "Nothing on the slate yet",
                    systemImage: "chart.bar",
                    description: Text("Play any mode and your records land here.")
                )
                .listRowBackground(Color.clear)
            } else {
                bestsSection
                histogramSection
            }
        }
        .navigationTitle("Stats")
        .scrollContentBackground(.hidden)
        .background(Color(red: 0.08, green: 0.07, blue: 0.09).ignoresSafeArea())
    }

    private var isEmpty: Bool {
        let records = persistence.records
        return records.splitAttemptCount == 0
            && records.pourAttemptCount == 0
            && records.rushRunCount == 0
    }

    private var bestsSection: some View {
        Section("Bests") {
            if let best = persistence.records.bestSplit {
                row(
                    "Closest split",
                    "\(SplitModeView.formattedMM(best.deltaMM)) · \(ResultsCardView.title(for: best.grade))"
                )
            }
            if let best = persistence.records.bestPour {
                row("Best pour", "\(Int(best.total.rounded())) / 100")
            }
            if persistence.records.bestRushScore > 0 {
                row(
                    "Best rush",
                    "\(persistence.records.bestRushScore) pts · wave \(persistence.records.bestRushWave + 1)"
                )
            }
            row("Split attempts", "\(persistence.records.splitAttemptCount)")
            row("Pints poured", "\(persistence.records.pourAttemptCount)")
            row("Rush shifts", "\(persistence.records.rushRunCount)")
        }
    }

    private var histogramSection: some View {
        Section("Split grades") {
            let counts = persistence.records.splitGradeCounts
            let maxCount = max(counts.values.max() ?? 1, 1)
            ForEach(SplitGrade.allCases, id: \.rawValue) { grade in
                let count = counts[grade.rawValue] ?? 0
                HStack {
                    Text(ResultsCardView.title(for: grade))
                        .font(.subheadline)
                        .frame(width: 120, alignment: .leading)
                    GeometryReader { proxy in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(red: 0.85, green: 0.72, blue: 0.35))
                            .frame(
                                width: max(
                                    count > 0 ? 6 : 0,
                                    proxy.size.width * CGFloat(count) / CGFloat(maxCount)
                                )
                            )
                    }
                    .frame(height: 14)
                    Text("\(count)")
                        .font(.subheadline.monospacedDigit())
                        .frame(width: 40, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(ResultsCardView.title(for: grade)): \(count) attempts")
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}
