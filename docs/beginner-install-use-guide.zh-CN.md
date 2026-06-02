# Pockedio Mac 新手安装和使用教程

这份教程写给从来没有写过代码、也可能从来没有打开过 Terminal 的 Mac 用户。

你只需要会做三件事：

- 打开 Mac 上的 App。
- 复制一整行命令。
- 粘贴到 Terminal 里，然后按一次 `Return`。

不用理解每个命令是什么意思。照着做即可。

## 先确认你需要准备什么

Pockedio 目前还不是一个可以双击安装的普通 App。它是一个运行在 Terminal 里的本地音乐 DJ 工具。

你需要：

- 一台 Mac。
- 能联网。
- 一个网易云音乐账号，推荐准备手机上的「网易云音乐」App。
- 一个 LLM API Key，例如 OpenAI、DeepSeek、OpenRouter，或其他 OpenAI-compatible 服务。没有 API Key 也可以先装好，但 Pockedio 的完整推荐和聊天能力需要它。
- 大约 30-60 分钟，第一次安装会比较慢。

重要提醒：

- Terminal 里输入密码时，屏幕上通常不会显示星号，也不会显示任何字符。这是正常的。输入完按 `Return`。
- 教程里的命令要整行复制，不要只复制一半。
- 命令前面如果出现说明文字，不要复制说明文字，只复制灰色代码块里的内容。
- 如果某一步看起来卡住了，先等 1-3 分钟。安装工具第一次运行时经常需要下载东西。

## 第 1 步：打开 Terminal

1. 看 Mac 屏幕右上角，点击放大镜图标，也就是 Spotlight。
2. 输入：

```text
Terminal
```

3. 你会看到一个叫 `Terminal` 或「终端」的 App。
4. 按 `Return`，或者用鼠标双击打开它。

打开后，你会看到一个白底或黑底的窗口，里面可能有类似这样的文字：

```text
yourname@MacBook ~ %
```

光标在最后闪烁，说明 Terminal 已经准备好接收命令。

## 第 2 步：安装 Apple 命令行工具

这一步是让 Mac 具备安装开发工具的基础能力。

复制下面这一整行：

```bash
xcode-select --install
```

然后：

1. 回到 Terminal。
2. 粘贴进去。
3. 按 `Return`。

可能出现两种情况。

如果弹出一个窗口，提示安装 Command Line Tools：

1. 点击 `Install` 或「安装」。
2. 同意许可协议。
3. 等它安装完成。

如果 Terminal 显示类似下面的内容：

```text
xcode-select: note: Command line tools are already installed
```

说明你的 Mac 已经装过了，可以继续下一步。

## 第 3 步：安装 Homebrew

Homebrew 是 Mac 上常用的软件安装工具。后面我们会用它安装 Node.js、Git 和播放器。

打开 Homebrew 官网也可以看到同一条安装命令：

- https://brew.sh/

复制下面这一整行：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

然后粘贴到 Terminal，按 `Return`。

安装过程中可能会问你 Mac 登录密码：

```text
Password:
```

这时直接输入你的 Mac 开机登录密码，然后按 `Return`。输入时屏幕不显示任何字符，这是正常的。

安装过程中还可能出现：

```text
Press RETURN/ENTER to continue or any other key to abort:
```

看到这句话时，直接按 `Return`。

安装结束后，Terminal 可能会显示几行 `Next steps`。里面通常有两行以 `echo` 和 `eval` 开头的命令。

如果你看到这样的提示，请把它提示你的两行命令复制出来，粘贴到 Terminal 里执行。它们大概长这样：

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

如果你的 Mac 是 Intel 芯片，也可能是这样：

```bash
echo 'eval "$(/usr/local/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/usr/local/bin/brew shellenv)"
```

不确定自己的 Mac 是哪一种没关系：优先复制 Homebrew 安装结束后它自己显示的 `Next steps`。

执行完后，检查 Homebrew 是否安装成功：

```bash
brew --version
```

如果看到类似下面的内容，就成功了：

```text
Homebrew 5.x.x
```

## 第 4 步：安装 Node.js、Git 和 mpv

Pockedio 需要 Node.js 22 或更新版本。Node.js 官网也提供安装包：

- https://nodejs.org/en/download/

这里推荐用 Homebrew 一次装好需要的工具。

复制这一行：

```bash
brew install node git mpv
```

粘贴到 Terminal，按 `Return`。

等待安装完成。完成后，依次检查三个工具。

检查 Node.js：

