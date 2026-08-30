import SwiftUI

@main
struct SplitTheGApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var orientationLock = OrientationLock.shared
    @StateObject private var persistence = PersistenceService()
    @StateObject private var services = GameServices()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(orientationLock)
                .environmentObject(persistence)
                .environmentObject(services)
                .onAppear {
                    services.applySettings(from: persistence.records)
                }
                .preferredColorScheme(.dark)
        }
    }
}
