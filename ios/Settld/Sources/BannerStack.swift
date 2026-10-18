import SwiftUI

struct BannerStack: View {
    @EnvironmentObject var feed: Feed
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 8) {
            ForEach(feed.notices) { n in
                Banner(notice: n)
                    .onTapGesture { if let u = n.href { openURL(u) } }
                    .gesture(DragGesture(minimumDistance: 20).onEnded { g in if g.translation.height < -10 { feed.dismiss(n.id) } })
                    .transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity), removal: .opacity))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: feed.notices)
        .allowsHitTesting(!feed.notices.isEmpty)
    }
}

struct Banner: View {
    let notice: Notice

    private var tone: Color {
        switch notice.kind {
        case .approved, .deposit: return Theme.up
        case .blocked, .frozen, .screened, .approval: return Theme.shield
        case .issued, .withdraw, .agent: return Theme.pink
        }
    }
    private var icon: String {
        switch notice.kind {
        case .approved: return "checkmark.circle.fill"
        case .deposit: return "plus.circle.fill"
        case .blocked: return "shield.lefthalf.filled"
        case .issued: return "creditcard.fill"
        case .frozen: return "lock.fill"
        case .screened: return "hand.raised.fill"
        case .withdraw: return "arrow.up.right.circle.fill"
        case .agent: return "sparkles"
        case .approval: return "wave.3.right.circle.fill"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(tone).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(notice.title).font(.subheadline.weight(.semibold))
                Text(notice.detail).font(.caption).foregroundStyle(Theme.ink2).lineLimit(2)
            }
            Spacer(minLength: 0)
            Text(notice.ts.formatted(date: .omitted, time: .shortened)).font(.caption2).foregroundStyle(Theme.ink3)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
        .background(Theme.surface.opacity(0.9))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(tone.opacity(0.45), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.5), radius: 14, y: 6)
    }
}
