import SwiftUI

/// Local pass-and-play leaderboard. Assisted (touch-fallback) runs carry a
/// badge rather than being excluded — friends on the sofa still count.
struct LeaderboardView: View {
    @EnvironmentObject private var persistence: PersistenceService
    @State private var mode: LeaderboardEntry.Mode = .split

    var body: some View {
        VStack(spacing: 0) {
            Picker("Mode", selection: $mode) {
                Text("Split").tag(LeaderboardEntry.Mode.split)
                Text("Pour").tag(LeaderboardEntry.Mode.pour)
                Text("Rush").tag(LeaderboardEntry.Mode.rush)
            }
            .pickerStyle(.segmented)
            .padding()

            if entries.isEmpty {
                ContentUnavailableView(
                    "No entries yet",
                    systemImage: "trophy",
                    description: Text("Finish a round and save your initials from the results card.")
                )
                Spacer()
            } else {
                List {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        HStack(spacing: 14) {
                            Text("\(index + 1)")
                                .font(.headline.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 30, alignment: .trailing)
                            Text(entry.initials)
                                .font(.system(.headline, design: .monospaced))
                            if entry.assisted {
                                Image(systemName: "hand.draw")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .accessibilityLabel("Touch-assisted")
                            }
                            Spacer()
                            Text(entry.displayValue)
                                .font(.headline.monospacedDigit())
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .navigationTitle("Leaderboard")
        .background(Color(red: 0.08, green: 0.07, blue: 0.09).ignoresSafeArea())
    }

    private var entries: [LeaderboardEntry] {
        persistence.records.leaderboard
            .filter { $0.mode == mode }
            .sorted { $0.value > $1.value }
    }
}
