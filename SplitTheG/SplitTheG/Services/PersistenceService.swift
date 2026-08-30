import Foundation

/// Atomic JSON persistence in Application Support. No CoreData, no SwiftData,
/// no network. Failures surface once via `lastError` (non-blocking banner);
/// the game keeps playing on in-memory records regardless.
final class PersistenceService: ObservableObject {
    @Published var records: PlayerRecords
    /// Set once when a load/save fails; the shell shows it and moves on.
    @Published private(set) var lastError: String?

    private let fileURL: URL
    private let backupURL: URL

    init(directory: URL? = nil) {
        let base = directory ?? Self.defaultDirectory()
        fileURL = base.appendingPathComponent("records.json")
        backupURL = base.appendingPathComponent("records.json.bak")
        records = PlayerRecords()
        records = load()
    }

    private static func defaultDirectory() -> URL {
        let support = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        )[0].appendingPathComponent("SplitTheG", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: support, withIntermediateDirectories: true
        )
        return support
    }

    // MARK: - Load

    private func load() -> PlayerRecords {
        if let loaded = decode(at: fileURL) { return loaded }
        // Main file missing or corrupt — fall back to the last good backup.
        if let backup = decode(at: backupURL) {
            lastError = "Records were restored from a backup."
            return backup
        }
        if FileManager.default.fileExists(atPath: fileURL.path) {
            lastError = "Saved records couldn't be read; starting fresh."
        }
        return PlayerRecords()
    }

    private func decode(at url: URL) -> PlayerRecords? {
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(PlayerRecords.self, from: data),
              decoded.schemaVersion <= PlayerRecords.currentSchemaVersion
        else { return nil }
        // Older schemas would migrate here; v1 is the first shipping schema.
        return decoded
    }

    // MARK: - Save

    func save() {
        do {
            var snapshot = records
            snapshot.schemaVersion = PlayerRecords.currentSchemaVersion
            let data = try JSONEncoder().encode(snapshot)
            // Keep the previous good file as the backup before replacing it.
            if FileManager.default.fileExists(atPath: fileURL.path) {
                _ = try? FileManager.default.replaceItemAt(
                    backupURL, withItemAt: fileURL,
                    backupItemName: nil, options: []
                )
            }
            try data.write(to: fileURL, options: [.atomic])
        } catch {
            if lastError == nil {
                lastError = "Couldn't save records — progress this session may be lost."
            }
        }
    }

    // MARK: - Mutation helpers

    func record(split result: SplitResult) {
        records.record(split: result)
        save()
    }

    func record(pour score: PourScore) {
        records.record(pour: score)
        save()
    }

    func record(rushScore: Int, wave: Int) {
        records.record(rushScore: rushScore, wave: wave)
        save()
    }

    func addLeaderboardEntry(_ entry: LeaderboardEntry) {
        records.leaderboard.append(entry)
        records.leaderboard.sort { $0.value > $1.value }
        save()
    }

    func markTutorialSeen(_ mode: String) {
        records.tutorialsSeen.insert(mode)
        save()
    }

    func setAgeVerified() {
        records.ageVerified = true
        save()
    }
}
