import Foundation

struct Merchant: Codable, Identifiable, Hashable {
    let id: Int
    let name: String
    let category: String
    let kind: String?
    let address: String?
    let accepts_agents: Bool?
    let max_agent_ticket_cents: Int?
}

struct MenuItem: Codable, Identifiable, Hashable {
    var id: String { "\(merchant_id)-\(item)" }
    let merchant_id: Int
    let merchant: String
    let item: String
    let cents: Int
    let category: String?
    let desc: String?
    let image: String?
}

struct Reason: Codable, Hashable {
    let feature: String
    let contribution: Double
}

struct HistoryItem: Codable, Hashable {
    let kind: String
    let amount_cents: Int
    let ts: Double
    let sig: String
    let merchant: String?
    let merchant_id: Int?
    let item: String?
    let approved: Bool?
    let score: Double?
    let source: String?
    let from_wallet: String?
    let to_wallet: String?
    let by: String?
    let latency_ms: Double?
    let reasons: [Reason]?
    let settle_sig: String?
    let agent: String?
}

struct Account: Codable, Identifiable {
    var id: String { uid }
    let uid: String
    let name: String
    let card_number: String
    let balance_cents: Int
    let daily_limit_cents: Int
    let spent_today_cents: Int
    let status: String
    let closed: Bool?
    let person_id: String?
    let card_pda: String?
    let register_sig: String?
    let created: Double
    let history: [HistoryItem]
}

struct Person: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let birthday: String
    let email: String?
    let created: Double
    let cards: [String]
    let wallet: String?
    let wallet_sig: String?
    let token: String?
}
struct WalletInfo: Codable { let address: String; let usdc: String?; let sol: Double? }
struct SweptWallet: Codable { let to_wallet: String?; let usdc: String?; let sol: Double?; let usdc_explorer: String?; let error: String? }
struct DeleteResult: Codable { let ok: Bool?; let id: String?; let cards: [CloseCardResult]?; let wallet: SweptWallet? }
struct CloseCardResult: Codable { let ok: Bool?; let uid: String?; let swept_cents: Int?; let to_wallet: String?; let sig: String?; let explorer: String?; let error: String? }

struct FundRequest: Codable { let reference: String; let url: String; let recipient: String; let amount_cents: Int }
struct FundStatus: Codable { let status: String; let sig: String?; let explorer: String?; let amount_cents: Int?; let from_wallet: String? }
struct WithdrawResult: Codable { let ok: Bool?; let sig: String?; let explorer: String?; let balance_cents: Int? }
struct CloseResult: Codable { let ok: Bool?; let balance_left_cents: Int?; let sig: String?; let explorer: String? }

struct AgentPolicy: Codable, Hashable {
    let budget_cents: Int
    let per_txn_max_cents: Int
    let daily_max_cents: Int
    let allowed_merchants: [Int]
    let hour_start: Int
    let hour_end: Int
    let approval_threshold_cents: Int
    let max_txn_per_hour: Int
}

struct AgentTask: Codable, Hashable {
    let uid: String
    let budget_cents: Int
    let opened: Double
    let closed: Double?
    let returned_cents: Int?
    let state: String?
}

struct AgentPurchase: Codable, Hashable {
    let ts: Double
    let merchant: String
    let item: String
    let amount_cents: Int
    let approved: Bool
    let reason: String?
    let sig: String?
    let explorer: String?
    let latency_ms: Int?
}

struct Agent: Codable, Identifiable, Hashable {
    let id: String
    let person_id: String
    let owner: String
    let agent_id: Int
    let name: String
    let uid: String
    let card_number: String
    let created: Double
    let last_used: Double
    let policy: AgentPolicy
    let policy_version: Int
    let policy_hash: String?
    let agent_pda: String?
    let register_sig: String?
    let policy_sig: String?
    let policy_ts: Double?
    let frozen: Bool
    let balance_cents: Int
    let spent_total_cents: Int
    let spent_today_cents: Int
    let txn_this_hour: Int?
    let open_tasks: Int?
    let tasks: [AgentTask]
    let purchases: [AgentPurchase]
    let thread_len: Int?
    let running: Bool?
    let session: Int?
    let session_open: Bool?

