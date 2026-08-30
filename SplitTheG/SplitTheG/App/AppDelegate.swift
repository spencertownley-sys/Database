import UIKit

/// Exists solely to bridge per-screen orientation locking — SwiftUI has no
/// supported per-view API for it on iOS 17.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        OrientationLock.shared.mask
    }
}
