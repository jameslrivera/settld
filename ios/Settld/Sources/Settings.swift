import Foundation
import Combine

final class Settings: ObservableObject {
    @Published var baseURL: String { didSet { UserDefaults.standard.set(baseURL, forKey: "baseURL") } }
    @Published var adminToken: String { didSet { UserDefaults.standard.set(adminToken, forKey: "adminToken") } }

    init() {
        baseURL = UserDefaults.standard.string(forKey: "baseURL") ?? "https://settld.pages.dev/api"
        adminToken = UserDefaults.standard.string(forKey: "adminToken") ?? ""
    }
}
