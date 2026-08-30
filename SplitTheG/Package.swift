// swift-tools-version:5.9
//
// This manifest exists ONLY to compile and test the pure game engines
// (Config/ + Engines/) on any platform with a Swift toolchain — CI boxes,
// Linux, whatever. The shipping app builds from SplitTheG.xcodeproj; the
// SpriteKit/SwiftUI layers are deliberately outside this package.
import PackageDescription

let package = Package(
    name: "SplitTheG",
    targets: [
        .target(
            name: "SplitTheG",
            path: "SplitTheG",
            sources: ["Config", "Engines"]
        ),
        .testTarget(
            name: "SplitTheGTests",
            dependencies: ["SplitTheG"],
            path: "SplitTheGTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
