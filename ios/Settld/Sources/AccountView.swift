import SwiftUI
import CoreImage.CIFilterBuiltins

struct ChainRow: Identifiable {
    let id: String
    let ts: Double
    let title: String
    let detail: String
    let sig: String
    let tone: Color
}

struct AccountView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var feed: Feed
    @AppStorage("personID") private var personID = ""
    @State private var person: Person?
    @State private var cards: [Account] = []
    @State private var agents: [Agent] = []
    @State private var wallet: WalletInfo?
    @State private var qr: UIImage?
    @State private var program: String?
    @State private var config: String?
    @State private var status = "—"
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false
    @State private var confirmFreezeAll = false
    @State private var note: String?
    @State private var sweepTo = ""
    @State private var copied = false
    @State private var showSettings = false
    @Environment(\.openURL) private var openURL

    private var api: API { API(base: settings.baseURL) }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 8) { RibbonS(size: 26); Wordmark(size: 22) }
                    Text("Account").font(.system(size: 34, weight: .regular, design: .serif))
                    if let p = person {
                        onSolana
                        addresses(p)
                        recent
                        cardsCard
                        agentsCard
                        settings(p)
                    } else if let note {
                        Text(note).font(.footnote).foregroundStyle(Theme.up).card()
                    } else {
                        Text("No account on this phone.").font(.footnote).foregroundStyle(Theme.ink3).card()
                        service
                    }
                }
                .padding(20)
                .padding(.bottom, 24)
            }
        }
        .refreshable { await load() }
        .task {
            await test()
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                await load()
            }
        }
        .onChange(of: feed.agentsVersion) { _, _ in Task { await load() } }
        .confirmationDialog("Freeze your agent?", isPresented: $confirmFreezeAll, titleVisibility: .visible) {
            Button("Freeze", role: .destructive) { freezeAll() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Its next purchase is declined and anything waiting for your approval is cancelled. Written on chain.")
        }
        .confirmationDialog("Close this account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Close account", role: .destructive) { if let p = person { deleteAccount(p) } }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("The agents are frozen on chain, the money is swept out of the wallet, and the card is released so it can open a new account. This phone starts over.")
        }
    }

    private var onSolana: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionLabel(text: "On Solana · devnet")
            if let w = wallet {
                HStack(spacing: 10) {
                    StatTile(label: "USDC", value: w.usdc ?? "0", sub: "")
                    StatTile(label: "SOL", value: String(format: "%.3f", w.sol ?? 0), sub: "")
                }
                HStack(alignment: .top, spacing: 14) {
                    if let qr {
                        Image(uiImage: qr).interpolation(.none).resizable()
                            .frame(width: 96, height: 96).padding(6).background(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Wallet address").font(.caption).foregroundStyle(Theme.ink3)
                        Text(short(w.address, 10)).font(.footnote.monospaced())
                        HStack(spacing: 14) {
                            Button {
                                UIPasteboard.general.string = w.address
                                copied = true
                                Task { try? await Task.sleep(for: .seconds(2)); copied = false }
                            } label: { Label(copied ? "Copied" : "Copy", systemImage: "doc.on.doc") }
                            Button { openURL(addressURL(w.address)) } label: { Label("Explorer", systemImage: "arrow.up.right") }
                        }
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.ink2).buttonStyle(.plain)
                    }
                    Spacer(minLength: 0)
                }
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(Theme.ink3)
                    Text("Creating your wallet on Solana…").font(.footnote).foregroundStyle(Theme.ink3)
                }
            }
        }
        .card()
    }

    private func addresses(_ p: Person) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Addresses")
            if let w = p.wallet { keyRow("Wallet", w) }
            ForEach(cards) { c in
                if let pda = c.card_pda, pda != "offline" { keyRow("Card •••• \(c.card_number.suffix(4))", pda) }
            }
            ForEach(agents) { a in
                if let pda = a.agent_pda, pda != "offline" { keyRow(a.name, pda) }
            }
            if let program { keyRow("Settld program", program) }
            if let config { keyRow("Issuer config", config) }
        }
        .card()
    }

    private var recent: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Recent on Solana")
            if chainRows.isEmpty {
                Text("Nothing yet.").font(.footnote).foregroundStyle(Theme.ink3)
            }
            ForEach(chainRows) { r in
                Button { openURL(txURL(r.sig)) } label: {
                    HStack(spacing: 12) {
                        Circle().fill(r.tone).frame(width: 8, height: 8)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.title).font(.subheadline.weight(.medium)).foregroundStyle(.white).lineLimit(1)
                            Text(r.detail).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(1)
                        }
                        Spacer()
                        Text(when(r.ts)).font(.caption2).foregroundStyle(Theme.ink3)
                        Image(systemName: "arrow.up.right").font(.caption2.weight(.semibold)).foregroundStyle(Theme.ink3)
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
            }
        }
        .card()
    }

    private var cardsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: cards.isEmpty ? "Cards" : "Cards · \(cards.count)")
            if cards.isEmpty {
                Text("No card yet.").font(.footnote).foregroundStyle(Theme.ink3)
            }
            ForEach(cards) { c in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("•••• " + String(c.card_number.suffix(4))).font(.subheadline.weight(.semibold))
                        Text(c.closed == true ? "Closed" : c.status == "blocked" ? "Locked" : "Active")
                            .font(.caption2)
                            .foregroundStyle(c.closed == true ? Theme.down : c.status == "blocked" ? Theme.shield : Theme.up)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(usd(c.balance_cents)).font(.system(size: 17, weight: .semibold, design: .serif))
                        Text("\(purchases(c).count) purchases · \(usd(purchases(c).reduce(0) { $0 + $1.amount_cents })) spent")
                            .font(.caption2).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .card()
    }

    private var agentsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Agent")
            if agents.isEmpty {
                Text("Setting up.").font(.footnote).foregroundStyle(Theme.ink3)
            }
            ForEach(agents) { a in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.name).font(.subheadline.weight(.semibold))
                        Text(a.frozen ? "Frozen" : "Active · policy v\(a.policy_version)").font(.caption2).foregroundStyle(a.frozen ? Theme.shield : Theme.up)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(usd(a.balance_cents)).font(.system(size: 17, weight: .semibold, design: .serif))
                        Text("\(usd(a.leftCents)) of \(usd(a.policy.budget_cents)) left").font(.caption2).foregroundStyle(Theme.ink3)
                    }
                }
            }
            if !agents.isEmpty {
                SecondaryButton(title: agents.allSatisfy(\.frozen) ? "Agent frozen" : "Freeze agent", icon: "snowflake", tone: Theme.shield, enabled: !(busy || agents.allSatisfy(\.frozen))) { confirmFreezeAll = true }
            }
        }
        .card()
    }

    private func settings(_ p: Person) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Button { withAnimation(.easeInOut(duration: 0.2)) { showSettings.toggle() } } label: {
                HStack {
                    SectionLabel(text: "Settings")
                    Spacer()
                    Image(systemName: showSettings ? "chevron.up" : "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                }
            }
            .buttonStyle(.plain)
            if showSettings {
                row("Name", p.name)
                row("Birthday", birthday(p.birthday))
                if let e = p.email { row("Email", e) }
                row("Member for", memberFor(p.created))
                Divider().overlay(Theme.line)
                TextField("https://service-address", text: $settings.baseURL)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.footnote.monospaced())
                    .field()
                row("Service", status)
                row("NFC", NFCReader.available ? "available" : "not on this device", tone: NFCReader.available ? Theme.up : Theme.down)
                SecondaryButton(title: "Test connection", icon: "antenna.radiowaves.left.and.right") { Task { await test() } }
                Divider().overlay(Theme.line)
                TextField("Send the USDC to (optional wallet address)", text: $sweepTo)
                    .font(.footnote).autocorrectionDisabled().textInputAutocapitalization(.never)
                    .field()
            }
            if let error { Text(error).font(.caption2).foregroundStyle(Theme.down) }
            SecondaryButton(title: busy ? "Closing…" : "Close account", icon: "xmark.circle", tone: Theme.down, enabled: !busy) { confirmDelete = true }
        }
        .card()
    }

    private var service: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Service")
            TextField("https://service-address", text: $settings.baseURL)
                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                .font(.footnote.monospaced())
                .field()
            row("Status", status)
            SecondaryButton(title: "Test connection", icon: "antenna.radiowaves.left.and.right") { Task { await test() } }
        }
        .card()
    }

    private var chainRows: [ChainRow] {
        var out: [ChainRow] = []
        if let p = person, let sig = p.wallet_sig, !sig.isEmpty {
            out.append(ChainRow(id: "w" + sig, ts: p.created, title: "Wallet created", detail: "your own Solana account", sig: sig, tone: Theme.ink2))
        }
        for c in cards {
            if let sig = c.register_sig, !sig.isEmpty {
                out.append(ChainRow(id: "r" + sig, ts: c.created, title: "Card issued", detail: "•••• \(c.card_number.suffix(4))", sig: sig, tone: Theme.pink))
            }
            for h in c.history where !h.sig.isEmpty {
                out.append(ChainRow(id: h.sig + h.kind, ts: h.ts, title: historyTitle(h), detail: historyDetail(h, c), sig: h.sig, tone: historyTone(h)))
            }
        }
        for a in agents {
            if let sig = a.register_sig, !sig.isEmpty {
                out.append(ChainRow(id: "a" + sig, ts: a.created, title: "Agent created", detail: a.name, sig: sig, tone: Theme.pink))
            }
            if let sig = a.policy_sig, !sig.isEmpty {
                out.append(ChainRow(id: "y" + sig, ts: a.policy_ts ?? a.last_used, title: "Rules changed", detail: "\(a.name) · policy v\(a.policy_version)", sig: sig, tone: Theme.pink))
            }
            for p in a.purchases {
                if let sig = p.sig, !sig.isEmpty {
                    out.append(ChainRow(id: "p" + sig, ts: p.ts, title: p.approved ? "\(a.name) paid \(usd(p.amount_cents))" : "\(a.name) stopped", detail: "\(p.item) at \(p.merchant)", sig: sig, tone: p.approved ? Theme.up : Theme.shield))
                }
            }
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0.sig).inserted }.sorted { $0.ts > $1.ts }.prefix(12).map { $0 }
    }

    private func historyTitle(_ h: HistoryItem) -> String {
        switch h.kind {
        case "tap": return h.approved == true ? "Paid \(usd(h.amount_cents))" : "Declined \(usd(h.amount_cents))"
        case "deposit": return "Loaded \(usd(h.amount_cents))"
        case "withdraw": return "Withdrew \(usd(h.amount_cents))"
        case "freeze": return "Lock changed"
        case "agent_fund": return "Loaded \(h.agent ?? "agent") \(usd(h.amount_cents))"
        case "agent_clawback": return "Took back \(usd(h.amount_cents))"
        default: return h.kind.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func historyDetail(_ h: HistoryItem, _ c: Account) -> String {
        switch h.kind {
        case "tap": return [h.item, h.merchant].compactMap { $0 }.joined(separator: " at ")
        case "deposit": return h.source == "wallet" ? "from your wallet" : "onto •••• \(c.card_number.suffix(4))"
        case "withdraw": return "to \(short(h.to_wallet ?? "", 4))"
        case "freeze": return h.by == "cardholder" ? "by you" : "by the issuer"
        default: return "•••• \(c.card_number.suffix(4))"
        }
    }

    private func historyTone(_ h: HistoryItem) -> Color {
        switch h.kind {
        case "tap": return h.approved == true ? Theme.up : Theme.shield
        case "deposit", "agent_clawback": return Theme.up
        case "freeze": return Theme.shield
        default: return Theme.ink2
        }
    }

    private func keyRow(_ label: String, _ key: String) -> some View {
        Button { openURL(addressURL(key)) } label: {
            HStack {
                Text(label).font(.subheadline).foregroundStyle(.white)
                Spacer()
                Text(short(key, 6)).font(.footnote.monospaced()).foregroundStyle(Theme.ink2)
                Image(systemName: "arrow.up.right").font(.caption2.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
        }
        .buttonStyle(.plain)
    }

    private func row(_ label: String, _ value: String, tone: Color? = nil) -> some View {
        HStack {
            Text(label).font(.subheadline)
            Spacer()
            Text(value).font(.subheadline).foregroundStyle(tone ?? Theme.ink2).multilineTextAlignment(.trailing)
        }
    }

    private func when(_ ts: Double) -> String {
        let d = Date(timeIntervalSince1970: ts)
        return Calendar.current.isDateInToday(d) ? d.formatted(date: .omitted, time: .shortened) : d.formatted(.dateTime.month(.abbreviated).day())
    }

    private func short(_ s: String, _ n: Int) -> String {
        s.count > n * 2 + 1 ? String(s.prefix(n)) + "…" + String(s.suffix(n)) : s
    }

    private func addressURL(_ key: String) -> URL {
        URL(string: "https://explorer.solana.com/address/\(key)?cluster=devnet")!
    }

    private func txURL(_ sig: String) -> URL {
        URL(string: "https://explorer.solana.com/tx/\(sig)?cluster=devnet")!
    }

    private func purchases(_ a: Account) -> [HistoryItem] {
        a.history.filter { $0.kind == "tap" && $0.approved == true }
    }

    private func birthday(_ iso: String) -> String {
        guard let d = try? Date(iso, strategy: .iso8601.year().month().day()) else { return iso }
        return d.formatted(date: .long, time: .omitted)
    }

    private func memberFor(_ ts: Double) -> String {
        let days = Int(Date().timeIntervalSince1970 - ts) / 86_400
        switch days {
        case 0: return "since today"
        case 1: return "1 day"
        default: return "\(days) days"
        }
    }

    private func load() async {
        guard !personID.isEmpty else { person = nil; cards = []; agents = []; return }
        do {
            let p = try await api.person(id: personID)
            let all = (try? await api.accounts()) ?? []
            person = p
            cards = all.filter { p.cards.contains($0.uid) }
            agents = ((try? await api.agents(personID: personID)) ?? []).sorted { $0.created < $1.created }
            if let w = try? await api.walletInfo(personID: personID) {
                if w.address != wallet?.address { qr = makeQR(w.address) }
                wallet = w
            }
        } catch {
            person = nil
            cards = []
            agents = []
        }
    }

    private func freezeAll() {
        busy = true
        Task {
            do { _ = try await api.freezeAll(personID: personID); await load() }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func deleteAccount(_ p: Person) {
        busy = true
        Task {
            do {
                let dest = sweepTo.trimmingCharacters(in: .whitespacesAndNewlines)
                let r = try await api.deletePerson(id: p.id, toWallet: dest.isEmpty ? nil : dest)
                UserDefaults.standard.removeObject(forKey: "cardUID")
                OwnerToken.clear()
                let usdc = r.wallet?.usdc ?? "0"
                let to = r.wallet?.to_wallet.map { String($0.prefix(4)) + "…" + String($0.suffix(4)) } ?? "the issuer"
                note = "Account deleted. \(usdc) USDC sent to \(to)."
                error = nil
                person = nil
                cards = []
                agents = []
                wallet = nil
                personID = ""
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func makeQR(_ text: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let img = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cg = CIContext().createCGImage(img, from: img.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    private func test() async {
        do {
            let h = try await api.health()
            let model = (h["model"]?.value as? Bool) == true
            let chain = h["chain"]?.value as? String
            program = h["program"]?.value as? String
            config = h["config"]?.value as? String
            status = "ok · model \(model ? "loaded" : "rules only") · chain \(chain == nil ? "off" : "on")"
        } catch {
            status = "unreachable"
        }
    }
}
