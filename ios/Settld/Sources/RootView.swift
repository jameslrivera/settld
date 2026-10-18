import SwiftUI

struct RootView: View {
    @EnvironmentObject var settings: Settings
    @StateObject private var feed = Feed()
    @AppStorage("personID") private var personID = ""
    @State private var tab = 0

    var body: some View {
        ZStack(alignment: .top) {
            tabs
            BannerStack().environmentObject(feed)
        }
        .onAppear { feed.personID = personID; feed.connect(base: settings.baseURL) }
        .onChange(of: settings.baseURL) { _, new in feed.connect(base: new) }
        .onChange(of: personID) { _, new in feed.personID = new }
        .task(id: personID) { await verifyAccount() }
        .fullScreenCover(isPresented: Binding(get: { personID.isEmpty }, set: { _ in })) {
            CreateAccountView(api: API(base: settings.baseURL)) { id in personID = id }
        }
    }

    private func verifyAccount() async {
        guard !personID.isEmpty else { return }
        do {
            _ = try await API(base: settings.baseURL).person(id: personID)
        } catch APIError.refused {
            guard OwnerToken.matches(settings.baseURL) else { return }
            UserDefaults.standard.removeObject(forKey: "cardUID")
            OwnerToken.clear()
            personID = ""
        } catch {}
    }

    private var tabs: some View {
        TabView(selection: $tab) {
                CardholderView()
                    .tabItem { Label("Card", systemImage: "creditcard") }
                    .tag(0)
                AgentsView()
                    .environmentObject(feed)
                    .tabItem { Label("Agent", systemImage: "sparkles") }
                    .badge(feed.pendingCount)
                    .tag(1)
                AccountView()
                    .environmentObject(feed)
                    .tabItem { Label("Account", systemImage: "person.crop.circle") }
                    .tag(2)
            }
            .background(Theme.bg)
            .onAppear {
                let a = UITabBarAppearance()
                a.configureWithOpaqueBackground()
                a.backgroundColor = UIColor.black
                UITabBar.appearance().standardAppearance = a
                UITabBar.appearance().scrollEdgeAppearance = a
            }
    }
}
