---
name: Music Web
description: 金属朋克风格的本机音乐工作界面
colors:
  primary: "#f05a46"
  primary-hover: "#ff725d"
  primary-ink: "#1b1716"
  graphite: "#171819"
  divider: "#343638"
  muted: "#a4a6a8"
  steel: "#c5c5c0"
  text: "#e6e5e1"
  button: "#282a2c"
  button-hover: "#37393b"
  button-border: "#424447"
  field: "#202224"
  field-border: "#44474a"
  search: "#242628"
  nav-active: "#323234"
  notice: "#322622"
  notice-text: "#ffb5a9"
  success: "#24322a"
  success-text: "#afdbbe"
  playback-bg: "#181b1e"
  lyric-text: "#bac1c5"
  lyric-current: "#fff5e9"
  source-selected: "#342925"
  source-selected-text: "#f4c3bb"
typography:
  brand:
    fontFamily: '"Barlow Condensed", sans-serif'
    fontSize: "27px"
    letterSpacing: "0.01em"
  title:
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  section:
    fontSize: "17px"
    fontWeight: 600
  button:
    fontSize: "13px"
  song:
    fontSize: "12px"
    fontWeight: 500
  secondary:
    fontSize: "12px"
    lineHeight: 1.9
  metadata:
    fontSize: "10px"
  lyric:
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.65
  lyric-current:
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.65
rounded:
  artwork: "2px"
  control: "3px"
  search: "4px"
  dialog: "5px"
  disc: "50%"
spacing:
  compact: "4px"
  inline: "8px"
  control: "10px"
  group: "12px"
  mobile-gutter: "16px"
  section: "24px"
  desktop-gutter: "34px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.button}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.search}"
    padding: "7px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    padding: "4px 0"
  search:
    backgroundColor: "{colors.search}"
    rounded: "{rounded.search}"
    padding: "0 10px"
  navigation-active:
    backgroundColor: "{colors.nav-active}"
    padding: "12px 13px"
  result-card:
    backgroundColor: "transparent"
    padding: "0"
  quality-label:
    padding: "2px 3px"
    rounded: "{rounded.artwork}"
  track-row:
    padding: "0 6px"
  parallel-search:
    backgroundColor: "transparent"
    padding: "3px 0"
  source-chip-selected:
    backgroundColor: "{colors.source-selected}"
    textColor: "{colors.source-selected-text}"
    rounded: "{rounded.control}"
    padding: "5px 8px"
  synchronized-lyrics:
    backgroundColor: "{colors.playback-bg}"
    textColor: "{colors.lyric-text}"
  source-manager-row:
    backgroundColor: "transparent"
    padding: "21px 0"
  current-lyric:
    backgroundColor: "transparent"
    textColor: "{colors.lyric-current}"
    padding: "15px 0"
---

# Design System: Music Web

## Overview

**Creative North Star: "金属朋克音乐工作台"**

金属朋克音乐工作台以石墨色界面、钢灰播放控制和锈红状态强调建立辨识度。工作区保持紧凑、清晰，金属质感集中在唱片和固定播放器；其他内容依靠边界、字重和明度分层。

用户确认的播放视图以当前歌曲的真实封面作半透明背景，在主内容区呈现同步滚动歌词。这个内容驱动的背景仅属于播放视图，不推广到搜索、列表或设置。

文案服务于搜索、播放、收藏与错误恢复。沿用用户确认的功能优先方向，不增加装饰性宣传描述；记录实际内容和状态。

**Key Characteristics:**
- 石墨背景与锈红状态强调。
- 密集列表、固定播放器、可折叠导航与队列。
- 唱片和播放器承载金属质感，内容表面保持克制。
- 小圆角控件、线性 SVG 图标与明确键盘焦点。
- 可选择音源的并行搜索，以及真实封面背景中的同步歌词。

## Colors

锈红是主强调，钢灰表现播放硬件与进度，石墨中性色承载内容。前置 tokens 是实际复用值；未使用的 CSS 变量不纳入规范。

### Primary
- **锈红（primary）**：主要操作、收藏、当前歌曲、选中下划线和焦点。
- **亮锈红（primary-hover）**：主要按钮悬停反馈。
- **深墨（primary-ink）**：锈红按钮上的文字与图标。

### Neutral
- **石墨（graphite）**：应用底色。
- **钢灰（steel）**：主播放按钮和滑杆填充。
- **浅灰文字（text）**与**次级灰（muted）**：主要内容与补充信息。
- **边界灰（divider）**：侧栏、页头和内容分隔。
- **控件灰（button / button-hover / button-border）**：默认按钮及交互状态。
- **输入灰（field / field-border / search）**：输入框和搜索容器。
- **选中灰（nav-active）**：当前导航项背景。

同步歌词使用 lyric-text 与暖白 lyric-current 区分普通行和当前行；选中音源使用 source-selected / source-selected-text 配对，继续沿用锈红色系。

错误与成功通知使用各自的背景、文字配对（notice / notice-text、success / success-text）。这些是状态色，不作为装饰性第二主色。

