import AppKit

struct Playback: Decodable {
    let title: String
    let artist: String
    let line: String
    let playing: Bool
}

final class LyricsApp: NSObject, NSApplicationDelegate {
    private var item: NSStatusItem!
    private let details = NSMenuItem(title: "等待播放", action: nil, keyEquivalent: "")
    private let lyricDetails = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let webURL: URL

    init(webURL: URL) { self.webURL = webURL }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Keep the same slot for idle, short and long lyrics to avoid menu-bar jumps.
        item = NSStatusBar.system.statusItem(withLength: 320)
        item.autosaveName = "MusicWebLyrics"
        item.button?.alignment = .left
        item.button?.lineBreakMode = .byTruncatingTail
        item.button?.title = "♫"
        item.button?.toolTip = "Music Web · 等待播放"
        let menu = NSMenu()
        menu.addItem(details)
        menu.addItem(lyricDetails)
        menu.addItem(.separator())
        let open = NSMenuItem(title: "打开播放器", action: #selector(openPlayer), keyEquivalent: "")
        open.target = self
        menu.addItem(open)
        let quit = NSMenuItem(title: "退出菜单栏歌词", action: #selector(quitApp), keyEquivalent: "")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu

        // The service owns this pipe. EOF also handles a service crash or SIGKILL.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let state = try? JSONDecoder().decode(Playback.self, from: data) else { continue }
                DispatchQueue.main.async { self?.render(state) }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    private func render(_ state: Playback) {
        let song = [state.title, state.artist].filter { !$0.isEmpty }.joined(separator: " · ")
        let content = state.line.isEmpty ? state.title : state.line
        let text = content.isEmpty ? "♫" : "\(state.playing ? "♫" : "Ⅱ") \(content)"
        guard let button = item.button else { return }
        let font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        paragraph.alignment = .left
        button.attributedTitle = NSAttributedString(string: text, attributes: [
            .font: font, .paragraphStyle: paragraph,
        ])
        button.toolTip = [song, state.line].filter { !$0.isEmpty }.joined(separator: "\n")
        details.title = song.isEmpty ? "等待播放" : String(song.prefix(100))
        lyricDetails.title = String(state.line.prefix(160))
        lyricDetails.isHidden = state.line.isEmpty
    }

    @objc private func openPlayer() { NSWorkspace.shared.open(webURL) }
    @objc private func quitApp() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let url = URL(string: CommandLine.arguments.dropFirst().first ?? "http://127.0.0.1:3210")!
let delegate = LyricsApp(webURL: url)
app.delegate = delegate
app.run()