    var leftCents: Int { max(0, policy.budget_cents - spent_total_cents) }
    var spendableCents: Int { min(balance_cents, leftCents) }
}

struct MessageData: Codable, Hashable {
    let intent: String?
    let merchant: String?
    let amount_cents: Int?
    let reason: String?
    let expires: Double?
    let usual_cents: Int?
    let times_usual: Double?
    let sig: String?
    let explorer: String?
    let rule: String?
    let task_card: String?
    let latency_ms: Int?
    let tool: String?
    let planner: String?
    let version: Int?
    let detail: String?
    let item: String?
    let proposal: String?
    let kind: String?
    let summary: String?
    let done: String?
    let signature: String?
    let decision: String?
    let artifact: Artifact?
    let order: OrderSummary?
    let goal: String?
    let steps: [String]?
    let shop_names: [String]?
    let estimate_cents: Int?
    let budget_cents: Int?
    let status: String?
    let from: String?
}

struct OrderSummary: Codable, Hashable {
    let item: String?
}

struct Artifact: Codable, Hashable {
    let type: String
    let title: String?
    let text: String?
    let url: String?
}

struct AgentMessage: Codable, Identifiable, Hashable {
    let id: String
    let ts: Double
    let role: String
    let kind: String
    let text: String
    let data: MessageData?
    let session: Int?
}

struct Intent: Codable, Identifiable, Hashable {
    let id: String
    let agent: String
    let agent_name: String
    let person_id: String
    let merchant_id: Int
    let merchant: String
    let amount_cents: Int
    let reason: String
    let status: String
    let confirm: String?
    let created: Double
    let expires: Double
    let usual_cents: Int?
    let explorer: String?
}

struct Proposal: Codable, Identifiable, Hashable {
    let id: String
    let agent: String
    let agent_name: String
    let person_id: String
    let kind: String
    let summary: String
    let amount_cents: Int?
    let status: String
    let created: Double
    let expires: Double
    let sig: String?
    let explorer: String?
    let error: String?
}

struct PassportDoc: Codable {
    let agent: String
    let name: String
    let owner_name: String
    let owner: String
    let agent_pda: String?
    let agent_key: String?
    let policy_text: String
    let policy_version: Int
    let policy_hash: String?
    let created: Double
    let purchases: Int
    let stopped: Int
    let spent_total_cents: Int
    let frozen: Bool
    let chain_head: String?
    let chain_len: Int?
    let issued_at: Double
}
struct Passport: Codable { let passport: PassportDoc; let signature: String?; let issuer_key: String? }

struct AskResult: Codable { let ok: Bool?; let agent: String?; let running: Bool? }
struct EnsureResult: Codable { let agent: Agent?; let creating: Bool? }
struct ProposalResult: Codable { let ok: Bool?; let proposal: Proposal? }
struct ApproveResult: Codable { let ok: Bool?; let intent: Intent? }
struct FundAgentResult: Codable { let agent: Agent?; let card: Account?; let sig: String?; let explorer: String? }
struct ServiceOK: Codable { let ok: Bool? }

enum APIError: LocalizedError {
    case badURL, http(Int), decode, refused(String)
    var errorDescription: String? {
        switch self {
        case .badURL: return "The service address is not a valid URL."
        case .http(401): return "The service wants this account's token. Open the account again on this phone."
        case .http(let c): return "The service returned HTTP \(c)."
        case .decode: return "Could not read the service response."
        case .refused(let why): return why
        }
    }
}

private struct Refusal: Decodable { let error: String; let reason: String? }
private struct Detail: Decodable { let detail: String }

enum OwnerToken {
    static var value: String? {
        get { UserDefaults.standard.string(forKey: "ownerToken") }
        set { UserDefaults.standard.set(newValue, forKey: "ownerToken") }
    }
    static var origin: String? {
        get { UserDefaults.standard.string(forKey: "ownerTokenOrigin") }
        set { UserDefaults.standard.set(newValue, forKey: "ownerTokenOrigin") }
    }
    static func issued(_ token: String, by base: String) {
        value = token
        origin = API.normalize(base)
    }
    static func clear() {
        value = nil
        origin = nil
    }
    static func matches(_ base: String) -> Bool {
        if origin == nil, value != nil { origin = API.normalize(base) }
        return origin == API.normalize(base)
    }
}