**The State Accent Rule.** 锈红用于主要操作、当前播放、收藏、选中指示和焦点，使强调始终对应可理解的状态。

## Typography

**Display Font:** Barlow Condensed，回退 sans-serif；用于英文品牌与唱片标记，构建中加载其 700 字重资源。
**Body Font:** PingFang SC、Microsoft YaHei、sans-serif；用于中文工作界面。

功能标题、歌曲和标签通过字号与字重区分，不承担宣传标题的角色。时间、序号与歌单计数使用等宽数字特性；没有独立等宽字体。

### Hierarchy
- **Brand**：英文品牌标记；窄屏缩至 24px。CSS 未统一声明品牌整体字重，不能将局部 700 推广为全局规则。
- **Title**：页面标题；移动端缩至 25px。
- **Section**：一般分区标题；设置分区实际使用 15px，对话框标题使用 19px。
- **Button**：常规操作文字。
- **Song**：歌曲名称，单行省略；结果卡标题允许两行，使用 550 字重和 1.7 行高。
- **Lyric / Lyric Current**：居中歌词与当前行；移动端分别为 18px / 23px。播放页歌曲标题使用 23px，移动端为 20px。
- **Secondary / Metadata**：辅助信息。部分播放器和队列元数据降至 8–9px；这是当前紧凑实现的可读性边界，不扩展为通用正文规范。

## Layout

桌面以三列工作区布局：左导航（218px）、弹性内容、右侧队列/歌词（280px）。顶部搜索条高 84px，播放器固定在底部（106px），容器预留同等底部空间。内容区和队列分别滚动，弹性轨道使用 minmax(0, 1fr) 防止长文本撑宽。

主内容横向留白沿用 desktop-gutter，页头与列表分组以 section 间距分隔。歌曲列表采用网格对齐，默认行高至少 68px；封面为 39px 方形。结果卡使用自动填充网格，每列至少 145px，纵横间距为 25px / 20px。

- 宽屏（≥1500px）：侧栏增至 238px / 310px，内容横向留白增至 48px。
- 紧凑桌面（≤1150px）：侧栏收至 190px / 235px，隐藏专辑列，内容横向留白降至 22px。
- 平板（≤940px）：右侧栏转为 280px 可开关浮层，底部隐藏音量滑杆。
- 手机（≤640px）：顶部品牌栏高 58px，导航折叠；搜索条高 68px，内容横向留白为 mobile-gutter。歌曲表保留序号、歌曲和操作，结果卡改为两列。底部播放器高 142px、分为歌曲信息和控制两行，队列浮层位于品牌栏与播放器之间。

播放视图占满主内容区，取消普通页内边距，由歌词容器独立滚动；标题、返回和收藏动作固定在其上方。并行搜索开关与可多选音源在列表上方换行排布，音源选择区独占一行，分源状态与重试保持可见。音源管理采用纵向分隔列表；手机端行首操作与活动时间换行、配置字段改为单列。侧栏自身可滚动，歌单高度限制为 24vh，保证音源管理与设置在短窗口仍可访问。

## Elevation & Depth

主要内容无阴影，依靠深色表面和细边界分层。唱片使用径向与锥形渐变，播放器使用轻微纵向金属渐变与铆钉细节。阴影仅用于唱片体积、对话框、提示和小屏浮层；完整数值记录在 sidecar。

播放页的真实封面使用 cover 裁切、居中定位、半透明（opacity 0.5）与柔化（blur 12px、saturate 0.8），外扩 35px 避免模糊边缘露底；深色纵向遮罩保障歌词可读。没有封面时保留 playback-bg，不虚构专辑图。

**The Material Boundary Rule.** 唱片与播放器可以呈现金属质感；列表、搜索和设置保持平面分层。用户确认的播放视图可使用当前歌曲真实封面作半透明背景。

## Shapes

控件与封面采用很小的圆角，结果卡本体为直角。圆形用于唱片、歌手头像和主播放按钮，不推广到普通表单或容器。并行搜索的开关轨道采用胶囊形（30 × 17px、10px 圆角），圆形滑块移动 13px；这是开关专用形态。默认边界为 1px；选中标签以下方 2px 锈红线表示，导航当前项使用左侧 3px 短线。

## Components

### Buttons

常规按钮是紧凑、有细边框的操作面；主要按钮使用锈红与深墨，悬停变亮。图标按钮透明、紧凑，悬停显露灰底；文本按钮只改变文字颜色。键盘焦点使用 2px 锈红轮廓与 3px 偏移。禁用按钮透明度为 0.45。颜色与背景过渡为 0.15s。

### Inputs / Fields

深灰填充、细灰边框和小圆角。搜索框由图标、无独立边框的输入区域与提交动作组成；容器在 focus-within 时转为锈红边框。普通字段保留全局焦点轮廓。错误文案位于表单上下文内。

### Navigation

侧栏项左对齐，配线性 SVG 图标，最小高度 38px、纵向内边距 9px；当前项使用选中灰底、浅色文字及左侧锈红标记。内容类型标签采用底线选中态。手机通过显式菜单按钮打开导航，不把完整导航挤进一行。

### Cards / Containers

