import SwiftUI

enum Theme {
    static let bg = Color.black
    static let surface = Color(red: 0.055, green: 0.055, blue: 0.065)
    static let surface2 = Color(red: 0.11, green: 0.11, blue: 0.125)
    static let line = Color.white.opacity(0.08)
    static let ink2 = Color(red: 0.66, green: 0.66, blue: 0.70)
    static let ink3 = Color(red: 0.46, green: 0.46, blue: 0.51)
    static let pink = Color(red: 1.0, green: 0.18, blue: 0.71)
    static let pink2 = Color(red: 0.71, green: 0.13, blue: 0.50)
    static let up = Color(red: 0.0, green: 0.78, blue: 0.02)
    static let down = Color(red: 1.0, green: 0.31, blue: 0.0)
    static let shield = Color(red: 0.96, green: 0.71, blue: 0.25)
    static let radius: CGFloat = 24
    static let radiusSmall: CGFloat = 16
    static var pinkGradient: LinearGradient {
        LinearGradient(colors: [pink, Color(red: 0.84, green: 0.14, blue: 0.60)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

struct Wordmark: View {
    var size: CGFloat = 22
    var body: some View {
        (Text("Settld") + Text(".").foregroundColor(Theme.pink)).font(.system(size: size, weight: .semibold)).tracking(-0.8)
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(1.4).foregroundStyle(Theme.ink3)
    }
}

struct HeroAmount: View {
    let cents: Int
    var size: CGFloat = 56
    var tone: Color = .white
    var body: some View {
        Text(usd(cents))
            .font(.system(size: size, weight: .regular, design: .serif))
            .foregroundStyle(tone)
            .contentTransition(.numericText())
            .minimumScaleFactor(0.6)
            .lineLimit(1)
    }
}

struct PrimaryButton: View {
    let title: String
    var icon: String? = nil
    var busy = false
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().controlSize(.small).tint(.white) }
                else if let icon { Image(systemName: icon).font(.subheadline.weight(.semibold)) }
                Text(title).font(.headline)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(enabled ? AnyShapeStyle(Theme.pinkGradient) : AnyShapeStyle(Theme.surface2))
            .clipShape(Capsule())
            .shadow(color: Theme.pink.opacity(enabled ? 0.3 : 0), radius: 14, y: 6)
        }
        .buttonStyle(.plain)
        .disabled(!enabled || busy)
    }
}

struct SecondaryButton: View {
    let title: String
    var icon: String? = nil
    var tone: Color = .white
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Image(systemName: icon).font(.subheadline.weight(.semibold)) }
                Text(title).font(.subheadline.weight(.semibold))
            }
            .foregroundStyle(tone)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(Theme.surface)
            .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }
}

struct ActionTile: View {
    let title: String
    let icon: String
    var tone: Color = .white
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.body.weight(.semibold))
                Text(title).font(.caption.weight(.semibold))
            }
            .foregroundStyle(tone)
            .frame(maxWidth: .infinity)
            .frame(height: 66)
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }
}

struct Chip: View {
    let text: String
    var selected = false
    var body: some View {
        Text(text).font(.caption.weight(.semibold))
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(selected ? Theme.pink : Theme.surface)
            .overlay(Capsule().stroke(selected ? Color.clear : Theme.line, lineWidth: 1))
            .clipShape(Capsule())
            .foregroundStyle(.white)
    }
}

struct StatTile: View {
    let label: String
    let value: String
    let sub: String
    var tone: Color = .white
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2.weight(.medium)).foregroundStyle(Theme.ink3)
            Text(value).font(.system(size: 17, weight: .semibold, design: .serif)).foregroundStyle(tone).lineLimit(1).minimumScaleFactor(0.7)
            if !sub.isEmpty { Text(sub).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
    }
}

struct ProgressBar: View {
    let fraction: Double
    var tone: Color = Theme.pink
    var height: CGFloat = 6
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface2)
                Capsule().fill(tone).frame(width: g.size.width * CGFloat(min(1, max(0, fraction))))
            }
        }
        .frame(height: height)
    }
}

extension View {
    func card() -> some View {
        padding(16)
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }

    func field() -> some View {
        padding(16)
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
    }
}
