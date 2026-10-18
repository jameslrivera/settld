import Foundation
import Combine
import UIKit

struct Notice: Identifiable, Equatable {
    enum Kind { case approved, blocked, issued, deposit, frozen, screened, withdraw, agent, approval }
    let id = UUID()
    let kind: Kind
    let title: String
    let detail: String
    let href: URL?
    let ts = Date()
}

private func explorer(_ sig: String?) -> URL? {
    guard let sig else { return nil }
    return URL(string: "https://explorer.solana.com/tx/\(sig)?cluster=devnet")
}

@MainActor
final class Feed: ObservableObject {
    @Published var notices: [Notice] = []
    @Published var connected = false
    @Published var threadBumps: [String: Int] = [:]
    @Published var agentsVersion = 0
    @Published var pendingIntents: [String: Intent] = [:]
    @Published var pendingProposals: [String: Proposal] = [:]
    var personID = ""

    private var task: URLSessionWebSocketTask?
    private var baseURL = ""
    private var knownBalances: [String: Int] = [:]
    private var reconnect: Task<Void, Never>?

    var pendingCount: Int {
        let now = Date().timeIntervalSince1970
        return pendingIntents.values.filter { $0.expires > now }.count + pendingProposals.values.filter { $0.expires > now }.count
    }

    func connect(base: String) {
        guard base != baseURL || task == nil else { return }
        baseURL = base
        task?.cancel(with: .goingAway, reason: nil)
        guard var c = URLComponents(string: API.normalize(base)) else { return }
        c.scheme = c.scheme == "https" ? "wss" : "ws"
        c.path = (c.path.hasSuffix("/") ? String(c.path.dropLast()) : c.path) + "/ws"
        guard let url = c.url else { return }
        let t = URLSession.shared.webSocketTask(with: url)
        task = t
        t.resume()
        connected = true
        receive(t)
    }