结果卡没有额外卡片底板或阴影；方形封面与下方两行标题构成主体，歌手封面为圆形。悬停只强调标题。通知容器以带边框的语义色承载操作结果；对话框具有独立背景、轻圆角和遮罩。

### Track Rows

歌曲行按列对齐，悬停显露播放图标，键盘焦点同样显露该图标。当前歌曲采用偏暖的深背景和锈红名称，收藏状态使用实心心形。长标题省略，操作按钮保持可用。

### Playback Controls

钢灰圆形播放键、线性前后切歌图标和细滑杆构成播放器核心。音质标签是紧凑的描边信息标记；显示内容应对应当前音频来源。播放器始终保留在视口底部，移动端重排但不移除进度和主播放控制。

### Parallel Search

开关使用语义 switch 与 aria-checked，音源按钮使用 aria-pressed 表示多选；加载失败的音源禁用，不支持当前搜索类型的音源保留选择并提示切换类型后参与。选中音源使用暖灰红底、浅红文字、细红灰边框和勾选 SVG。工具栏显示已选数 / 总数，并提供全选、全不选及音源管理入口；来源标签标明仅歌词或待配置。分源进度独立呈现加载、条数或失败，失败音源提供单独重试，不用一个全局错误掩盖其他结果。

### Source Manager

当前列出全部 15 个插件，标题旁显示总数和实时状态连接情况。列表沿用平面背景与 divider 分隔，每行纵向留白 21px。名称为 14px / 550 字重；前置原生复选框（15px、锈红 accent-color）控制是否参与并行搜索。工具栏提供全选、全不选、选择已配置音源和选择计数，页面另设全部检测。

行首显示音源名称、最新状态、单项检测、按需配置及源码 SVG 链接。元信息列出插件、作者、版本、播放服务和支持类型；搜索、播放、检测分别显示实时结果、耗时及更新时间。状态文字区分未检测、请求中、已响应、请求失败、待配置和加载失败；“已响应”不等于保证播放可用，仅歌词源的播放行明确标为“仅歌词”。错误信息允许断行，时间使用等宽数字。

桌面元信息与活动区域向内缩进 24px；手机端取消缩进，名称缩为 13px、操作换行，时间在活动文字下方排列。配置表单桌面为两列、手机单列，沿用既有输入、错误和保存按钮样式，不增加独立卡片主题。

### Synchronized Lyrics

选择歌曲后进入播放视图。歌词按当前时间自动滚动，当前行使用暖白、更大字号与较高字重，区别于列表中的锈红当前歌曲态。歌词上下缘渐隐；有时间戳且媒体时长可用的行允许点击跳转。歌词加载、获取失败和无歌词各有明确状态；没有歌词时不生成示例歌词冒充内容。

### Lyric Linking Controls

播放视图与侧栏歌词共用紧凑的歌词工具区：先显示获取或匹配阶段，完成后显示歌词来源与“同步歌词 / 纯文本，无时间轴”；原音源无歌词时可自动匹配外部歌词，名称不确定的候选由用户确认。“匹配歌词 / 更换歌词”展开关键词输入与候选列表，选择版本时音乐继续播放；错误与各来源失败保留具体说明。

工具区沿用透明背景、浅灰文字与暖灰操作文案，不引入新卡片主题。主视图两侧留白 28px，手机为 20px；匹配面板上方以细线分隔，输入与搜索按钮并排。候选行显示标题、歌手、来源和匹配提示，使用下边线及轻微透明悬停背景；列表限高 190px，手机为 150px。侧栏紧凑模式取消横向留白并隐藏每行右侧匹配提示。

仅同步歌词显示偏移工具，以 0.5s 步长提前或延后、限制在 ±30s，并提供重置；数值使用等宽数字。偏移按钮使用小型 SVG，沿用焦点轮廓与禁用样式。纯文本不呈现时间对齐能力，获取或匹配期间显示明确状态并禁用候选提交。

### Motion

按钮颜色与搜索开关状态使用 0.15s 反馈；加载图标使用 1s 线性循环旋转。歌词颜色和字号使用 0.25s 过渡，歌词容器平滑滚动。prefers-reduced-motion 下关闭过渡与旋转，歌词改为立即滚动。不把加载运动推广为装饰性常驻动画。

## Do's and Don'ts

### Do:
- Do 保留以搜索、歌曲与播放控制为中心的紧凑信息层级。
- Do 使用真实内容与状态；空结果、加载和服务错误提供明确的功能文案。
- Do 为交互控件保留锈红焦点提示，并用 SVG 图标表达操作。
- Do 在窄屏收起辅助栏，保持歌曲名称和播放操作可用。
- Do 将封面背景限定于当前播放视图，并保留遮罩、歌词可读性和无封面回退。
- Do 逐个呈现所选音源的进度与失败，让部分成功结果保持可用。

### Don't:
- Don't 增加装饰性宣传文案或占据工作区的大幅营销标题。
- Don't 将唱片和播放器的金属渐变铺满列表或表单。
- Don't 用文本符号替代操作图标。
- Don't 将未核实的音质、来源或可用状态显示成事实。
