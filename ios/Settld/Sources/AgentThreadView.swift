import SwiftUI

enum Approval: Hashable {
    case intent(String), task(String), proposal(String)
    var isPurchase: Bool { if case .intent = self { return true } else { return false } }
    var isTask: Bool { if case .task = self { return true } else { return false } }
}

struct AgentThreadView: View {
    let agentID: String
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var feed: Feed
    @AppStorage("personID") private var personID = ""
    @AppStorage("cardUID") private var cardUID = ""
    @State private var agent: Agent?
    @State private var messages: [AgentMessage] = []
    @State private var intentStatus: [String: String] = [:]
    @State private var proposalStatus: [String: String] = [:]
    @State private var loading = false
    @State private var rejecting: Approval?
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    @State private var draft = ""
    @State private var busy = false
    @State private var approving: Approval?
    @State private var error: String?
    @State private var showMoney: MoneyMode?
    @State private var showPassport = false
    @State private var showHistory = false
    @State private var now = Date()
    @StateObject private var nfc = NFCReader()
    @StateObject private var speech = SpeechRecognizer()

    enum MoneyMode: String, Identifiable { case fund, clawback; var id: String { rawValue } }
    private var api: API { API(base: settings.baseURL) }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            if let a = agent {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(a.name).font(.system(size: 34, weight: .regular, design: .serif))
                                    Text(a.frozen ? "Frozen" : "\(usd(a.spendableCents)) to spend").font(.footnote).foregroundStyle(a.frozen ? Theme.shield : Theme.ink3)
                                }
                                AgentCardArt(agent: a).padding(.bottom, 4)
                                BudgetBar(agent: a).padding(.bottom, 8)
                            }
                            ForEach(taskDone ? outcome : []) { m in
                                MessageView(m: m, status: nil, approving: false, now: now, onApprove: { _ in }, onReject: { _ in })
                            }
                            ForEach(taskDone ? [] : current) { m in
                                let target = m.kind == "confirm" ? m.data?.intent.map(Approval.task) : (m.data?.intent.map(Approval.intent) ?? m.data?.proposal.map(Approval.proposal))
                                MessageView(m: m, status: target.flatMap(status(of:)), approving: target != nil && (approving == target || rejecting == target), now: now,
                                            live: m.kind == "status" && m.id == messages.last?.id && agent?.running == true,
                                            onApprove: { approve($0) }, onReject: { reject($0) })
                                    .id(m.id)
                            }
                            Color.clear.frame(height: 8).id("bottom")
                        }
                        .padding(.horizontal, 20).padding(.vertical, 12)
                    }
                    .onChange(of: messages.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.down).padding(.horizontal, 16).padding(.bottom, 6)
                }
                talkBar
            }
        }
        .task { await load(); await poll() }
        .task { await loadHints() }
        .onDisappear { speech.stop() }
        .onChange(of: speech.finished) { _, done in
            if done { speech.finished = false; send(speech.transcript) }
        }
        .onChange(of: feed.threadBumps[agentID]) { _, _ in Task { await loadThread() } }
        .onReceive(ticker) { now = $0 }
        .onDisappear { nfc.cancel() }
        .sheet(item: $showMoney) { mode in
            if let a = agent { MoveMoneySheet(agent: a, cardUID: cardUID, api: api, clawback: mode == .clawback) { showMoney = nil; Task { await load() } } }
        }
        .sheet(isPresented: $showPassport) { PassportSheet(agentID: agentID, api: api) }
        .sheet(isPresented: $showHistory) { HistorySheet(messages: messages, now: now) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Wordmark(size: 22)
                Spacer()
                Menu {
                    Button { showMoney = .fund } label: { Label("Load from my card", systemImage: "arrow.down.circle") }
                    Button { showMoney = .clawback } label: { Label("Take money back", systemImage: "arrow.up.circle") }
                    Button { showPassport = true } label: { Label("Passport", systemImage: "person.text.rectangle") }
                    Button { showHistory = true } label: { Label("History", systemImage: "clock.arrow.circlepath") }
                    Divider()
                    Button { toggleFrozen() } label: { Label(agent?.frozen == true ? "Unfreeze" : "Freeze this agent", systemImage: "snowflake") }
                    if let pda = agent?.agent_pda, let u = URL(string: "https://explorer.solana.com/address/\(pda)?cluster=devnet") {
                        Link(destination: u) { Label("Agent account on Solana", systemImage: "link") }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(Theme.ink2).padding(6)
                }
            }
        }
        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 4)
    }

    private var current: [AgentMessage] {
        guard let last = messages.compactMap(\.session).max() else { return messages }
        return messages.filter { ($0.session ?? last) == last }
    }

    private var taskDone: Bool { agent?.session_open == false && !current.isEmpty && !busy && agent?.running != true }

    private var outcome: [AgentMessage] {
        guard let idx = current.lastIndex(where: { $0.kind == "receipt" }) else { return current.last.map { [$0] } ?? [] }
        return current[idx...].filter { $0.kind == "receipt" || $0.kind == "delivered" || $0.kind == "fulfilled" }
    }

    private var liveStatus: String? {
        guard agent?.running == true || busy else { return nil }
        if let last = messages.last, last.kind == "status" { return last.text + "…" }
        return "Thinking…"
    }

    private var talkBar: some View {
        VStack(spacing: 12) {
            if speech.listening {
                Text(speech.transcript.isEmpty ? "Listening…" : speech.transcript)
                    .font(.subheadline).foregroundStyle(speech.transcript.isEmpty ? Theme.ink3 : .white)
                    .multilineTextAlignment(.center).lineLimit(4)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Theme.surface)
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Theme.line, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            } else if let s = liveStatus {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(Theme.pink)
                    Text(s).font(.subheadline).foregroundStyle(Theme.ink2)
                }
            } else if let e = speech.error {
                Text(e).font(.caption).foregroundStyle(Theme.shield).multilineTextAlignment(.center)
            }
            HStack(spacing: 14) {
                #if targetEnvironment(simulator)
                TextField("Simulator only", text: $draft)
                    .font(.footnote)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Theme.surface).clipShape(Capsule())
                    .onSubmit { send(draft) }
                #endif
                Button { toggleTalk() } label: {
                    Image(systemName: speech.listening ? "stop.fill" : "mic.fill")
                        .font(.title2.weight(.semibold)).foregroundStyle(.white)
                        .frame(width: 64, height: 64)
                        .background(speech.listening ? AnyShapeStyle(Theme.down) : AnyShapeStyle(Theme.pinkGradient))
                        .clipShape(Circle())
                        .shadow(color: (speech.listening ? Theme.down : Theme.pink).opacity(0.45), radius: 14, y: 6)
                }
                .buttonStyle(.plain)
                .disabled(liveStatus != nil)
                .opacity(liveStatus != nil ? 0.5 : 1)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 10)
        .background(Theme.bg)
    }

    private func toggleTalk() {
        if speech.listening {
            speech.stop()
            Task {
                try? await Task.sleep(for: .milliseconds(400))
                if !speech.finished { send(speech.transcript) }
            }
        } else {
            error = nil
            speech.start()
        }
    }

    private func load() async {
        agent = try? await api.agent(id: agentID)
        await loadThread()
    }

    private func loadHints() async {
        let shops = (try? await api.merchants())?.map(\.name) ?? []
        let items = (try? await api.menu())?.map(\.item) ?? []
        var seen = Set<String>()
        speech.hints = (shops + shops.map { $0.replacingOccurrences(of: " Coffee", with: "") } + items).filter { seen.insert($0.lowercased()).inserted }
    }

    private func loadThread() async {
        if loading { return }
        loading = true
        defer { loading = false }
        do {
            messages = try await api.thread(agentID: agentID)
            if error?.hasPrefix("Can't read") == true { error = nil }
        } catch {
            self.error = "Can't read this thread: \(error.localizedDescription)"
        }
        if let a = try? await api.agent(id: agentID) { agent = a }
        if let list = try? await api.intents(personID: personID) {
            intentStatus = Dictionary(uniqueKeysWithValues: list.filter { $0.agent == agentID }.map { ($0.id, $0.status) })
        }
        if let list = try? await api.proposals(personID: personID) {
            proposalStatus = Dictionary(uniqueKeysWithValues: list.filter { $0.agent == agentID }.map { ($0.id, $0.status) })
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            await loadThread()
        }
    }

    private func send(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                _ = try await api.ask(personID: personID, agentID: agentID, text: text, cardUID: nil)
                draft = ""
                try? await Task.sleep(for: .milliseconds(600))
                await loadThread()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func status(of t: Approval) -> String? {
        switch t {
        case .intent(let id), .task(let id): return intentStatus[id]
        case .proposal(let id): return proposalStatus[id]
        }
    }

    private func submit(_ t: Approval, cardUID: String?, decision: String) async throws {
        switch t {
        case .intent(let id): _ = try await api.approve(intentID: id, cardUID: cardUID, decision: decision)
        case .task(let id): _ = try await api.approve(intentID: id, cardUID: nil, decision: decision)
        case .proposal(let id): _ = try await api.approveProposal(id: id, cardUID: cardUID, decision: decision)
        }
    }

    private func approve(_ t: Approval) {
        guard approving == nil else { return }
        approving = t
        error = nil
        Task { @MainActor in
            do {
                try await Approver.confirmIdentity(reason: t.isPurchase ? "Approve this purchase" : t.isTask ? "Confirm this order" : "Approve this change")
            } catch {
                self.error = error.localizedDescription
                approving = nil
                return
            }
            if !t.isPurchase {
                do {
                    try await submit(t, cardUID: cardUID.isEmpty ? nil : cardUID, decision: "approve")
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    try? await Task.sleep(for: .milliseconds(500))
                    await loadThread()
                } catch { self.error = error.localizedDescription }
                approving = nil
                return
            }
            #if targetEnvironment(simulator)
            do {
                try await submit(t, cardUID: cardUID.isEmpty ? nil : cardUID, decision: "approve")
                try? await Task.sleep(for: .milliseconds(500))
                await loadThread()
            } catch { self.error = error.localizedDescription }
            approving = nil
            #else
            nfc.read(prompt: "Now hold your Settld card to the top of the phone") { result in
                Task { @MainActor in
                    switch result {
                    case .success(let uid):
                        do {
                            try await submit(t, cardUID: uid, decision: "approve")
                            UINotificationFeedbackGenerator().notificationOccurred(.success)
                            try? await Task.sleep(for: .milliseconds(500))
                            await loadThread()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    case .failure(let e):
                        if !(e is CancellationError) { self.error = e.localizedDescription }
                    }
                    approving = nil
                }
            }
            #endif
        }
    }

    private func reject(_ t: Approval) {
        guard rejecting == nil, approving == nil else { return }
        rejecting = t
        Task {
            do { try await submit(t, cardUID: nil, decision: "reject"); await loadThread() }
            catch { self.error = error.localizedDescription }
            rejecting = nil
        }
    }

    private func toggleFrozen() {
        guard let a = agent else { return }
        Task {
            do { agent = try await api.setFrozen(agentID: a.id, frozen: !a.frozen); await loadThread() }
            catch { self.error = error.localizedDescription }
        }
    }
}

struct MessageView: View {
    let m: AgentMessage
    let status: String?
    let approving: Bool
    let now: Date
    var live = false
    let onApprove: (Approval) -> Void
    let onReject: (Approval) -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch m.kind {
        case "status":
            HStack(spacing: 8) {
                if live {
                    ProgressView().controlSize(.mini).tint(Theme.pink)
                } else {
                    Image(systemName: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(Theme.up)
                }
                Text(live ? m.text : (m.data?.done ?? m.text)).font(.caption).foregroundStyle(live ? Theme.ink2 : Theme.ink3)
            }
            .padding(.leading, 4)
        case "plan":
            card(title: "Plan", tone: Theme.pink) {
                Text(m.text).font(.subheadline)
                if let a = m.data?.amount_cents { Text(usd(a)).font(.title3.weight(.semibold)) }
            }
        case "approval":
            let expires = Date(timeIntervalSince1970: m.data?.expires ?? 0)
            let left = max(0, Int(expires.timeIntervalSince(now)))
            let open = left > 0 && (status == nil || status == "pending")
            let outcome: String = {
                switch status {
                case "paid": return "Approved and paid"
                case "approved", "approving": return "Approved"
                case "rejected": return "Turned down"
                case "declined": return "Approved, then stopped"
                case "expired": return "Expired"
                default: return left > 0 ? "Answered" : "Expired"
                }
            }()
            card(title: open ? "Needs you" : "Approval", tone: Theme.shield) {
                if let a = m.data?.amount_cents, let where_ = m.data?.merchant {
                    HeroAmount(cents: a, size: 40)
                    Text("at \(where_)").font(.subheadline)
                }
                if let r = m.data?.reason, !r.isEmpty { Text("“\(r)”").font(.footnote).foregroundStyle(Theme.ink2) }
                if let t = m.data?.times_usual, t >= 1.5 { Text(String(format: "%.1f× its usual", t)).font(.caption).foregroundStyle(Theme.shield) }
                if open, let id = m.data?.intent {
                    PrimaryButton(title: approving ? "Confirming…" : "Hold your card to approve", icon: "wave.3.right.circle.fill", busy: approving) { onApprove(.intent(id)) }
                    HStack {
                        Button("Not now") { onReject(.intent(id)) }.font(.caption).foregroundStyle(Theme.ink3).disabled(approving)
                        Spacer()
                        Text("Expires in \(left / 60):\(String(format: "%02d", left % 60))").font(.caption).foregroundStyle(Theme.ink3)
                    }
                } else {
                    Text(outcome).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        case "confirm":
            let expires = Date(timeIntervalSince1970: m.data?.expires ?? 0)
            let left = max(0, Int(expires.timeIntervalSince(now)))
            let open = left > 0 && (status == nil || status == "pending")
            let outcome: String = {
                switch status {
                case "paid": return "Confirmed and paid"
                case "approved", "approving": return "Confirmed"
                case "rejected": return "Cancelled"
                case "declined": return "Confirmed, then stopped"
                case "expired": return "Expired"
                default: return left > 0 ? "Answered" : "Expired"
                }
            }()
            card(title: open ? "Confirm" : "Order", tone: Theme.pink) {
                if let items = m.data?.order?.item { Text(items).font(.subheadline.weight(.semibold)) }
                if let a = m.data?.amount_cents, let where_ = m.data?.merchant {
                    HeroAmount(cents: a, size: 40)
                    Text("at \(where_)").font(.subheadline)
                }
                if let r = m.data?.reason, !r.isEmpty { Text("“\(r)”").font(.footnote).foregroundStyle(Theme.ink2) }
                if open, let id = m.data?.intent {
                    PrimaryButton(title: approving ? "Confirming…" : "Confirm with Face ID", icon: "faceid", busy: approving) { onApprove(.task(id)) }
                    HStack {
                        Button("Cancel") { onReject(.task(id)) }.font(.caption).foregroundStyle(Theme.ink3).disabled(approving)
                        Spacer()
                        Text("Expires in \(left / 60):\(String(format: "%02d", left % 60))").font(.caption).foregroundStyle(Theme.ink3)
                    }
                } else {
                    Text(outcome).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        case "proposal":
            let expires = Date(timeIntervalSince1970: m.data?.expires ?? 0)
            let left = max(0, Int(expires.timeIntervalSince(now)))
            let open = left > 0 && (status == nil || status == "pending")
            let isTask = m.data?.kind == "task"
            let outcome: String = {
                switch status {
                case "approved": return isTask ? "Signed off" : "Approved and written on Solana"
                case "approving": return "Approving…"
                case "rejected": return "Turned down"
                case "failed": return "Approved, but it did not go through"
                case "replaced": return "Replaced by a newer request"
                case "expired": return "Expired"
                default: return left > 0 ? "Answered" : "Expired"
                }
            }()
            card(title: open ? (isTask ? "Sign off" : "Needs you") : (isTask ? "Task" : m.data?.kind == "fund" ? "Load" : m.data?.kind == "new_agent" ? "New agent" : "Rules"), tone: Theme.pink) {
                if isTask {
                    Text(m.data?.goal ?? m.text).font(.headline)
                    if let steps = m.data?.steps, !steps.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(steps.enumerated()), id: \.offset) { n, s in
                                Text("\(n + 1). \(s)").font(.footnote).foregroundStyle(Theme.ink2)
                            }
                        }
                    }
                    if let a = m.data?.amount_cents, a > 0 {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("Up to").font(.caption).foregroundStyle(Theme.ink3)
                            HeroAmount(cents: a, size: 36)
                        }
                    }
                    Text([m.data?.estimate_cents.map { "About \(usd($0))" }, m.data?.shop_names?.joined(separator: ", ")].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Theme.ink3)
                } else {
                    if let a = m.data?.amount_cents, a > 0 { HeroAmount(cents: a, size: 40) }
                    Text(m.data?.summary ?? m.text).font(.subheadline)
                }
                if open, let id = m.data?.proposal {
                    PrimaryButton(title: approving ? "Confirming…" : (isTask ? "Sign off with Face ID" : "Approve with Face ID"), icon: "faceid", busy: approving) { onApprove(.proposal(id)) }
                    HStack {
                        Button("Not now") { onReject(.proposal(id)) }.font(.caption).foregroundStyle(Theme.ink3).disabled(approving)
                        Spacer()
                        Text("Expires in \(left / 60):\(String(format: "%02d", left % 60))").font(.caption).foregroundStyle(Theme.ink3)
                    }
                } else {
                    Text(outcome).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        case "receipt":
            card(title: "Paid", tone: Theme.up) {
                Text(m.text).font(.subheadline)
                if let e = m.data?.explorer, let u = URL(string: e) {
                    Button { openURL(u) } label: { Label("View on Solana", systemImage: "link").font(.caption.weight(.medium)).foregroundStyle(Theme.ink2) }.buttonStyle(.plain)
                }
            }
        case "decline":
            card(title: "Stopped", tone: Theme.shield) {
                Text(m.text).font(.subheadline)
                if let e = m.data?.explorer, let u = URL(string: e) {
                    Button { openURL(u) } label: { Label("The decision on Solana", systemImage: "link").font(.caption.weight(.medium)).foregroundStyle(Theme.ink2) }.buttonStyle(.plain)
                }
            }
        case "accept", "merchant_decline", "fulfilled", "delivered":
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 5) {
                        Image(systemName: "storefront").font(.caption2)
                        Text(m.data?.merchant ?? "Shop").font(.caption2.weight(.semibold))
                        if m.data?.signature != nil { Image(systemName: "checkmark.seal.fill").font(.caption2).foregroundStyle(Theme.up) }
                    }
                    .foregroundStyle(m.kind == "merchant_decline" ? Theme.shield : Theme.ink3)
                    Text(m.text).font(.subheadline)
                    if m.kind == "delivered", let a = m.data?.artifact { ArtifactView(artifact: a) }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.surface)
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                Spacer(minLength: m.kind == "delivered" ? 16 : 40)
            }
        case "task_done":
            card(title: m.data?.status == "expired" ? "Task closed" : "Done", tone: Theme.up) {
                Text(m.text).font(.subheadline)
                if let spent = m.data?.amount_cents, let budget = m.data?.budget_cents {
                    Text("Spent \(usd(spent)) of \(usd(budget))").font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        case "question":
            bubble(m.text, mine: false, accent: true)
        case "contact":
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 5) {
                        Image(systemName: "message.fill").font(.caption2)
                        Text("Text from \(m.data?.from ?? "a contact")").font(.caption2.weight(.semibold))
                    }
                    .foregroundStyle(Theme.ink3)
                    Text(m.text).font(.subheadline)
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Theme.surface)
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                Spacer(minLength: 40)
            }
        case "text":
            bubble(m.text, mine: m.role == "owner", accent: false)
        default:
            let line: String = {
                switch m.kind {
                case "created": return "Created on Solana"
                case "policy": return "Rules updated" + (m.data?.version.map { " · v\($0)" } ?? "")
                default: return m.text
                }
            }()
            HStack {
                Spacer()
                Text(line).font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                if let e = m.data?.explorer, let u = URL(string: e) {
                    Button { openURL(u) } label: { Image(systemName: "link").font(.caption2).foregroundStyle(Theme.ink3) }.buttonStyle(.plain)
                }
                Spacer()
            }
            .padding(.vertical, 2)
        }
    }

    private func bubble(_ text: String, mine: Bool, accent: Bool) -> some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            Text(text)
                .font(.subheadline)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(mine ? Theme.pink : accent ? Theme.pink.opacity(0.14) : Theme.surface2)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            if !mine { Spacer(minLength: 40) }
        }
    }

    private func card<Content: View>(title: String, tone: Color, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(1.6).foregroundStyle(tone)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(tone.opacity(0.4), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }
}

