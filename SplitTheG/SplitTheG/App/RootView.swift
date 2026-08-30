import SwiftUI

/// Home screen: three mode cards, stats, settings. Also the age gate's host —
/// nothing is playable until the player confirms they're of age.
struct RootView: View {
    @EnvironmentObject private var persistence: PersistenceService
    @State private var showPersistenceWarning = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    header

                    modeCard(
                        title: "The Perfect Pour",
                        subtitle: "Two parts. 45 degrees. Patience.",
                        systemImage: "hourglass"
                    ) { PourModeView() }

                    modeCard(
                        title: "Split the G",
                        subtitle: "One sip, blind. Land the line on the G.",
                        systemImage: "scope"
                    ) { SplitModeView() }

                    modeCard(
                        title: "The Rush",
                        subtitle: "Last orders. Keep the queue happy.",
                        systemImage: "person.3.fill"
                    ) { RushModeView() }

                    HStack(spacing: 16) {
                        smallLink(title: "Stats", systemImage: "chart.bar.fill") {
                            StatsView()
                        }
                        smallLink(title: "Leaderboard", systemImage: "trophy.fill") {
                            LeaderboardView()
                        }
                        smallLink(title: "Settings", systemImage: "gearshape.fill") {
                            SettingsView()
                        }
                    }

                    #if DEBUG
                    NavigationLink("Balance Tuner (debug)") { BalanceTunerView() }
                        .font(.footnote)
                        .padding(.top, 8)
                    #endif
                }
                .padding()
            }
            .background(Color(red: 0.08, green: 0.07, blue: 0.09).ignoresSafeArea())
            .navigationTitle("")
            .toolbar(.hidden, for: .navigationBar)
        }
        .fullScreenCover(isPresented: .constant(!persistence.records.ageVerified)) {
            AgeGateView()
        }
        .onReceive(persistence.$lastError.compactMap { $0 }) { _ in
            showPersistenceWarning = true
        }
        .alert("Records", isPresented: $showPersistenceWarning) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(persistence.lastError ?? "")
        }
    }

    private var header: some View {
        VStack(spacing: 4) {
            Text("GRIFFIN'S")
                .font(.system(.title3, design: .serif).weight(.semibold))
                .foregroundStyle(Color(red: 0.85, green: 0.72, blue: 0.35))
                .kerning(4)
            Text("Split the G")
                .font(.system(size: 40, design: .serif).weight(.bold))
                .foregroundStyle(.white)
            Text("The craft of the pour")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 20)
        .accessibilityElement(children: .combine)
    }

    private func modeCard<Destination: View>(
        title: String,
        subtitle: String,
        systemImage: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 16) {
                Image(systemName: systemImage)
                    .font(.title)
                    .foregroundStyle(Color(red: 0.85, green: 0.72, blue: 0.35))
                    .frame(width: 52)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.white)
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(.tertiary)
            }
            .padding()
            .frame(minHeight: 88)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
        .accessibilityLabel("\(title). \(subtitle)")
    }

    private func smallLink<Destination: View>(
        title: String,
        systemImage: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(.white)
        }
        .accessibilityLabel(title)
    }
}