```bash
node -v
```

你应该看到类似：

```text
v22.22.2
```

或者 `v23`、`v24`、`v25`、`v26` 这样的更高版本也可以。

检查 npm：

```bash
npm -v
```

只要显示一个版本号即可。

检查 Git：

```bash
git --version
```

只要显示一个版本号即可。

检查 mpv：

```bash
mpv --version
```

只要显示版本信息即可。

mpv 不是绝对必须，但强烈建议安装。它能让 Pockedio 更好地暂停、继续播放音乐。

## 第 5 步：下载 Pockedio

为了让文件放在容易找到的位置，我们先回到你的用户主目录。

复制：

```bash
cd ~
```

粘贴到 Terminal，按 `Return`。

然后下载 Pockedio：

```bash
git clone https://github.com/wyLeon/Pockedio.git
```

如果成功，你会看到 Terminal 开始显示下载进度。

下载完成后，进入 Pockedio 文件夹：

```bash
cd Pockedio
```

你现在已经在 Pockedio 项目文件夹里了。

## 第 6 步：安装 Pockedio 需要的依赖

复制：

```bash
npm install
```

粘贴到 Terminal，按 `Return`。

这一步会下载 Pockedio 运行需要的 JavaScript 包。第一次可能要几分钟。

如果中途出现很多英文，不用紧张。只要最后回到类似这样的输入状态，就说明命令结束了：

```text
yourname@MacBook Pockedio %
```

## 第 7 步：构建 Pockedio

复制：

```bash
npm run build
```

粘贴到 Terminal，按 `Return`。

如果没有报错，说明构建成功。

## 第 8 步：让 Mac 认识 `pockedio` 这个命令

复制：

```bash
npm link
```

粘贴到 Terminal，按 `Return`。

这一步完成后，你就可以在 Terminal 的任何位置输入 `pockedio` 来打开 Pockedio。

检查是否成功：

```bash
pockedio status
```

如果你看到 Pockedio 的状态信息，就成功了。

## 第 9 步：启动网易云音乐 API adapter

Pockedio 播放音乐时，需要一个本地的网易云音乐 API adapter。你可以把它理解成一个本地小助手：Pockedio 问它「这首歌在哪里播放」，它负责去网易云音乐查。

这一步需要单独开一个 Terminal 窗口或标签页，并且让它一直开着。

### 打开第二个 Terminal 标签页

在 Terminal 顶部菜单栏点击：

```text
Shell -> New Tab
```

或者按快捷键：

```text
Command + T
```

你现在应该有两个 Terminal 标签页。

在新的标签页里，先进入 Pockedio 文件夹：

```bash
cd ~/Pockedio
```

然后启动网易云音乐 API adapter：

```bash
spikes/scripts/run_netease_api.sh
```

如果它开始显示一些运行日志，并且没有马上退出，就说明正在运行。

这个标签页不要关闭。关闭后，Pockedio 就查不到网易云音乐了。

后面你会这样使用两个 Terminal：

- 第一个 Terminal：运行 Pockedio。
- 第二个 Terminal：一直运行网易云音乐 API adapter。

## 第 10 步：第一次设置 Pockedio

回到第一个 Terminal 标签页。

如果你不确定自己在哪个文件夹，先输入：

```bash
cd ~/Pockedio
```

然后启动第一次设置：

```bash
pockedio setup
```

接下来 Pockedio 会一步一步问你问题。

### 如何在设置界面里操作

常用按键：

- `↑` 和 `↓`：上下移动选择。
- `Return`：确认当前选择。
- `Y`：回答 yes。
- `N`：回答 no。
- `B`：回到上一层选择界面。
- `Esc`：在输入文字或密码时返回。

如果你不确定选什么，优先按教程里的推荐选择。

## 第 11 步：设置音乐来源，也就是网易云音乐

设置开始后，你会看到类似：

```text
Music provider
  NetEase Cloud Music
```

选择 `NetEase Cloud Music`，按 `Return`。

然后它会问是否现在连接网易云音乐账号：

```text
Connect NetEase account now?
  Yes, scan QR
  Yes, paste MUSIC_U cookie
  Not now, use anonymous playback
```

推荐选择：

```text
Yes, scan QR
```

因为这是最适合普通用户的方式。

如果你暂时不想登录，也可以选：

```text
Not now, use anonymous playback
```

匿名播放可能能用，但有些歌曲可能搜得到、播不了，或者可用性不稳定。

### 如果选择扫码登录