struct ArtifactView: View {
    let artifact: Artifact
    @EnvironmentObject var settings: Settings
    @Environment(\.openURL) private var openURL

    private var link: URL? {
        guard let u = artifact.url else { return nil }
        return URL(string: u.hasPrefix("/") ? API.normalize(settings.baseURL) + u : u)
    }

    private var image: UIImage? {
        guard artifact.type == "image", let u = artifact.url, let comma = u.firstIndex(of: ","), u.hasPrefix("data:image"),
              let data = Data(base64Encoded: String(u[u.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }

    var body: some View {
        if artifact.type == "image", let img = image {
            Image(uiImage: img)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(width: 180, height: 180)
                .padding(8)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.top, 4)
        } else if artifact.type == "link", let u = link {
            Button { openURL(u) } label: {
                Label(artifact.title?.components(separatedBy: ":").first ?? "Open", systemImage: "doc.text")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Theme.pink)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        } else if let t = artifact.text, !t.isEmpty {
            Text(t)
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.top, 4)
        }
    }
}

struct MoveMoneySheet: View {
    let agent: Agent
    let cardUID: String
    let api: API
    let clawback: Bool
    let onDone: () -> Void
    @State private var amount = "10"
    @State private var busy = false
    @State private var error: String?
    @State private var done: String?

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text(clawback ? "Take money back" : "Load the agent").font(.title2.weight(.semibold))
                Text(clawback ? "Moves money from \(agent.name)'s card back to your card. On chain, one move inside the vault." : "Moves money from your card onto \(agent.name)'s card. Only your card can fund it; the program checks the owner.")
                    .font(.footnote).foregroundStyle(Theme.ink2)
                HStack(spacing: 8) {
                    ForEach(["5", "10", "20"], id: \.self) { a in Button("$\(a)") { amount = a }.buttonStyle(.bordered).tint(amount == a ? Theme.pink : Theme.ink3) }
                    TextField("Amount", text: $amount).keyboardType(.decimalPad).padding(10).background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                if cardUID.isEmpty { Text("Issue a card to this phone first.").font(.footnote).foregroundStyle(Theme.shield) }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.down) }
                if let done { Text(done).font(.footnote).foregroundStyle(Theme.up) }
                PrimaryButton(title: clawback ? "Take back" : "Load", busy: busy, enabled: !cardUID.isEmpty && centsFrom(amount) > 0) { go() }
                Spacer()
            }
            .padding(20)
        }
        .presentationDetents([.medium])
    }

    private func go() {
        busy = true
        error = nil
        Task {
            do {
                let r = try await api.moveFunds(agentID: agent.id, uid: cardUID, cents: centsFrom(amount), clawback: clawback)
                done = "Done. \(agent.name) now holds \(usd(r.agent?.balance_cents ?? 0))."
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                try? await Task.sleep(for: .seconds(1))
                onDone()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}


struct HistorySheet: View {
    let messages: [AgentMessage]
    let now: Date
    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    SectionLabel(text: "History").padding(.bottom, 4)
                    ForEach(messages) { m in
                        MessageView(m: m, status: "closed", approving: false, now: now, onApprove: { _ in }, onReject: { _ in })
                    }
                }
                .padding(20)
            }
        }
        .presentationDetents([.large])
    }
}
