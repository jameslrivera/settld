import SwiftUI

struct CardFace<Overlay: View>: View {
    var glow: Color = Theme.pink
    var frozen = false
    var compact = false
    @ViewBuilder let content: () -> Overlay

    private var radius: CGFloat { compact ? 14 : 22 }

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(LinearGradient(colors: [Color(red: 0.11, green: 0.11, blue: 0.125), Color(red: 0.04, green: 0.04, blue: 0.05)], startPoint: .topLeading, endPoint: .bottomTrailing))
            GeometryReader { g in
                Circle().fill(RadialGradient(colors: [glow.opacity(frozen ? 0.12 : 0.42), glow.opacity(0)], center: .center, startRadius: 0, endRadius: g.size.width * 0.5))
                    .frame(width: g.size.width * 0.95, height: g.size.width * 0.95)
                    .offset(x: g.size.width * 0.45, y: -g.size.width * 0.3)
                Path { p in
                    p.move(to: CGPoint(x: 0, y: g.size.height * 0.78))
                    p.addLine(to: CGPoint(x: g.size.width, y: g.size.height * 0.28))
                    p.addLine(to: CGPoint(x: g.size.width, y: g.size.height * 0.34))
                    p.addLine(to: CGPoint(x: 0, y: g.size.height * 0.84))
                    p.closeSubpath()
                }
                .fill(Color.white.opacity(0.025))
            }
            content()
        }
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Color.white.opacity(0.1), lineWidth: 1))
        .aspectRatio(1.586, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .shadow(color: .black.opacity(0.5), radius: 18, y: 10)
    }
}

struct CardArt: View {
    let account: Account
    var masked: Bool = false
    private var number: String {
        masked ? "••••  ••••  ••••  " + account.card_number.suffix(4) : account.card_number.chunked(4)
    }
    private var locked: Bool { account.status == "blocked" }

    var body: some View {
        CardFace(frozen: locked) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    HStack(spacing: 7) { RibbonS(size: 20); Wordmark(size: 17) }
                    Spacer()
                    Text(locked ? (account.closed == true ? "CLOSED" : "LOCKED") : "ACTIVE")
                        .font(.system(size: 10, weight: .semibold)).tracking(2)
                        .foregroundStyle(locked ? Theme.shield : .white.opacity(0.6))
                }
                Spacer()
                Text(number).font(.system(size: 19, weight: .regular, design: .monospaced)).tracking(2).contentTransition(.numericText())
                Text(account.name.uppercased()).font(.system(size: 11, weight: .medium)).tracking(1.2).foregroundStyle(.white.opacity(0.75))
                    .padding(.top, 10)
            }
            .padding(18)
        }
    }
}

extension String: @retroactive Identifiable { public var id: String { self } }

extension String {
    func chunked(_ n: Int) -> String {
        stride(from: 0, to: count, by: n).map { i -> String in
            let s = index(startIndex, offsetBy: i)
            let e = index(s, offsetBy: n, limitedBy: endIndex) ?? endIndex
            return String(self[s..<e])
        }.joined(separator: " ")
    }
}

func usd(_ cents: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencyCode = "USD"
    return f.string(from: NSNumber(value: Double(cents) / 100)) ?? "$\(cents / 100)"
}

let plainReasons: [String: String] = [
    "two_merchants_60s": "card used at two places within a minute",
    "velocity_60s": "several taps in under a minute",
    "amount_vs_usual": "much larger than this card's usual purchase",
    "distance_km": "far from where this card normally shops",
    "new_card": "card is not registered",
    "hour": "unusual time for this card",
    "category_risk": "higher-risk type of merchant",
    "card_frozen": "the card is locked",
    "insufficient_balance": "not enough money on the card for this purchase",
    "daily_limit": "over the card's daily limit",
    "high_risk": "risk score over the on-chain threshold",
    "program_declined": "refused by the on-chain policy",
    "agent_frozen": "the agent is frozen",
    "merchant_not_allowed": "the shop is not on the agent's allowed list",
    "over_merchant_cap": "over what the shop takes from agents",
    "outside_window": "outside the hours the agent may buy",
    "over_budget": "over the agent's budget",
    "needs_approval": "waiting for your approval",
    "too_many_per_hour": "too many purchases this hour",
    "task_expired": "the task card expired",
    "merchant_declined": "the shop turned it down",
    "chain_error": "the network could not be reached",
    "chain_unconfirmed": "the network did not confirm it in time",
]
func plain(_ feature: String) -> String { plainReasons[feature] ?? feature }