Pockedio 会显示类似：

```text
Open and scan this QR image with NetEase Cloud Music: ~/.pockedio/secrets/netease-login-qr.png
```

这表示二维码图片已经生成在你的 Mac 里。

打开二维码的方法：

1. 打开 Finder。
2. 顶部菜单点击：

```text
Go -> Go to Folder...
```

中文系统里可能是：

```text
前往 -> 前往文件夹...
```

3. 粘贴下面这个路径：

```text
~/.pockedio/secrets/
```

4. 按 `Return`。
5. 找到 `netease-login-qr.png`。
6. 双击打开这个图片。
7. 用手机上的网易云音乐 App 扫这个二维码并确认登录。

二维码有效时间大约 90 秒。如果超时了，重新运行 `pockedio setup netease` 再扫一次。

### 选择播放音质

如果 Pockedio 问你：

```text
Preferred playback quality
  hires
  lossless
  exhigh
  higher
  standard
```

推荐选择：

```text
exhigh
```

它通常是比较好的日常默认选择。

如果你发现播放失败较多，可以以后改成：

```text
standard
```

## 第 12 步：设置 DJ 声音

Pockedio 可能会问：

```text
Hear DJs you can choose? [Y/n]
```

推荐按：

```text
Y
```

然后按 `Return`。

你可以试听 Mina 或 Nova。

试听结束后，选择：

```text
Choose your DJ
```

然后进入真正的声音选择。

对于完全新手，推荐选择内置 macOS 声音，因为它不用额外安装模型。

推荐选择：

```text
Built-in voices
  Vale - warm, neutral, default
```

也可以选择：

```text
Sable - soft, intimate, late-night
```

暂时不推荐新手一开始选择 Kokoro、Mina、Nova 这类需要额外本地语音模型的选项。等 Pockedio 正常能播歌之后，再慢慢折腾声音模型。

## 第 13 步：导入你的网易云歌单口味

Pockedio 会问：

```text
Import taste from a NetEase playlist? [y/N]
```

如果你愿意让它更了解你的音乐口味，推荐导入一个你最常听的网易云歌单。

### 如何复制网易云歌单链接

在手机网易云音乐里：

1. 打开你的一个歌单。
2. 点分享按钮。
3. 复制链接。

或者在网页版网易云音乐里打开歌单，复制浏览器地址栏链接。

链接通常长这样：

```text
https://music.163.com/#/playlist?id=123456
```

如果要导入，按：

```text
Y
```

然后粘贴歌单链接，按 `Return`。

如果你暂时没有歌单链接，直接按：

```text
N
```

以后也可以再导入：

```bash
pockedio import-taste "https://music.163.com/#/playlist?id=你的歌单ID"
```

注意：导入歌单时，第二个 Terminal 里的网易云音乐 API adapter 必须正在运行。

## 第 14 步：设置天气

Pockedio 会问：

```text
Use local weather for better DJ context? [Y/n]
```

如果你希望它根据天气稍微调整音乐气氛，按：

```text
Y
```

然后输入你所在城市的英文或拼音，例如：

```text
Shanghai
```

或：

```text
Guangzhou
```

如果你不想设置天气，按：

```text
N
```

天气是可选项。不设置也能使用。

## 第 15 步：设置 Apple Calendar

Pockedio 会问是否启用日历上下文。

如果你希望它知道你今天大概有没有会议、是否适合专注、通勤或放松，可以启用。

如果你不确定，建议第一次先选：

```text
N
```

等 Pockedio 正常跑起来后再设置日历。

如果你选择启用，Mac 可能会弹出权限窗口。看到 Calendar、Automation 或类似权限请求时，选择 `Allow` 或「允许」。

以后单独设置日历可以运行：

```bash
pockedio setup calendar
```

## 第 16 步：设置 Diary

Pockedio 可能会问是否启用 diary context。

如果你有一个写日记的文件夹，并且希望 Pockedio 根据最近的日记氛围帮你选音乐，可以启用。

对于新手，第一次推荐先选：

```text
N
```

原因是 diary 涉及隐私，而且如果你使用远程 LLM，摘要生成时可能会把日记片段发送给你配置的 LLM 服务。

以后想启用可以运行：

```bash
pockedio setup diary
```

如果要复制日记文件夹路径：

1. 在 Finder 打开你的日记文件夹。
2. 按住 `Option`。
3. 同时按 `Command + C`。
4. 这会复制文件夹路径。
5. 回到 Terminal 粘贴。

