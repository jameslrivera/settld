import SwiftUI

struct CardholderView: View {
    @EnvironmentObject var settings: Settings
    @State private var accounts: [Account] = []
    @State private var selectedUID: String? = UserDefaults.standard.string(forKey: "cardUID")
    @State private var merchants: [Merchant] = []
    @State private var agents: [Agent] = []
    @State private var busy = false
    @State private var error: String?
    @State private var sheet: WalletSheet.Mode?
    @State private var reveal = false
    @State private var detail: HistoryItem?
    @State private var onboarding = false
    @State private var confirmClose = false
    @State private var closedNote: String?

    private var api: API { API(base: settings.baseURL) }
    private var account: Account? { accounts.first { $0.uid == selectedUID } }
    private func activity(_ a: Account) -> [HistoryItem] {
        let bought = agents.flatMap { ag in
            ag.purchases.map { p in
                HistoryItem(kind: "agent", amount_cents: p.amount_cents, ts: p.ts, sig: p.sig ?? "", merchant: p.merchant, merchant_id: nil, item: p.item,
                            approved: p.approved, score: nil, source: nil, from_wallet: nil, to_wallet: nil, by: nil,
                            latency_ms: p.latency_ms.map(Double.init), reasons: nil, settle_sig: nil, agent: ag.name)
            }
        }
        return (a.history + bought).sorted { $0.ts > $1.ts }
    }
    private func remember(_ uid: String?) {
        selectedUID = uid
        if let uid { UserDefaults.standard.set(uid, forKey: "cardUID") } else { UserDefaults.standard.removeObject(forKey: "cardUID") }
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    if let error, !accounts.isEmpty {
                        Label(error, systemImage: "wifi.exclamationmark")
                            .font(.caption).foregroundStyle(Theme.shield)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.shield.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    if let a = account { card(a) } else { empty }
                }
                .padding(20)
                .padding(.bottom, 24)
            }
        }
        .task {
            await refresh()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                await refresh()
            }
        }
        .task { merchants = (try? await api.merchants()) ?? [] }
        .refreshable { await refresh() }
        .sheet(item: $sheet) { m in
            if let a = account { WalletSheet(account: a, api: api, mode: m) { sheet = nil; Task { await refresh() } } }
        }
        .sheet(item: $detail) { h in
            if let a = account {
                TransactionDetail(h: h, account: a, merchant: merchants.first { $0.id == h.merchant_id }) {
                    detail = nil
                    Task { _ = try? await api.setLock(uid: a.uid, locked: true); await refresh() }
                }
            }
        }
        .confirmationDialog("Close this card?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Close card", role: .destructive) { close() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The balance goes back to your wallet, the card is frozen on Solana, and it is removed from your account.")
        }
        .fullScreenCover(isPresented: $onboarding) {
            OnboardingView(api: api) { uid in
                onboarding = false
                remember(uid)
                Task { await refresh() }
            }
            .environmentObject(settings)
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 8) { RibbonS(size: 26); Wordmark(size: 22) }
            Spacer()
            Button { onboarding = true } label: {
                Image(systemName: "plus").font(.footnote.weight(.semibold)).padding(8).background(Theme.surface2).clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
    }

    private var empty: some View {
        VStack(spacing: 14) {
            if let closedNote {
                Text(closedNote).font(.footnote).foregroundStyle(Theme.up).multilineTextAlignment(.center)
            }
            RibbonS(size: 56)
            Text("No card yet").font(.system(size: 28, weight: .semibold, design: .serif))
            Text(error ?? "Hold a blank Settld card to your phone.")
                .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
            PrimaryButton(title: "Issue a card", icon: "wave.3.right") { onboarding = true }.padding(.top, 6)
        }
        .frame(maxWidth: .infinity).padding(.top, 70)
    }

    @ViewBuilder
    private func card(_ a: Account) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: "Spending power")
            HeroAmount(cents: a.balance_cents)
        }

        CardArt(account: a, masked: !reveal)
            .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { reveal.toggle() } }
            .onChange(of: a.uid) { _, _ in reveal = false }
        if a.status == "blocked" {
            Label(a.closed == true ? "Closed" : "Locked", systemImage: a.closed == true ? "xmark.circle.fill" : "lock.fill")
                .font(.caption2.weight(.semibold)).foregroundStyle(a.closed == true ? Theme.down : Theme.shield)
        }

        if a.closed == true {
            Text("This card is closed.")
                .font(.footnote).foregroundStyle(Theme.ink3).frame(maxWidth: .infinity).padding(14)
                .background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        } else {
        HStack(spacing: 8) {
            Button { sheet = .load } label: { pill("Load", icon: "arrow.down.circle") }.buttonStyle(.plain)
            Button { sheet = .withdraw } label: { pill("Withdraw", icon: "arrow.up.right") }
                .buttonStyle(.plain).disabled(a.status == "blocked")
            Button {
                busy = true
                Task {
                    _ = try? await api.setLock(uid: a.uid, locked: a.status != "blocked")
                    await refresh()
                    busy = false
                }
            } label: {
                pill(a.status == "blocked" ? "Unlock" : "Lock",
                     icon: a.status == "blocked" ? "lock.open" : "lock",
                     tone: a.status == "blocked" ? Theme.shield : nil)
            }
            .buttonStyle(.plain).disabled(busy)
        }
        }

        let paid = a.history.filter { $0.kind == "tap" && ($0.approved ?? false) }
        let stopped = a.history.filter { $0.kind == "tap" && !($0.approved ?? true) }
        HStack(spacing: 10) {
            summary("Spent", usd(paid.reduce(0) { $0 + $1.amount_cents }), "")
            summary("Protected", usd(stopped.reduce(0) { $0 + $1.amount_cents }), "", tone: stopped.isEmpty ? nil : Theme.shield)
            summary("Left today", usd(max(0, a.daily_limit_cents - a.spent_today_cents)), "")
        }

        VStack(alignment: .leading, spacing: 0) {
            SectionLabel(text: "Activity").padding(.bottom, 10)
            let rows = activity(a)
            if rows.isEmpty {
                Text("Nothing yet.").font(.footnote).foregroundStyle(Theme.ink3)
            }
            ForEach(Array(rows.prefix(16).enumerated()), id: \.offset) { _, h in
                HistoryRow(h: h).contentShape(Rectangle()).onTapGesture { detail = h }
                Divider().overlay(Theme.line)
            }
        }
        .card()

        if a.closed != true {
            SecondaryButton(title: "Close card", icon: "xmark.circle", tone: Theme.down, enabled: !busy) { confirmClose = true }
        }
    }

    private func close() {
        guard let a = account else { return }
        busy = true
        Task {
            do {
                let r = try await api.closeCard(uid: a.uid)
                if let e = r.error { throw APIError.refused(e) }
                let back = Double(r.swept_cents ?? 0) / 100
                closedNote = back > 0
                    ? "Card •••• \(a.card_number.suffix(4)) closed. $\(String(format: "%.2f", back)) USDC sent back to your wallet."
                    : "Card •••• \(a.card_number.suffix(4)) closed."
                error = nil
                remember(nil)
                await refresh()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func summary(_ label: String, _ value: String, _ sub: String, tone: Color? = nil) -> some View {
        StatTile(label: label, value: value, sub: sub, tone: tone ?? .white)
    }

    private func pill(_ text: String, icon: String, tone: Color? = nil) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.body.weight(.semibold))
            Text(text).font(.caption.weight(.semibold))
        }
        .foregroundStyle(tone ?? .white)
        .frame(maxWidth: .infinity)
        .frame(height: 66)
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
    }

    private func refresh() async {
        do {
            accounts = try await api.accounts()
            if let pid = account?.person_id { agents = (try? await api.agents(personID: pid)) ?? agents }
            error = nil
        } catch {
            self.error = "Can't reach the service. Check the address in Settings."
        }
    }
}

