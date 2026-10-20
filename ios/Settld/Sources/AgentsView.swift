import SwiftUI

struct AgentsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var feed: Feed
    @AppStorage("personID") private var personID = ""
    @State private var agents: [Agent] = []
    @State private var selected: String?
    @State private var error: String?

    private var api: API { API(base: settings.baseURL) }
    private var current: String? {
        if let s = selected, agents.contains(where: { $0.id == s }) { return s }
        return agents.first?.id
    }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if let id = current {
                AgentThreadView(agentID: id)
                    .environmentObject(settings)
                    .environmentObject(feed)
                    .id(id)
            } else {
                settingUp
            }
        }
        .task(id: personID) { await refresh(); await ensure() }
        .onChange(of: feed.agentsVersion) { _, _ in Task { await refresh() } }
    }

    private var settingUp: some View {
        VStack(spacing: 14) {
            HStack(spacing: 8) { Wordmark(size: 22); Spacer() }
            Spacer()
            Wordmark(size: 40)
            Text(error == nil ? "Setting up your agent" : "Your agent is not ready")
                .font(.system(size: 28, weight: .regular, design: .serif))
            Text(error ?? "A few seconds.")
                .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
            if error == nil { ProgressView().tint(Theme.pink).padding(.top, 6) }
            Spacer()
            Spacer()
        }
        .padding(20)
    }

    private func refresh() async {
        guard !personID.isEmpty else { agents = []; return }
        if let list = try? await api.agents(personID: personID) {
            agents = list.sorted { $0.created < $1.created }
        }
    }

    private func ensure() async {
        while !Task.isCancelled, agents.isEmpty, !personID.isEmpty {
            do {
                let r = try await api.ensureAgent(personID: personID)
                error = nil
                if let a = r.agent { agents = [a]; return }
            } catch {
                self.error = error.localizedDescription
            }
            try? await Task.sleep(for: .seconds(3))
            await refresh()
        }
    }
}
