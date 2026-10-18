import Foundation
import AVFoundation
import Speech

@MainActor
final class SpeechRecognizer: ObservableObject {
    @Published var transcript = ""
    @Published var listening = false
    @Published var finished = false
    @Published var error: String?
    var silence: TimeInterval = 1.6
    var patience: TimeInterval = 8
    var hints: [String] = []
    private var lastChange = Date()
    private var started = Date()
    private var timer: Timer?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let engine = AVAudioEngine()

    static var available: Bool { SFSpeechRecognizer(locale: Locale(identifier: "en-US"))?.isAvailable ?? false }

    func start() {
        error = nil
        finished = false
        transcript = ""
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                guard status == .authorized else { self.error = "Speech recognition is not allowed. Enable it in Settings."; return }
                AVAudioApplication.requestRecordPermission { ok in
                    Task { @MainActor in
                        guard ok else { self.error = "Microphone access is off. Enable it in Settings."; return }
                        self.begin()
                    }
                }
            }
        }
    }

    private func begin() {
        guard let recognizer, recognizer.isAvailable else { error = "Speech recognition is not available right now."; return }
        stop()
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            self.error = "Could not open the microphone."
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.contextualStrings = Array(hints.prefix(100))
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { error = "No microphone input is available right now."; return }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
        engine.prepare()
        do { try engine.start() } catch { self.error = "Could not start listening."; return }
        listening = true
        started = Date()
        lastChange = started
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        task = recognizer.recognitionTask(with: req) { [weak self] result, err in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    let heard = result.bestTranscription.formattedString
                    if heard != self.transcript { self.transcript = heard; self.lastChange = Date() }
                    if result.isFinal, !heard.isEmpty { self.finished = true }
                }
                if err != nil || (result?.isFinal ?? false) { self.finish() }
            }
        }
    }

    private func tick() {
        guard listening else { return }
        let now = Date()
        if !transcript.isEmpty, now.timeIntervalSince(lastChange) > silence {
            finished = true
            stop()
        } else if transcript.isEmpty, now.timeIntervalSince(started) > patience {
            error = "I didn't hear anything. Tap the mic and try again."
            stop()
        }
    }

    func stop() {
        request?.endAudio()
        task?.cancel()
        finish()
    }

    private func finish() {
        timer?.invalidate()
        timer = nil
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        request = nil
        task = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
