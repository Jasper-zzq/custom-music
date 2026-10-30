using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using Forms = System.Windows.Forms;

// Uses the .NET Framework shipped with Windows; no NuGet or separate SDK required.
public sealed class Playback
{
    public string title { get; set; }
    public string artist { get; set; }
    public string line { get; set; }
    public bool playing { get; set; }
}

public sealed class Preferences
{
    public double Left { get; set; }
    public double Top { get; set; }
    public bool Locked { get; set; }
}

public sealed class LyricsWindow : Window
{
    private readonly TextBlock lyrics;
    private readonly Border panel;
    private readonly Forms.NotifyIcon tray;
    private readonly Forms.ToolStripMenuItem lockItem;
    private readonly Forms.ToolStripMenuItem visibleItem;
    private readonly string webUrl;
    private readonly string preferencesPath;
    private bool locked = true;
    private bool closing;
    private bool readerStarted;
    private IntPtr handle;
    private const int GwlExStyle = -20;
    private const int Transparent = 0x20;
    private const int ToolWindow = 0x80;
    private const int NoActivate = 0x08000000;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int value);

    public LyricsWindow(string url)
    {
        webUrl = url;
        preferencesPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CustomMusic", "lyrics-window.json");
        Title = "Music Web Lyrics";
        Width = 620;
        Height = 72;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        Topmost = true;
        ShowInTaskbar = false;
        ShowActivated = false;
        WindowStartupLocation = WindowStartupLocation.Manual;

        lyrics = new TextBlock {
            Text = "♫ 等待播放", FontFamily = new FontFamily("Microsoft YaHei UI"),
            FontSize = 24, FontWeight = FontWeights.SemiBold, Foreground = Brushes.White,
            TextTrimming = TextTrimming.CharacterEllipsis, TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center, TextAlignment = TextAlignment.Left,
            Effect = new DropShadowEffect { Color = Colors.Black, BlurRadius = 6, ShadowDepth = 1, Opacity = 1 }
        };
        panel = new Border { Padding = new Thickness(18, 8, 18, 8), CornerRadius = new CornerRadius(10), Child = lyrics };
        Content = panel;
        ResetPosition();
        LoadPreferences();

        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("打开播放器", null, delegate { OpenPlayer(); });
        visibleItem = new Forms.ToolStripMenuItem("显示歌词") { Checked = true };
        visibleItem.Click += delegate {
            if (IsVisible) Hide(); else Show();
            visibleItem.Checked = IsVisible;
        };
        menu.Items.Add(visibleItem);
        lockItem = new Forms.ToolStripMenuItem("锁定位置（鼠标穿透）") { Checked = locked };
        lockItem.Click += delegate {
            locked = !locked;
            ApplyLock();
            SavePreferences();
        };
        menu.Items.Add(lockItem);
        menu.Items.Add("重置位置", null, delegate { ResetPosition(); SavePreferences(); });
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("退出歌词", null, delegate { Close(); });
        tray = new Forms.NotifyIcon {
            Icon = System.Drawing.SystemIcons.Application, Text = "Music Web · 等待播放",
            ContextMenuStrip = menu, Visible = true
        };
        tray.DoubleClick += delegate { OpenPlayer(); };
        SourceInitialized += delegate {
            handle = new WindowInteropHelper(this).Handle;
            KeepOnScreen();
            ApplyLock();
        };
        MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) {
            if (locked) return;
            DragMove();
            SavePreferences();
        };
        MouseRightButtonUp += delegate { if (!locked) menu.Show(Forms.Cursor.Position); };
        Closed += delegate {
            closing = true;
            SavePreferences();
            tray.Visible = false;
            tray.Dispose();
            menu.Dispose();
            Application.Current.Shutdown();
        };
        Loaded += delegate {
            if (readerStarted) return;
            readerStarted = true;
            var reader = new Thread(ReadUpdates) { IsBackground = true, Name = "MusicLyricsPipe" };
            reader.Start();
        };
    }

    private void ApplyLock()
    {
        lockItem.Checked = locked;
        panel.Background = locked ? Brushes.Transparent : new SolidColorBrush(Color.FromArgb(160, 25, 25, 28));
        Cursor = locked ? Cursors.Arrow : Cursors.SizeAll;
        if (handle == IntPtr.Zero) return;
        int style = GetWindowLong(handle, GwlExStyle) | ToolWindow;
        style = locked ? style | Transparent | NoActivate : style & ~Transparent & ~NoActivate;
        SetWindowLong(handle, GwlExStyle, style);
    }

    private void ReadUpdates()
    {
        try {
            using (var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false))) {
                var json = new JavaScriptSerializer { MaxJsonLength = 16384 };
                string line;
                while ((line = input.ReadLine()) != null) {
                    Playback state;
                    try { state = json.Deserialize<Playback>(line); }
                    catch (ArgumentException) { continue; }
                    catch (InvalidOperationException) { continue; }
                    if (state == null) continue;
                    Dispatcher.BeginInvoke(new Action(delegate { if (!closing) Render(state); }));
                }
            }
        } catch (IOException) {
            // A closed/broken service pipe ends the helper, including a service crash.
        } finally {
            if (!Dispatcher.HasShutdownStarted)
                Dispatcher.BeginInvoke(new Action(delegate { if (!closing) Close(); }));
        }
    }

    private void Render(Playback state)
    {
        string content = String.IsNullOrWhiteSpace(state.line) ? state.title : state.line;
        lyrics.Text = String.IsNullOrWhiteSpace(content) ? "♫ 等待播放" : (state.playing ? "♫ " : "Ⅱ ") + content;
        string song = (state.title ?? "") + (String.IsNullOrWhiteSpace(state.artist) ? "" : " · " + state.artist);
        lyrics.ToolTip = song + "\n" + (state.line ?? "");
        string tip = String.IsNullOrWhiteSpace(song) ? "Music Web · 等待播放" : song;
        tray.Text = tip.Length > 60 ? tip.Substring(0, 59) + "…" : tip;
    }

    private void OpenPlayer()
    {
        try { Process.Start(new ProcessStartInfo(webUrl) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { }
    }

    private void ResetPosition()
    {
        Rect area = SystemParameters.WorkArea;
        Left = area.Left + Math.Max(0, (area.Width - Width) / 2);
        Top = area.Bottom - Height - 40;
    }

    private void KeepOnScreen()
    {
        // Settings are in WPF device-independent units; Screen bounds are physical pixels.
        var transform = PresentationSource.FromVisual(this).CompositionTarget.TransformToDevice;
        var bounds = new System.Drawing.Rectangle((int)(Left * transform.M11), (int)(Top * transform.M22),
            (int)(Width * transform.M11), (int)(Height * transform.M22));
        bool visible = false;
        foreach (var screen in Forms.Screen.AllScreens) {
            var intersection = System.Drawing.Rectangle.Intersect(bounds, screen.WorkingArea);
            if (intersection.Width >= 100 && intersection.Height >= 30) { visible = true; break; }
        }
        if (!visible) ResetPosition();
    }

    private void LoadPreferences()
    {
        try {
            var settings = new JavaScriptSerializer().Deserialize<Preferences>(File.ReadAllText(preferencesPath));
            if (settings != null && !Double.IsNaN(settings.Left) && !Double.IsInfinity(settings.Left) &&
                !Double.IsNaN(settings.Top) && !Double.IsInfinity(settings.Top) &&
                Math.Abs(settings.Left) < 100000 && Math.Abs(settings.Top) < 100000) {
                Left = settings.Left; Top = settings.Top; locked = settings.Locked;
            }
        } catch (IOException) { } catch (UnauthorizedAccessException) { } catch (ArgumentException) { }
        catch (InvalidOperationException) { }
    }

    private void SavePreferences()
    {
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(preferencesPath));
            File.WriteAllText(preferencesPath, new JavaScriptSerializer().Serialize(
                new Preferences { Left = Left, Top = Top, Locked = locked }), new UTF8Encoding(false));
        } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    [STAThread]
    public static void Main(string[] args)
    {
        string url = args.Length > 0 ? args[0] : "http://127.0.0.1:3210";
        Uri parsed;
        if (!Uri.TryCreate(url, UriKind.Absolute, out parsed) || !parsed.IsLoopback || parsed.Scheme != "http") return;
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.Run(new LyricsWindow(url));
    }
}
