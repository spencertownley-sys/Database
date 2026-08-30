import SwiftUI
import UIKit

/// Per-screen orientation control, the supported way: `AppDelegate` reads
/// `mask` from here in `supportedInterfaceOrientationsFor`, and screens ask for
/// what they need on entry/exit. No deprecated `UIDevice` key-value hacks.
final class OrientationLock: ObservableObject {
    static let shared = OrientationLock()

    @Published private(set) var mask: UIInterfaceOrientationMask = .portrait

    func set(_ newMask: UIInterfaceOrientationMask) {
        guard mask != newMask else { return }
        mask = newMask

        // Ask the scene to rotate now rather than waiting for the next natural
        // rotation event.
        let scenes = UIApplication.shared.connectedScenes
        guard let windowScene = scenes.first as? UIWindowScene else { return }
        windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: newMask))
        windowScene.keyWindow?.rootViewController?
            .setNeedsUpdateOfSupportedInterfaceOrientations()
    }
}
