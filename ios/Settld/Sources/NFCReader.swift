import Foundation
import CoreNFC

final class NFCReader: NSObject, ObservableObject, NFCTagReaderSessionDelegate {
    @Published var lastUID: String?
    @Published var error: String?
    @Published var scanning = false

    private var session: NFCTagReaderSession?
    private var completion: ((Result<String, Error>) -> Void)?

    static var available: Bool { NFCTagReaderSession.readingAvailable }

    func read(prompt: String = "Hold the Settld card near the top of the phone", _ done: @escaping (Result<String, Error>) -> Void) {
        guard Self.available else {
            done(.failure(NSError(domain: "Settld", code: 1, userInfo: [NSLocalizedDescriptionKey: "NFC is not available on this device."])))
            return
        }
        completion = done
        session = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil)
        session?.alertMessage = prompt
        scanning = true
        session?.begin()
    }

    func cancel() {
        completion = nil
        session?.invalidate()
        session = nil
        scanning = false
    }

    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        DispatchQueue.main.async {
            self.scanning = false
            if let e = error as? NFCReaderError, e.code == .readerSessionInvalidationErrorUserCanceled || e.code == .readerSessionInvalidationErrorFirstNDEFTagRead {
                self.completion?(.failure(CancellationError()))
            } else if self.completion != nil {
                self.error = error.localizedDescription
                self.completion?(.failure(error))
            }
            self.completion = nil
        }
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard let tag = tags.first else { return }
        if tags.count > 1 {
            session.alertMessage = "More than one card found. Present one card."
            session.restartPolling()
            return
        }
        session.connect(to: tag) { err in
            if let err {
                session.invalidate(errorMessage: err.localizedDescription)
                return
            }
            var id: Data?
            switch tag {
            case .miFare(let t): id = t.identifier
            case .iso7816(let t): id = t.identifier
            case .iso15693(let t): id = t.identifier
            case .feliCa(let t): id = t.currentIDm
            @unknown default: id = nil
            }
            guard let id, !id.isEmpty else {
                session.invalidate(errorMessage: "Could not read a serial number from this card.")
                return
            }
            let uid = id.map { String(format: "%02x", $0) }.joined()
            session.alertMessage = "Card read"
            session.invalidate()
            DispatchQueue.main.async {
                self.lastUID = uid
                self.scanning = false
                self.completion?(.success(uid))
                self.completion = nil
            }
        }
    }
}

final class NFCWriter: NSObject, ObservableObject, NFCNDEFReaderSessionDelegate {
    private var session: NFCNDEFReaderSession?
    private var payload: String = ""
    private var completion: ((Result<Void, Error>) -> Void)?

    func write(text: String, _ done: @escaping (Result<Void, Error>) -> Void) {
        payload = text
        completion = done
        session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
        session?.alertMessage = "Hold the card still to write the card number"
        session?.begin()
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        DispatchQueue.main.async {
            if let e = error as? NFCReaderError, e.code == .readerSessionInvalidationErrorUserCanceled { self.completion?(.failure(CancellationError())) }
            else if self.completion != nil { self.completion?(.failure(error)) }
            self.completion = nil
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else { return }
        session.connect(to: tag) { err in
            if let err { session.invalidate(errorMessage: err.localizedDescription); return }
            tag.queryNDEFStatus { status, _, qErr in
                if let qErr { session.invalidate(errorMessage: qErr.localizedDescription); return }
                guard status == .readWrite else { session.invalidate(errorMessage: "This card is not writable."); return }
                guard let rec = NFCNDEFPayload.wellKnownTypeTextPayload(string: self.payload, locale: Locale(identifier: "en")) else {
                    session.invalidate(errorMessage: "Could not build the record."); return
                }
                tag.writeNDEF(NFCNDEFMessage(records: [rec])) { wErr in
                    if let wErr { session.invalidate(errorMessage: wErr.localizedDescription); return }
                    session.alertMessage = "Card number written"
                    session.invalidate()
                    DispatchQueue.main.async { self.completion?(.success(())); self.completion = nil }
                }
            }
        }
    }
}
