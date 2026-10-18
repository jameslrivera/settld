import SwiftUI

struct PassportSheet: View {
    let agentID: String
    let api: API
    @State private var pp: Passport?
    @State private var error: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        SectionLabel(text: "Agent passport")
                        Spacer()
                        if pp?.signature != nil {
                            Label("Signed by Settld", systemImage: "checkmark.seal.fill").font(.caption.weight(.semibold)).foregroundStyle(Theme.up)
                        }
                    }
                    if let d = pp?.passport {
                        Text(d.name).font(.system(size: 30, weight: .regular, design: .serif))
                        Text("for \(d.owner_name)").font(.subheadline).foregroundStyle(Theme.ink2)
                        HStack(spacing: 10) {
                            StatTile(label: "Paid", value: "\(d.purchases)", sub: "")
                            StatTile(label: "Stopped", value: "\(d.stopped)", sub: "", tone: d.stopped > 0 ? Theme.shield : .white)
                            StatTile(label: "Rules", value: "v\(d.policy_version)", sub: "")
                        }
                        VStack(alignment: .leading, spacing: 12) {
                            row("Agent", short(d.agent_pda), url: d.agent_pda.flatMap { URL(string: "https://explorer.solana.com/address/\($0)?cluster=devnet") })
                            row("Signing key", short(d.agent_key))
                            row("Rules hash", short(d.policy_hash))
                            row("Record", d.chain_head.map { short($0) + " · \(d.chain_len ?? 0)" } ?? "—")
                            row("Status", d.frozen ? "Frozen" : "Active", tone: d.frozen ? Theme.shield : Theme.up)
                            row("Since", Date(timeIntervalSince1970: d.created).formatted(date: .abbreviated, time: .omitted))
                        }
                        .card()
                        Text(d.policy_text).font(.caption).foregroundStyle(Theme.ink3)
                    } else if let error {
                        Text(error).font(.footnote).foregroundStyle(Theme.down)
                    } else {
                        ProgressView().tint(Theme.pink)
                    }
                }
                .padding(20)
            }
        }
        .presentationDetents([.large])
        .task {
            do { pp = try await api.passport(agentID: agentID) } catch { self.error = error.localizedDescription }
        }
    }

    private func row(_ label: String, _ value: String, tone: Color? = nil, url: URL? = nil) -> some View {
        HStack {
            Text(label).font(.subheadline)
            Spacer()
            Text(value).font(.footnote.monospaced()).foregroundStyle(tone ?? Theme.ink2)
            if let url {
                Button { openURL(url) } label: { Image(systemName: "arrow.up.right").font(.caption2.weight(.semibold)).foregroundStyle(Theme.ink3) }.buttonStyle(.plain)
            }
        }
    }

    private func short(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "—" }
        return s.count > 14 ? String(s.prefix(6)) + "…" + String(s.suffix(6)) : s
    }
}