struct HistoryRow: View {
    let h: HistoryItem
    private var deposit: Bool { h.kind == "deposit" }
    private var ok: Bool { h.approved ?? true }
    private var byAgent: Bool { h.kind == "agent" }
    private var title: String {
        switch h.kind {
        case "deposit": return h.source == "wallet" ? "Funded from wallet" : "Added money"
        case "withdraw": return "Withdrawn to wallet"
        case "freeze": return h.by == "cardholder" ? "You locked the card" : "Card frozen by the issuer"
        case "unfreeze": return "Card unlocked"
        case "agent_fund": return "Moved to your agent"
        case "agent_clawback": return "Back from your agent"
        default: return h.item ?? "Purchase"
        }
    }
    private var amountText: String {
        if h.kind == "freeze" || h.kind == "unfreeze" { return "" }
        return (deposit || h.kind == "agent_clawback" ? "+" : "−") + usd(h.amount_cents)
    }
    private var status: String {
        switch h.kind {
        case "deposit": return "Available"
        case "withdraw": return "Sent"
        case "freeze": return "Locked"
        case "unfreeze": return "Active"
        case "agent_fund", "agent_clawback": return "Agent"
        case "agent": return ok ? "Paid by agent" : "Stopped"
        default: return ok ? "Paid" : "Protected"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(deposit ? Theme.up.opacity(0.15) : ok ? Theme.surface2 : Theme.shield.opacity(0.15)).frame(width: 36, height: 36)
                if byAgent || h.kind == "agent_fund" || h.kind == "agent_clawback" {
                    Image(systemName: "sparkles").font(.caption.weight(.semibold)).foregroundStyle(Theme.pink)
                } else if h.kind == "freeze" || h.kind == "unfreeze" {
                    Image(systemName: h.kind == "freeze" ? "lock.fill" : "lock.open.fill")
                        .font(.caption).foregroundStyle(Theme.shield)
                } else {
                    Text(deposit ? "+" : h.kind == "withdraw" ? "↑" : String((h.merchant ?? "?").prefix(1)))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(deposit ? Theme.up : ok ? .white : Theme.shield)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.medium))
                Text((deposit ? "USDC" : byAgent ? "Agent · \(h.merchant ?? "")" : h.kind == "agent_fund" || h.kind == "agent_clawback" ? (h.agent ?? "Agent") : (h.merchant ?? "")) + " · " + Date(timeIntervalSince1970: h.ts).formatted(date: .omitted, time: .shortened))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(amountText).font(.subheadline.weight(.semibold))
                    .foregroundStyle(deposit ? Theme.up : ((h.kind == "tap" || byAgent) && !ok) ? Theme.shield : .white)
                    .strikethrough((h.kind == "tap" || byAgent) && !ok)
                Text(status).font(.caption2).foregroundStyle(Theme.ink3)
            }
        }
        .padding(.vertical, 8)
    }
}

