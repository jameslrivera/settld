import SwiftUI
import CoreImage.CIFilterBuiltins

struct WalletSheet: View {
    enum Mode: String, Identifiable { case load, fund, withdraw; var id: String { rawValue } }
    let account: Account
    let api: API
    let mode: Mode
    let onDone: () -> Void

    @State private var amount = "20"
    @State private var wallet = ""
    @State private var busy = false
    @State private var qr: UIImage?
    @State private var url = ""
    @State private var reference: String?
    @State private var confirmed: FundStatus?
    @State private var result: String?
    @State private var resultSig: String?
    @State private var error: String?
    @State private var own: WalletInfo?
    @State private var openAccess = false

    private var cents: Int { centsFrom(amount) }
    private func testFunds(_ c: Int) {
        busy = true
        error = nil
        Task {
            do {
                _ = try await api.deposit(uid: account.uid, cents: c)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onDone()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }

    private func tx(_ sig: String) -> URL? { URL(string: "https://explorer.solana.com/tx/\(sig)?cluster=devnet") }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 8) {
                    Text(mode == .load ? "Load from wallet" : mode == .fund ? "Fund from any wallet" : "Withdraw to wallet").font(.title2.weight(.semibold))
                }
                Text(mode == .load ? "From your wallet onto this card." : mode == .fund ? "From Phantom or any Solana wallet." : "From this card back to your wallet.")
                    .font(.footnote).foregroundStyle(Theme.ink2)

                if mode == .load {
                    HStack {
                        Text("In your wallet").foregroundStyle(Theme.ink3)
                        Spacer()
                        Text(own.map { "\($0.usdc ?? "0") USDC" } ?? "…").font(.subheadline.weight(.semibold))
                    }
                    .padding(12).background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: 12))
                    if openAccess || !(UserDefaults.standard.string(forKey: "adminToken") ?? "").isEmpty {
                        HStack(spacing: 8) {
                            ForEach([2000, 5000, 10000], id: \.self) { c in
                                Button { testFunds(c) } label: {
                                    Text("+" + usd(c).replacingOccurrences(of: ".00", with: ""))
                                        .font(.subheadline.weight(.semibold))
                                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                                        .background(Theme.surface)
                                        .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                                        .clipShape(Capsule())
                                }
                                .buttonStyle(.plain).disabled(busy)
                            }
                        }
                        Text("Test funds from the issuer").font(.caption2).foregroundStyle(Theme.ink3)
                    }
                }

                HStack(spacing: 8) {
                    ForEach(["5", "20", "50"], id: \.self) { a in
                        Button("$\(a)") { amount = a }.buttonStyle(.bordered).tint(amount == a ? Theme.pink : Theme.ink3)
                    }
                    TextField("Amount", text: $amount).keyboardType(.decimalPad)
                        .padding(10).background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 10)).frame(width: 90)
                }

                if mode == .withdraw {
                    TextField("Your Solana wallet address", text: $wallet)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().font(.footnote.monospaced())
                        .padding(14).background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 14))
                }

                if mode == .fund, let qr {
                    VStack(spacing: 10) {
                        Image(uiImage: qr).interpolation(.none).resizable()
                            .frame(width: 220, height: 220).padding(10).background(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                        if let c = confirmed {
                            Text("Funded · +\(usd(c.amount_cents ?? 0)) USDC").font(.headline).foregroundStyle(Theme.up)
                            if let e = c.explorer, let u = URL(string: e) { Link("View on Solana", destination: u).font(.footnote) }
                        } else {
                            HStack(spacing: 6) { ProgressView().tint(Theme.pink); Text("Waiting for payment…").font(.footnote).foregroundStyle(Theme.ink3) }
                            Button {
                                if let u = URL(string: url) { UIApplication.shared.open(u) }
                            } label: {
                                Label("Open in wallet app", systemImage: "arrow.up.forward.app")
                                    .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                                    .background(Theme.surface2).clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            Text("Or scan the code with a wallet on another device.").font(.caption2).foregroundStyle(Theme.ink3)
                            Button("Copy payment link") { UIPasteboard.general.string = url }.font(.footnote)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }

                if let result {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(result).font(.headline).foregroundStyle(Theme.up)
                        if let s = resultSig, let u = tx(s) { Link("View on Solana", destination: u).font(.footnote) }
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.down) }

                Spacer()

                if mode == .fund && qr == nil {
                    Button(busy ? "Creating request…" : "Show code for \(usd(cents))") { Task { await startFund() } }
                        .disabled(busy || cents <= 0)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(Theme.pinkGradient).foregroundStyle(.white).clipShape(Capsule())
                } else if mode == .load && result == nil {
                    Button(busy ? "Loading on Solana…" : "Load \(usd(cents)) onto card") { Task { await doLoad() } }
                        .disabled(busy || cents <= 0 || (Double(own?.usdc ?? "0") ?? 0) * 100 < Double(cents))
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(cents > 0 ? Theme.pink : Theme.surface2)
                        .foregroundStyle(.white).clipShape(Capsule())
                } else if mode == .withdraw && result == nil {
                    Button(busy ? "Sending on Solana…" : "Send \(usd(cents)) USDC") { Task { await doWithdraw() } }
                        .disabled(busy || cents <= 0 || wallet.count < 32 || cents > account.balance_cents)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(cents > 0 && wallet.count >= 32 ? Theme.pink : Theme.surface2)
                        .foregroundStyle(.white).clipShape(Capsule())
                } else {
                    Button("Done", action: onDone)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(Theme.surface2).foregroundStyle(.white).clipShape(Capsule())
                }
            }
            .padding(20)
        }
        .presentationDetents([.large])
        .task { if let h = try? await api.health(), (h["auth"]?.value as? String) == "off" { openAccess = true } }
        .presentationDragIndicator(.visible)
        .task {
            guard let pid = account.person_id, let w = try? await api.walletInfo(personID: pid) else { return }
            own = w
            if mode == .withdraw && wallet.isEmpty { wallet = w.address }
        }
    }

    private func doLoad() async {
        busy = true; error = nil
        do {
            _ = try await api.load(uid: account.uid, cents: cents)
            result = "Loaded \(usd(cents)) USDC onto the card"
            if let pid = account.person_id { own = try? await api.walletInfo(personID: pid) }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch { self.error = error.localizedDescription }
        busy = false
    }

    private func startFund() async {
        busy = true; error = nil
        do {
            let r = try await api.fund(uid: account.uid, cents: cents)
            url = r.url
            reference = r.reference
            qr = makeQR(r.url)
            Task { await pollFund() }
        } catch { self.error = error.localizedDescription }
        busy = false
    }

    private func pollFund() async {
        guard let ref = reference else { return }
        for _ in 0..<200 {
            try? await Task.sleep(for: .seconds(3))
            if let st = try? await api.fundStatus(reference: ref), st.status == "confirmed" {
                confirmed = st
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                return
            }
        }
    }

    private func doWithdraw() async {
        busy = true; error = nil
        do {
            let to = wallet.trimmingCharacters(in: .whitespaces)
            let r = try await api.withdraw(uid: account.uid, cents: cents, toWallet: to)
            result = "Sent \(usd(cents)) USDC to \(to.prefix(4))…\(to.suffix(4))"
            resultSig = r.sig
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch { self.error = error.localizedDescription }
        busy = false
    }

    private func makeQR(_ text: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let img = f.outputImage else { return nil }
        let scaled = img.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
