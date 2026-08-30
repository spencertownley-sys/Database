import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var persistence: PersistenceService
    @EnvironmentObject private var services: GameServices

    var body: some View {
        List {
            Section("Feedback") {
                Toggle("Sound", isOn: audioBinding)
                Toggle("Haptics", isOn: hapticsBinding)
                Text("Split the G is played blind — sound and haptics are the game. Turn them off only if you must.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("About") {
                LabeledContent("Brand", value: "Griffin's Extra Stout")
                LabeledContent("Data", value: "Stays on this phone")
                Text("This app makes no network requests and collects nothing. Records live in local storage only.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .scrollContentBackground(.hidden)
        .background(Color(red: 0.08, green: 0.07, blue: 0.09).ignoresSafeArea())
    }

    private var audioBinding: Binding<Bool> {
        Binding(
            get: { persistence.records.audioEnabled },
            set: { enabled in
                persistence.records.audioEnabled = enabled
                services.audio.isEnabled = enabled
                persistence.save()
            }
        )
    }

    private var hapticsBinding: Binding<Bool> {
        Binding(
            get: { persistence.records.hapticsEnabled },
            set: { enabled in
                persistence.records.hapticsEnabled = enabled
                services.haptics.isEnabled = enabled
                persistence.save()
            }
        )
    }
}
