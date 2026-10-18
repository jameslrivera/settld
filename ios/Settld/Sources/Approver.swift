import Foundation
import LocalAuthentication

enum Approver {
    static func confirmIdentity(reason: String) async throws {
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Cancel"
        var err: NSError?
        let policy: LAPolicy = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) ? .deviceOwnerAuthenticationWithBiometrics : .deviceOwnerAuthentication
        guard ctx.canEvaluatePolicy(policy, error: &err) else {
            #if targetEnvironment(simulator)
            return
            #else
            throw APIError.refused("This phone has no Face ID or passcode set up, so it cannot approve.")
            #endif
        }
        let ok = try await ctx.evaluatePolicy(policy, localizedReason: reason)
        if !ok { throw APIError.refused("Not confirmed.") }
    }
}