## 第 17 步：设置定时 DJ

Pockedio 可能会问：

```text
Scheduled DJ programs?
  Not now
  Morning only
  Evening only
  Morning and Evening
```

第一次推荐选择：

```text
Not now
```

等你确认 Pockedio 可以正常播歌以后，再开启定时 DJ。

以后要设置可以运行：

```bash
pockedio setup scheduler
```

如果开启定时 DJ，需要额外运行：

```bash
pockedio serve
```

并且这个 Terminal 要一直开着。到了设定时间，Pockedio 才会准备和提示播放。

## 第 18 步：设置 LLM Provider 和 API Key

Pockedio 的完整体验需要一个 OpenAI-compatible LLM Provider。设置过程中你会看到 OpenAI、DeepSeek、OpenRouter、local vLLM 或 custom endpoint 之类的选项。

如果你已经有 OpenAI API Key：

1. 选择 `OpenAI`。
2. 按提示粘贴 API Key。
3. API Key 通常以 `sk-` 开头。

如果你想使用 DeepSeek，先去 DeepSeek 开发者平台获取 API Key。

DeepSeek 开发者平台：

```text
https://platform.deepseek.com/
```

DeepSeek API Key 页面：

```text
https://platform.deepseek.com/api_keys
```

DeepSeek 官方 API 文档：

```text
https://api-docs.deepseek.com/
```

获取 DeepSeek API Key 的步骤：

1. 打开浏览器，例如 Safari 或 Chrome。
2. 在地址栏输入：

```text
https://platform.deepseek.com/
```

3. 登录或注册 DeepSeek 账号。
4. 登录后，找到 `API Keys` 或「API 密钥」页面。
5. 如果找不到，可以直接打开：

```text
https://platform.deepseek.com/api_keys
```

6. 点击 `Create API Key`、`Create new API key` 或类似按钮。
7. 给这个 key 起一个容易识别的名字，例如：

```text
pockedio
```

8. 创建后，页面会显示一串很长的 key。
9. 立刻复制这串 key。很多平台只会完整显示一次，关掉页面后可能无法再次看到完整内容。
10. 回到 Terminal 里的 `pockedio setup`。
11. 选择 `DeepSeek`。
12. 按提示粘贴刚才复制的 API Key。

如果 DeepSeek 平台提示需要充值或开通余额，请按 DeepSeek 页面提示处理。API Key 不是 DeepSeek 聊天网页的登录密码，也不是你的手机号验证码。

在 Pockedio 里设置 DeepSeek 时：

1. 选择 `DeepSeek`。
2. 按提示粘贴 API Key。

如果你使用 OpenRouter：

1. 选择 `OpenRouter`。
2. 按提示粘贴 API Key。

注意：

- API Key 不是你的网页登录密码。
- 不要把 API Key 发给别人。
- 不要截图发到公开地方。
- Pockedio 会把你粘贴的 key 存在本机的 `~/.pockedio/secrets/` 里。

## 第 19 步：第一次打开 Pockedio

确认第二个 Terminal 仍然在运行网易云音乐 API adapter。

回到第一个 Terminal，运行：

```bash
pockedio
```

如果看到欢迎界面，说明已经启动。

你可以选择：

```text
Start DJ Session
```

或直接进入会话。

## 第 20 步：如何和 Pockedio 说话

进入会话后，你可以直接输入自然语言。

例如：

```text
play something soft for late-night focus
```

意思是：播放一些适合深夜专注的柔和音乐。

你也可以用中文试试：

```text
放一些适合晚上写东西的歌
```

或者：

```text
来点轻一点的，不要太吵
```

Pockedio 通常会生成一个五首歌左右的 station。

当它给出 station 后：

- 直接按 `Return`：开始播放。
- 输入 `dj` 再按 `Return`：准备带口播的 DJ 版本。
- 输入新的要求：让它调整方向。

## 第 21 步：常用播放指令

播放时可以输入：

```text
pause
```

暂停。

```text
resume
```

继续播放。

```text
next
```

下一首。

```text
previous
```

上一首。

```text
favorite this
```

收藏当前歌曲。

```text
who is the singer?
```

询问当前歌手。

```text
make it warmer and more acoustic
```

让后面的音乐更温暖、更原声。

```text
continue this vibe
```

延续刚才的氛围。

如果 `pause` 或 `resume` 不好用，通常是因为 mpv 没装好。先检查：

```bash
mpv --version
```

如果没有版本信息，运行：

