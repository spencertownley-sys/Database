#if DEBUG
import SwiftUI
import Combine

/// Records live motion samples to a JSON file in Documents, in the exact format
/// the test fixtures consume (`[[t, tiltRadians, angularVelocity], …]`).
/// Record a real attempt on hardware, then copy the file into
/// `SplitTheGTests/Fixtures/motion-traces/` via the Files app or Finder.
final class MotionTraceRecorder: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var sampleCount = 0
    @Published private(set) var lastSavedURL: URL?

    private var samples: [[Double]] = []
    private var startTime: Date?
    private var timer: AnyCancellable?
    private let motion: MotionService

    init(motion: MotionService = MotionService()) {
        self.motion = motion
    }

    func start() {
        motion.start()
        motion.calibrate()
        samples = []
        sampleCount = 0
        startTime = .now
        isRecording = true
        timer = Timer.publish(every: 1.0 / Balance.motionUpdateHz, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in self?.sample() }
    }

    func stopAndSave(named name: String) {
        timer?.cancel()
        timer = nil
        isRecording = false
        motion.stop()

        let payload: [String: Any] = [
            "sampleRateHz": Balance.motionUpdateHz,
            "samples": samples,
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let documents = FileManager.default.urls(
                for: .documentDirectory, in: .userDomainMask
            ).first
        else { return }
        let url = documents.appendingPathComponent("\(name).json")
        try? data.write(to: url, options: [.atomic])
        lastSavedURL = url
    }

    private func sample() {
        guard let startTime else { return }
        samples.append([
            Date.now.timeIntervalSince(startTime),
            motion.tiltRadians,
            motion.angularVelocity,
        ])
        sampleCount = samples.count
    }
}

struct MotionTraceRecorderView: View {
    @StateObject private var recorder = MotionTraceRecorder()
    @State private var traceName = "trace"

    var body: some View {
        List {
            TextField("Trace name", text: $traceName)
            if recorder.isRecording {
                LabeledContent("Samples", value: "\(recorder.sampleCount)")
                Button("Stop & save") { recorder.stopAndSave(named: traceName) }
            } else {
                Button("Start recording") { recorder.start() }
            }
            if let url = recorder.lastSavedURL {
                Text("Saved to \(url.lastPathComponent) in Documents — pull it via the Files app.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Trace Recorder")
    }
}
#endif