func centsFrom(_ text: String) -> Int {
    let cleaned = text.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
    guard let d = Double(cleaned), d.isFinite, d >= 0 else { return 0 }
    return Int((d * 100).rounded())
}

struct API {
    let base: String

    static func normalize(_ b: String) -> String {
        var s = b.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> T {
        guard let url = URL(string: API.normalize(base) + path) else { throw APIError.badURL }
        var req = URLRequest(url: url, timeoutInterval: 240)
        req.httpMethod = method
        if let t = UserDefaults.standard.string(forKey: "adminToken"), !t.isEmpty {
            req.setValue(t, forHTTPHeaderField: "x-admin-token")
        }
        if let t = OwnerToken.value, !t.isEmpty, OwnerToken.matches(base) {
            req.setValue(t, forHTTPHeaderField: "x-owner-token")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(code) else {
            if let d = try? JSONDecoder().decode(Detail.self, from: data) { throw APIError.refused(d.detail) }
            throw APIError.http(code)
        }
        if let r = try? JSONDecoder().decode(Refusal.self, from: data) { throw APIError.refused(r.reason ?? r.error) }
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw APIError.decode }
    }

    func health() async throws -> [String: AnyCodable] { try await request("/health") }
    func merchants() async throws -> [Merchant] { try await request("/merchants") }
    func menu() async throws -> [MenuItem] { try await request("/menu") }
    func accounts() async throws -> [Account] { try await request("/accounts") }
    func account(uid: String) async throws -> Account { try await request("/accounts/\(uid)") }

    func createPerson(name: String, birthday: String, email: String?) async throws -> Person {
        struct Body: Encodable { let name: String; let birthday: String; let email: String? }
        let p: Person = try await request("/people", method: "POST", body: Body(name: name, birthday: birthday, email: email))
        if let t = p.token { OwnerToken.issued(t, by: base) }
        return p
    }
    func people() async throws -> [Person] { try await request("/people") }
    func person(id: String) async throws -> Person { try await request("/people/\(id)") }
    func deletePerson(id: String, toWallet: String?) async throws -> DeleteResult {
        let q = toWallet.map { "?to_wallet=\($0)" } ?? ""
        return try await request("/people/\(id)\(q)", method: "DELETE")
    }
    func walletInfo(personID: String) async throws -> WalletInfo { try await request("/people/\(personID)/wallet") }
    func load(uid: String, cents: Int) async throws -> Account {
        struct Body: Encodable { let uid: String; let amount_cents: Int }
        return try await request("/load", method: "POST", body: Body(uid: uid, amount_cents: cents))
    }

    func register(uid: String?, personID: String?, name: String? = nil) async throws -> Account {
        struct Body: Encodable { let name: String?; let uid: String?; let person_id: String? }
        return try await request("/accounts", method: "POST", body: Body(name: name, uid: uid, person_id: personID))
    }

    func deposit(uid: String, cents: Int) async throws -> Account {
        struct Body: Encodable { let uid: String; let amount_cents: Int }
        return try await request("/deposit", method: "POST", body: Body(uid: uid, amount_cents: cents))
    }

    func fund(uid: String, cents: Int) async throws -> FundRequest {
        struct Body: Encodable { let uid: String; let amount_cents: Int }
        return try await request("/fund", method: "POST", body: Body(uid: uid, amount_cents: cents))
    }
    func fundStatus(reference: String) async throws -> FundStatus { try await request("/fund/\(reference)") }

    func withdraw(uid: String, cents: Int, toWallet: String) async throws -> WithdrawResult {
        struct Body: Encodable { let uid: String; let amount_cents: Int; let to_wallet: String }
        return try await request("/withdraw", method: "POST", body: Body(uid: uid, amount_cents: cents, to_wallet: toWallet))
    }

    func setLock(uid: String, locked: Bool) async throws -> Account {
        struct Body: Encodable { let uid: String; let blocked: Bool; let by: String }
        return try await request("/freeze", method: "POST", body: Body(uid: uid, blocked: locked, by: "cardholder"))
    }

    func closeCard(uid: String) async throws -> CloseCardResult {
        struct Body: Encodable { let uid: String }
        return try await request("/close_card", method: "POST", body: Body(uid: uid))
    }
    func closeAccount(uid: String) async throws -> CloseResult { try await request("/accounts/\(uid)", method: "DELETE") }

    func agents(personID: String) async throws -> [Agent] { try await request("/agents?person_id=\(personID)") }
    func agent(id: String) async throws -> Agent { try await request("/agents/\(id)") }
    func ensureAgent(personID: String) async throws -> EnsureResult {
        struct Body: Encodable { let person_id: String }
        return try await request("/agents/ensure", method: "POST", body: Body(person_id: personID))
    }
    func moveFunds(agentID: String, uid: String, cents: Int, clawback: Bool) async throws -> FundAgentResult {
        struct Body: Encodable { let uid: String; let amount_cents: Int }
        return try await request("/agents/\(agentID)/\(clawback ? "clawback" : "fund")", method: "POST", body: Body(uid: uid, amount_cents: cents))
    }
    func setFrozen(agentID: String, frozen: Bool) async throws -> Agent {
        struct Body: Encodable { let frozen: Bool; let by: String }
        return try await request("/agents/\(agentID)/freeze", method: "POST", body: Body(frozen: frozen, by: "owner"))
    }
    func freezeAll(personID: String) async throws -> [Agent] {
        struct Body: Encodable { let person_id: String }
        return try await request("/agents/freeze-all", method: "POST", body: Body(person_id: personID))
    }
    func deleteAgent(id: String, uid: String?) async throws -> [String: AnyCodable] {
        let q = uid.map { "?uid=\($0)" } ?? ""
        return try await request("/agents/\(id)\(q)", method: "DELETE")
    }
    func thread(agentID: String) async throws -> [AgentMessage] { try await request("/agents/\(agentID)/thread") }
    func ask(personID: String, agentID: String?, text: String, cardUID: String?) async throws -> AskResult {
        struct Body: Encodable { let person_id: String; let agent_id: String?; let text: String; let card_uid: String?; let wait: Bool; let tz_offset_min: Int }
        return try await request("/ask", method: "POST", body: Body(person_id: personID, agent_id: agentID, text: text, card_uid: cardUID, wait: false, tz_offset_min: TimeZone.current.secondsFromGMT() / 60))
    }
    func proposals(personID: String) async throws -> [Proposal] { try await request("/proposals?person_id=\(personID)") }
    func passport(agentID: String) async throws -> Passport { try await request("/agents/\(agentID)/passport") }
    func approveProposal(id: String, cardUID: String?, decision: String) async throws -> ProposalResult {
        struct Body: Encodable { let card_uid: String?; let decision: String }
        return try await request("/proposals/\(id)/approve", method: "POST", body: Body(card_uid: cardUID, decision: decision))
    }
    func intents(personID: String, status: String? = nil) async throws -> [Intent] {
        try await request("/intents?person_id=\(personID)" + (status.map { "&status=\($0)" } ?? ""))
    }
    func approve(intentID: String, cardUID: String?, decision: String) async throws -> ApproveResult {
        struct Body: Encodable { let card_uid: String?; let decision: String }
        return try await request("/intents/\(intentID)/approve", method: "POST", body: Body(card_uid: cardUID, decision: decision))
    }
}

struct AnyEncodable: Encodable {
    private let enc: (Encoder) throws -> Void
    init(_ wrapped: Encodable) { enc = wrapped.encode }
    func encode(to encoder: Encoder) throws { try enc(encoder) }
}

struct AnyCodable: Codable {
    let value: Any
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { value = b }
        else if let i = try? c.decode(Int.self) { value = i }
        else if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self) { value = s }
        else { value = "" }
    }
    func encode(to encoder: Encoder) throws {}
}
