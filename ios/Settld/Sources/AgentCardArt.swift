import SwiftUI

struct AgentCardArt: View {
    let agent: Agent
    var compact = false

    var body: some View {
        CardFace(glow: Theme.pink, frozen: agent.frozen, compact: compact) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    HStack(spacing: compact ? 5 : 7) { RibbonS(size: compact ? 13 : 20); if !compact { Wordmark(size: 17) } }
                    Spacer()
                    Text(agent.frozen ? "FROZEN" : "AGENT")
                        .font(.system(size: compact ? 8 : 10, weight: .semibold)).tracking(compact ? 1.4 : 2)
                        .foregroundStyle(agent.frozen ? Theme.shield : Theme.pink)
                }
                Spacer()
                if compact {
                    Text("•••• " + agent.card_number.suffix(4)).font(.system(size: 11, design: .monospaced)).tracking(1)
                } else {
                    Text("••••  ••••  ••••  " + agent.card_number.suffix(4)).font(.system(size: 19, design: .monospaced)).tracking(2)
                }
                Text(agent.name.uppercased()).font(.system(size: compact ? 8 : 11, weight: .medium)).tracking(compact ? 0.8 : 1.2).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                    .padding(.top, compact ? 4 : 10)
            }
            .padding(compact ? 9 : 18)
        }
    }
}

struct BudgetBar: View {
    let agent: Agent
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                SectionLabel(text: "Budget left")
                Spacer()
                Text(usd(agent.leftCents)).font(.system(size: 17, weight: .semibold, design: .serif))
                Text("of \(usd(agent.policy.budget_cents))").font(.caption).foregroundStyle(Theme.ink3)
            }
            ProgressBar(fraction: Double(agent.leftCents) / Double(max(1, agent.policy.budget_cents)), tone: agent.frozen ? Theme.shield : Theme.pink)
            HStack(spacing: 14) {
                Label(usd(agent.balance_cents) + " loaded", systemImage: "creditcard").font(.caption).foregroundStyle(Theme.ink3)
                Label("asks above " + usd(agent.policy.approval_threshold_cents), systemImage: "wave.3.right").font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }
}
