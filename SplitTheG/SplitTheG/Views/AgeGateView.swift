import SwiftUI

/// First-launch age gate. The app is about the craft of a pour, not drinking —
/// but it depicts a stout, so it asks once and stores the answer locally.
struct AgeGateView: View {
    @EnvironmentObject private var persistence: PersistenceService
    @State private var declined = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("G")
                .font(.system(size: 96, design: .serif).weight(.bold))
                .foregroundStyle(Color(red: 0.85, green: 0.72, blue: 0.35))
            Text("Split the G depicts a stout being poured. It contains no drinking games and tracks nothing — but it's for adults.")
                .font(.body)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            if declined {
                Text("Come back when you're of age. The G will wait.")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .padding(.top, 12)
            } else {
                VStack(spacing: 12) {
                    Button {
                        persistence.setAgeVerified()
                    } label: {
                        Text("I'm of legal drinking age")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(red: 0.85, green: 0.72, blue: 0.35))

                    Button("Not yet") { declined = true }
                        .frame(minHeight: 44)
                }
                .padding(.horizontal, 40)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.08, green: 0.07, blue: 0.09).ignoresSafeArea())
        .interactiveDismissDisabled()
    }
}
