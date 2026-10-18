import SwiftUI

struct OnboardingView: View {
    let api: API
    let onFinished: (String) -> Void

    enum Step { case scan, pick, issuing, issued, fund }
    @State private var step: Step = .scan
    @State private var uid: String?
    @State private var people: [Person] = []
    @State private var chosen: Person?
    @State private var account: Account?
    @State private var error: String?
    @State private var busy = false
    @State private var sheet: WalletSheet.Mode?
    @State private var pulse = false
    @StateObject private var nfc = NFCReader()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    HStack(spacing: 8) { RibbonS(size: 22); Wordmark(size: 18) }
                    Spacer()
                    if step != .issuing { Button("Close") { dismiss() }.font(.footnote).foregroundStyle(Theme.ink3) }
                }
                .padding(20)
                Spacer(minLength: 0)
                Group {
                    switch step {
                    case .scan: scan
                    case .pick: pick
                    case .issuing: issuing
                    case .issued: issued
                    case .fund: fund
                    }
                }
                .padding(.horizontal, 24)
                .transition(.opacity.combined(with: .move(edge: .trailing)))
                Spacer(minLength: 0)
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.down)
                        .multilineTextAlignment(.center).padding(.horizontal, 24).padding(.bottom, 12)
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: step)
        .task { await loadPeople() }
        .task {
            try? await Task.sleep(for: .milliseconds(350))
            readCard()
        }
        .sheet(item: $sheet) { m in
            if let a = account { WalletSheet(account: a, api: api, mode: m) { sheet = nil; Task { await reload() } } }
        }
    }

    private var scan: some View {
        VStack(spacing: 22) {
            ZStack {
                ForEach(0..<3, id: \.self) { i in
                    Circle().stroke(Theme.pink.opacity(0.5 - Double(i) * 0.15), lineWidth: 2)
                        .frame(width: 140 + CGFloat(i) * 50, height: 140 + CGFloat(i) * 50)
                        .scaleEffect(pulse ? 1.08 : 0.94)
                        .animation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true).delay(Double(i) * 0.2), value: pulse)
                }
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.surface2)
                    .frame(width: 110, height: 70).overlay(RibbonS(size: 26))
            }
            .frame(height: 260)
            .onAppear { pulse = true }
            Text("Hold the blank card to the top of the phone").font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            Text("The card's serial number is read. Nothing is written to the card.")
                .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
            if !busy { primary("Scan again") { readCard() } }
            #if targetEnvironment(simulator)
            Button("Simulate a blank card") {
                uid = "04" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)).lowercased()
                step = .pick
            }
            .font(.footnote).foregroundStyle(Theme.ink3)
            #endif
        }
    }

    private var pick: some View {
        VStack(spacing: 18) {
            Label("Card •••• \((uid ?? "").suffix(4).uppercased()) detected", systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.up)
            Text("Issue this card to").font(.system(size: 28, weight: .semibold, design: .serif))
            if people.isEmpty {
                Text("Open an account first.")
                    .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
            } else {
                VStack(spacing: 8) {
                    ForEach(people) { p in
                        Button { chosen = p } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.name).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                                    Text(memberSince(p)).font(.caption2).foregroundStyle(Theme.ink3)
                                }
                                Spacer()
                                Image(systemName: chosen?.id == p.id ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(chosen?.id == p.id ? Theme.pink : Theme.ink3)
                            }
                            .padding(14).background(Theme.surface2)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            primary("Issue card") { issue() }.disabled(chosen == nil)
        }
    }

    private var issuing: some View {
        VStack(spacing: 18) {
            ProgressView().tint(Theme.pink).scaleEffect(1.6).padding(.bottom, 10)
            Text("Issuing your card on Solana…").font(.title3.weight(.semibold))
            Text("A card account is being written on chain with its spend limit and status.")
                .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
        }
    }

    private var issued: some View {
        VStack(spacing: 18) {
            if let a = account {
                Text("Your card is live").font(.system(size: 30, weight: .semibold, design: .serif))
                CardArt(account: a)
                Text("Card number \(a.card_number.chunked(4)) · issued to \(a.name)")
                    .font(.footnote).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                if let sig = a.register_sig, let u = URL(string: "https://explorer.solana.com/tx/\(sig)?cluster=devnet") {
                    Link(destination: u) {
                        Label("View the issuance on Solana", systemImage: "arrow.up.right.square").font(.footnote.weight(.semibold))
                    }
                    .foregroundStyle(Theme.pink)
                }
                primary("Add money") { step = .fund }
            }
        }
    }

    private var fund: some View {
        VStack(spacing: 16) {
            Text("Spending power").font(.footnote).foregroundStyle(Theme.ink3)
            Text(usd(account?.balance_cents ?? 0))
                .font(.system(size: 54, weight: .regular, design: .serif)).contentTransition(.numericText())
            Text("USDC on your card. Load it from your own wallet; the card is credited on chain in the same transaction.")
                .font(.footnote).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            primary("Load from wallet") { sheet = .load }
            HStack(spacing: 8) {
                ForEach([2000, 5000], id: \.self) { c in
                    Button {
                        busy = true
                        Task {
                            do { _ = try await api.deposit(uid: account?.uid ?? "", cents: c); error = nil; await reload() }
                            catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    } label: {
                        Text("+" + usd(c).replacingOccurrences(of: ".00", with: ""))
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.plain).disabled(busy)
                }
            }
            Text("test funds from the issuer, credited on chain").font(.caption2).foregroundStyle(Theme.ink3)
            Button((account?.balance_cents ?? 0) > 0 ? "Done, show my card" : "Skip for now") {
                if let a = account { onFinished(a.uid) } else { dismiss() }
            }
            .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
            .frame(maxWidth: .infinity).padding(.vertical, 16)
            .background(Theme.surface2).clipShape(Capsule())
        }
    }

    private func loadPeople() async {
        let mine = UserDefaults.standard.string(forKey: "personID") ?? ""
        if !mine.isEmpty, let p = try? await api.person(id: mine) { people = [p] } else { people = [] }
        chosen = people.first
    }

    private func memberSince(_ p: Person) -> String {
        "member since " + Date(timeIntervalSince1970: p.created).formatted(date: .abbreviated, time: .omitted)
    }

    private func readCard() {
        busy = true
        error = nil
        nfc.read(prompt: "Hold the new Settld card to the top of the phone") { res in
            busy = false
            switch res {
            case .success(let id): uid = id; step = .pick
            case .failure(let e): if !(e is CancellationError) { error = e.localizedDescription }
            }
        }
    }

    private func issue() {
        guard let uid, let chosen else { return }
        step = .issuing
        error = nil
        Task {
            do {
                account = try await api.register(uid: uid, personID: chosen.id)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                step = .issued
            } catch {
                self.error = error.localizedDescription
                step = .pick
            }
        }
    }

    private func reload() async {
        if let u = account?.uid, let a = try? await api.account(uid: u) { account = a }
    }

    private func primary(_ title: String, action: @escaping () -> Void) -> some View {
        PrimaryButton(title: title, action: action)
    }
}