    private func receive(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            guard let self else { return }
            Task { @MainActor in
                guard t === self.task else { return }
                switch result {
                case .failure:
                    self.connected = false
                    self.scheduleReconnect()
                case .success(let msg):
                    if case .string(let s) = msg, let data = s.data(using: .utf8),
                       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        self.handle(obj, raw: data)
                    }
                    self.receive(t)
                }
            }
        }
    }

    private func scheduleReconnect() {
        reconnect?.cancel()
        let base = baseURL
        reconnect = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, let self else { return }
            self.task = nil
            self.connect(base: base)
        }
    }

    private func handle(_ m: [String: Any], raw: Data) {
        switch m["type"] as? String ?? "" {
        case "auth":
            if m["simulated"] as? Bool == true { return }
            let cents = m["amount_cents"] as? Int ?? 0
            let merchant = m["merchant"] as? String ?? "shop"
            let href = explorer(m["sig"] as? String)
            let agent = (m["agent"] as? [String: Any])?["name"] as? String
            if m["approved"] as? Bool == true {
                let item = m["item"] as? String ?? "purchase"
                if let agent {
                    push(Notice(kind: .agent, title: "\(agent) paid", detail: "\(usd(cents)) · \(item) at \(merchant)", href: href))
                } else {
                    push(Notice(kind: .approved, title: "Card approved", detail: "\(usd(cents)) · \(item) at \(merchant)", href: href))
                }
            } else {
                let feature = (m["reasons"] as? [[String: Any]])?.first?["feature"] as? String
                let why = feature.map(plain) ?? "unusual pattern"
                push(Notice(kind: .blocked, title: agent.map { "\($0) stopped" } ?? "Fraud shield", detail: "\(usd(cents)) at \(merchant) · \(why)", href: href))
            }

        case "account":
            guard let uid = m["uid"] as? String else { return }
            let bal = m["balance_cents"] as? Int ?? 0
            let name = m["name"] as? String ?? "cardholder"
            let history = m["history"] as? [[String: Any]] ?? []
            if let prev = knownBalances[uid] {
                if bal > prev, let h = history.first, h["kind"] as? String == "deposit" {
                    let fromWallet = h["source"] as? String == "wallet"
                    push(Notice(kind: .deposit,
                                title: fromWallet ? "Funded from wallet" : "Money added",
                                detail: "\(name) · +\(usd(bal - prev)) USDC",
                                href: explorer(h["sig"] as? String)))
                }
            } else if history.isEmpty {
                let num = m["card_number"] as? String ?? ""
                push(Notice(kind: .issued, title: "Card issued", detail: "\(name) · •••• \(num.suffix(4))", href: explorer(m["register_sig"] as? String)))
            }
            knownBalances[uid] = bal

        case "status":
            let name = m["name"] as? String ?? "card"
            let blocked = m["status"] as? String == "blocked"
            let who = (m["by"] as? String) == "cardholder" ? "by you" : "by the issuer"
            push(Notice(kind: .frozen, title: blocked ? "Card locked \(who)" : "Card unlocked \(who)", detail: "\(name) · written on chain", href: explorer(m["sig"] as? String)))

        case "withdraw":
            let name = m["name"] as? String ?? "card"
            let cents = m["amount_cents"] as? Int ?? 0
            let to = m["to_wallet"] as? String ?? ""
            push(Notice(kind: .withdraw, title: "Withdrawn to wallet", detail: "\(name) · \(usd(cents)) USDC → \(to.prefix(4))…\(to.suffix(4))", href: explorer(m["sig"] as? String)))

        case "account_removed":
            let name = m["name"] as? String ?? "card"
            if let uid = m["uid"] as? String { knownBalances[uid] = nil }
            push(Notice(kind: .frozen, title: "Account closed", detail: "\(name) · card frozen on chain", href: explorer(m["sig"] as? String)))

        case "agent", "agent_removed":
            agentsVersion += 1

        case "agent_message":
            if let id = m["agent"] as? String { threadBumps[id, default: 0] += 1 }

        case "intent", "intent_pending":
            if let i = try? JSONDecoder().decode(Intent.self, from: raw) {
                if !personID.isEmpty && i.person_id != personID { return }
                if i.status == "pending" {
                    let fresh = pendingIntents[i.id] == nil
                    pendingIntents[i.id] = i
                    if fresh || m["type"] as? String == "intent_pending" {
                        push(Notice(kind: .approval, title: i.confirm == "face_id" ? "Confirm with Face ID" : "Hold your card to approve", detail: "\(i.agent_name) wants \(usd(i.amount_cents)) at \(i.merchant)", href: nil))
                    }
                } else {
                    pendingIntents[i.id] = nil
                }
            }

        case "proposal", "proposal_pending":
            if let p = try? JSONDecoder().decode(Proposal.self, from: raw) {
                if !personID.isEmpty && p.person_id != personID { return }
                if p.status == "pending" {
                    let fresh = pendingProposals[p.id] == nil
                    pendingProposals[p.id] = p
                    if fresh || m["type"] as? String == "proposal_pending" {
                        push(Notice(kind: .approval, title: p.kind == "task" ? "Sign off with Face ID" : "Approve with Face ID", detail: "\(p.agent_name) · \(p.summary)", href: nil))
                    }
                } else {
                    pendingProposals[p.id] = nil
                }
            }

        case "task_card":
            let agent = m["agent_name"] as? String ?? "agent"
            if m["action"] as? String == "opened" {
                push(Notice(kind: .agent, title: "Task card opened", detail: "\(agent) · \(usd(m["budget_cents"] as? Int ?? 0)) for \(m["merchant"] as? String ?? "the shop")", href: explorer(m["sig"] as? String)))
            } else {
                push(Notice(kind: .agent, title: "Task card closed", detail: "\(agent) · \(usd(m["returned_cents"] as? Int ?? 0)) returned", href: explorer(m["sig"] as? String)))
            }

        case "no_order":
            let merchant = m["merchant"] as? String ?? "the shop"
            push(Notice(kind: .screened, title: "Nothing rung up", detail: "\(merchant) · the order has to be started first, nothing was charged", href: nil))

        case "screened":
            let name = (m["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "unknown"
            push(Notice(kind: .screened, title: "Registration screened out", detail: "\(name) · \(m["reason"] as? String ?? "")", href: nil))

        case "reset":
            knownBalances = [:]
            notices = []
            pendingIntents = [:]
            pendingProposals = [:]
            agentsVersion += 1

        default:
            break
        }
    }

    private func push(_ n: Notice) {
        notices.insert(n, at: 0)
        if notices.count > 3 { notices.removeLast(notices.count - 3) }
        switch n.kind {
        case .approved, .deposit, .agent: UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .blocked, .frozen, .screened, .approval: UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case .issued, .withdraw: UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }
        let id = n.id
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            self?.dismiss(id)
        }
    }

    func dismiss(_ id: UUID) {
        notices.removeAll { $0.id == id }
    }
}
