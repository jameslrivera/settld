import SwiftUI

struct CreateAccountView: View {
    let api: API
    let onFinished: (String) -> Void

    @State private var name = ""
    @State private var birthday = Calendar.current.date(byAdding: .year, value: -25, to: Date()) ?? Date()
    @State private var email = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            VStack(spacing: 22) {
                HStack(spacing: 8) { RibbonS(size: 22); Wordmark(size: 18) }
                    .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 0)
                RibbonS(size: 64)
                Text("Open your account").font(.system(size: 34, weight: .regular, design: .serif))
                Text("Stablecoin payment infrastructure for people, business and their agents. The account is you; cards are issued to it.")
                    .font(.body).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                VStack(spacing: 10) {
                    field("Full name", text: $name, keyboard: .default, capitalize: .words)
                    HStack {
                        Text("Birthday").foregroundStyle(Theme.ink2)
                        Spacer()
                        DatePicker("", selection: $birthday, in: ...Date(), displayedComponents: .date)
                            .labelsHidden().tint(Theme.pink)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8).background(Theme.surface)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous).stroke(Theme.line, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall, style: .continuous))
                    field("Email (optional)", text: $email, keyboard: .emailAddress, capitalize: .never)
                }
                Text("A screening step runs here. In production this is where identity checks plug in.")
                    .font(.footnote).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.down).multilineTextAlignment(.center)
                }
                PrimaryButton(title: "Open account", busy: busy, enabled: name.trimmingCharacters(in: .whitespaces).count >= 2) { create() }
                Spacer(minLength: 0)
            }
            .padding(24)
        }
    }

    private func field(_ placeholder: String, text: Binding<String>, keyboard: UIKeyboardType, capitalize: TextInputAutocapitalization) -> some View {
        TextField(placeholder, text: text)
            .keyboardType(keyboard).textInputAutocapitalization(capitalize).autocorrectionDisabled()
            .field()
    }

    private func create() {
        busy = true
        error = nil
        let iso = birthday.formatted(.iso8601.year().month().day())
        Task {
            do {
                let p = try await api.createPerson(name: name.trimmingCharacters(in: .whitespaces), birthday: iso, email: email.isEmpty ? nil : email)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                onFinished(p.id)
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