```bash
brew install mpv
```

## 第 22 步：以后每次怎么启动

以后你不需要重新安装。每次使用只做这几步。

### 1. 打开 Terminal

用 Spotlight 搜索 `Terminal` 打开。

### 2. 开第一个 Terminal，启动网易云音乐 API adapter

```bash
cd ~/Pockedio
spikes/scripts/run_netease_api.sh
```

这个窗口保持打开。

### 3. 开第二个 Terminal，启动 Pockedio

按 `Command + T` 新建一个标签页，然后运行：

```bash
pockedio
```

现在就可以开始听了。

## 第 23 步：如何退出

在 Pockedio 会话里，你可以输入：

```text
quit
```

或者：

```text
exit
```

也可以按：

```text
Control + C
```

如果你要停止网易云音乐 API adapter，切到运行它的 Terminal 标签页，按：

```text
Control + C
```

## 第 24 步：如何更新 Pockedio

如果你是按这份教程从 GitHub 安装的，以后可以这样检查更新：

```bash
pockedio update --check
```

如果提示有更新，运行：

```bash
pockedio update
```

更新时不要关闭 Terminal。

如果更新失败，可以手动更新：

```bash
cd ~/Pockedio
git pull origin main
npm install
npm run build
npm link
```

## 第 25 步：如果出问题，先看这里

### 问题：`pockedio: command not found`

意思是 Mac 还不认识 `pockedio` 这个命令。

运行：

```bash
cd ~/Pockedio
npm link
```

然后再试：

```bash
pockedio status
```

### 问题：`npm: command not found`

说明 Node.js 没装好。

运行：

```bash
brew install node
```

然后检查：

```bash
node -v
npm -v
```

### 问题：播放不了歌

先确认网易云音乐 API adapter 是否还开着。

你应该有一个 Terminal 标签页正在运行：

```bash
spikes/scripts/run_netease_api.sh
```

如果没有，重新打开一个 Terminal 标签页运行：

```bash
cd ~/Pockedio
spikes/scripts/run_netease_api.sh
```

再回到 Pockedio 里重试。

### 问题：很多歌找得到但播不了

可能是匿名播放限制或歌曲版权限制。

建议重新设置网易云登录：

```bash
pockedio setup netease
```

选择：

```text
Yes, scan QR
```

然后用网易云音乐 App 扫码登录。

### 问题：LLM 没反应，或者不能生成 station

检查设置：

```bash
pockedio setup llm
```

确认：

- 选择了正确的 provider。
- API Key 没有粘贴错。
- 你的 API Key 账户还有额度。
- 网络可以访问对应 provider。

### 问题：日历权限失败

打开 Mac 的：

```text
System Settings -> Privacy & Security
```

中文系统里是：

```text
系统设置 -> 隐私与安全性
```

检查 `Calendars` 或 `Automation` 相关权限，允许 Terminal 访问 Calendar。

然后重新运行：

```bash
pockedio setup calendar
```

### 问题：不知道 Pockedio 的本地数据在哪里

Pockedio 的本地数据一般在：

```text
~/.pockedio/
```

里面可能有：

```text
config.json
pockedio.sqlite
taste.md
secrets/
audio/
```

不要把 `secrets/` 里的内容发给别人。那里可能有 API Key 或网易云登录信息。

## 推荐的新手选择

如果你只想尽快用起来，第一次设置时可以这样选：

- 网易云音乐：`Yes, scan QR`
- 播放音质：`exhigh`
- DJ 声音：`Built-in voices -> Vale`
- 导入口味：有常听歌单就选 `Y`，没有就选 `N`
- 天气：想要更贴近场景就选 `Y`
- Calendar：第一次先选 `N`
- Diary：第一次先选 `N`
- Scheduled DJ：第一次先选 `Not now`
- LLM：选择你已经有 API Key 的 provider

这样设置的目标是：先让 Pockedio 稳定播歌，再逐步打开更复杂的个性化功能。

## 最小成功标准

安装完成后，你应该能做到：

1. 一个 Terminal 标签页运行网易云音乐 API adapter：

```bash
cd ~/Pockedio
spikes/scripts/run_netease_api.sh
```

2. 另一个 Terminal 标签页运行 Pockedio：

```bash
pockedio
```

3. 在 Pockedio 里输入：

```text
play something soft for late-night focus
```

4. Pockedio 生成 station 后，按 `Return` 开始播放。

做到这一步，就说明安装和基本使用已经成功。