extension HistoryItem: Identifiable { var id: String { sig + String(ts) } }

struct TransactionDetail: View {
    let h: HistoryItem
    let account: Account
    let merchant: Merchant?
    let onReport: () -> Void

    private var isTap: Bool { h.kind == "tap" }
    private var ok: Bool { h.approved ?? true }
    private var title: String {
        switch h.kind {
        case "deposit": return h.source == "wallet" ? "Funded from wallet" : "Money added"
        case "withdraw": return "Withdrawn to wallet"
        case "freeze": return h.by == "cardholder" ? "You locked the card" : "Card frozen by the issuer"
        case "unfreeze": return "Card unlocked"
        default: return h.item ?? "Purchase"
        }
    }
    private var statusTone: Color { isTap ? (ok ? Theme.up : Theme.shield) : h.kind == "deposit" ? Theme.up : .white }
    private var amountTone: Color { h.kind == "deposit" ? Theme.up : isTap && !ok ? Theme.shield : .white }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.title2.weight(.semibold))
                    if h.kind != "freeze" && h.kind != "unfreeze" {
                        Text((h.kind == "deposit" ? "+" : "−") + usd(h.amount_cents))
                            .font(.system(size: 44, weight: .regular, design: .serif))
                            .foregroundStyle(amountTone).strikethrough(isTap && !ok)
                    }
                    Text(Date(timeIntervalSince1970: h.ts).formatted(date: .abbreviated, time: .shortened))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
                if isTap {
                    VStack(alignment: .leading, spacing: 10) {
                        row("Status", ok ? "Paid · settled to the shop" : "Protected · not charged", statusTone)
                        if let m = merchant { row("Where", "\(m.name)\n\(m.address ?? "")") } else if let n = h.merchant { row("Where", n) }
                        if let l = h.latency_ms { row(ok ? "Settled in" : "Decided in", "\(Int(l)) ms") }
                        if let s = h.score { row("Risk score", String(format: "%.2f", s) + (ok ? " · below the 0.80 line" : " · over the 0.80 line")) }
                        if !ok, let rs = h.reasons, !rs.isEmpty {
                            row("Why stopped", rs.prefix(2).map { plain($0.feature) }.joined(separator: ", "))
                        }
                    }
                    .card()
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        if let w = h.from_wallet { row("From wallet", w) }
                        if let w = h.to_wallet { row("To wallet", w) }
                        if h.kind == "deposit" && h.source != "wallet" { row("Source", "Issuer, credited on chain") }
                        row("Card", "•••• " + account.card_number.suffix(4))
                    }
                    .card()
                }
                if let u = URL(string: "https://explorer.solana.com/tx/\(h.sig)?cluster=devnet") {
                    Link(destination: u) {
                        HStack {
                            Image(systemName: "link")
                            Text("View on Solana Explorer")
                            Spacer()
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.subheadline.weight(.medium)).padding(14)
                        .background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
                if isTap && ok && account.status != "blocked" {
                    Button(action: onReport) {
                        HStack { Image(systemName: "exclamationmark.shield"); Text("Not me? Lock the card now") }
                            .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity).padding(14)
                            .background(Theme.shield.opacity(0.15)).foregroundStyle(Theme.shield)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
                Spacer()
            }
            .padding(20)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ k: String, _ v: String, _ tone: Color = .white) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(k).font(.footnote).foregroundStyle(Theme.ink3).frame(width: 110, alignment: .leading)
            Text(v).font(.footnote).foregroundStyle(tone).textSelection(.enabled)
                .lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
