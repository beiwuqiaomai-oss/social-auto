# 社媒自动发布系统（social-auto）设计规格

日期：2026-08-26（2026-08-27 重大更新：平台连通性 spike 全部完成，按实测结论修订）
状态：定稿（含实测验证）
品牌：yumecosplay（cosplay 服装，跨境电商）

## 1. 目标

每天无人值守、定时、零验证码地将 1 条素材分发到 **6 个社媒平台**（Reddit 已移除），文案由 AI 自动生成（英文），失败自动重试并发邮件告警，全程无需人工参与。

## 2. 平台与接入方式（2026-08-27 实测定稿）

| 平台 | 接入方式 | 状态 | 依赖/库 | 凭据来源 |
|---|---|---|---|---|
| Instagram | **Instagram Login 原生 API**（graph.instagram.com） | ✅ 实测发帖成功 | requests | Streaming media-IG 应用 |
| Threads | Threads API（graph.threads.net） | ✅ 实测发帖成功 | requests | Threads 应用 1065598266325520 |
| Facebook 主页 | Graph API v21.0 + pages_manage_posts | ✅ 实测发帖+删除成功 | requests | 父应用 1360298842926776 |
| YouTube | Data API v3 resumable 上传 | ✅ 实测上传 17.9MB 成功 | requests | Google Cloud OAuth 桌面客户端 |
| X | API v2 + OAuth 2.0 PKCE | ✅ 通路已通（授权+API 验证），**等充值激活**（按量付费 $0.015/帖，文案不带链接不触发 $0.20 税） | requests | Client ID/Secret |
| Pinterest | 双模式：browser（默认）/ api | ⏳ Trial 审批中；**架构预留双模式**，批→切 API，拒/等→浏览器 | requests + agent-browser | 应用 1605352 |
| ~~Reddit~~ | ~~OAuth script app~~ | ❌ **已移除**（Responsible Builder Policy 关闭自助申请，2026-08-27 决定） | — | — |

**全部凭据细节（key/ID/时效性/续期机制）见 `docs/平台凭据总表.txt`（权威文件，实现时直接调用）。**

实测关键结论：
- Meta/X 强制 https 回调 → 本地自签证书方案（浏览器点"高级→继续前往"）已验证可行
- 授权统一采用**手动 code 模式**（打印链接→任意浏览器授权→复制回调地址栏 URL 粘贴回终端），不依赖默认浏览器弹窗
- IG 走原生体系（IGAA token，每日自动续期 60 天）优于 Facebook 体系
- token 续期全部自动化：唯一人工前提 = 系统每 60 天内至少运行一次（天天跑天然满足）

## 3. 目录结构

```
social-auto\
├── config.yaml        # 时间表/品牌/语气/共享盘路径/Pinterest模式/收件邮箱
├── .env               # API 密钥（DEEPSEEK_API_KEY、SMTP、SHOPIFY_*，不进 git）
├── auth\              # 各平台 OAuth token（json 文件，不进 git，从部署机 spike_meta_token.json 迁移）
├── materials\
│   ├── inbox\         # 素材池（指向共享盘，config 配 UNC 路径）
│   └── posted\        # 已发归档，按月分文件夹（发完自动移入）
├── state.json         # 当日/历史发布状态、素材消耗记录（幂等依据）
├── logs\              # 每日运行日志
├── stats\posts.csv    # 发布记录：date,platform,material,status,post_url,error
├── core\
│   ├── pipeline.py    # 主流程入口（含 --dry-run / --only <platform>）
│   ├── material.py    # 素材选取、分组、归档、图片合成视频、余量告警
│   ├── copywriter.py  # DeepSeek 文案生成
│   ├── scheduler.py   # 当日时间表与错峰等待
│   └── notify.py      # SMTP 邮件告警
├── platforms\
│   ├── ig_native.py   # Instagram 原生 API（IGAA token + 每日续期）
│   ├── threads.py     # Threads API
│   ├── facebook.py    # FB 主页
│   ├── youtube.py     # resumable 上传
│   ├── x.py           # API v2 OAuth2 PKCE
│   ├── pinterest.py   # 双模式：browser（默认）/ api（Trial 批准后可切）
│   └── shopify.py     # 公网素材 URL 上传（IG/Threads/Pinterest 图片必需）
├── gui\
│   ├── app.py         # 主窗口（侧边栏导航 + 五页签）
│   ├── i18n.py        # 中/英文案字典 + 语言切换
│   ├── theme.py       # 深色/浅色/跟随系统切换（CustomTkinter appearance_mode）
│   ├── dashboard.py   # 页签1：今日发布看板
│   ├── history.py     # 页签2：素材余量+发布历史
│   ├── settings.py    # 页签3：配置编辑器（LLM/SMTP/时间表/品牌/Pinterest模式/语言/主题）
│   ├── tokens.py      # 页签4：token 健康度
│   └── logs.py        # 页签5：日志/告警查看
├── build\
│   └── build_exe.bat  # PyInstaller 打包脚本（单个 EXE）
└── auth_wizard.py     # 应急授权工具（手动 code 模式，GUI token页内置同流程）
```

## 3.5 GUI 面板设计（2026-08-27 新增，CustomTkinter）

**产品形态**：单个 EXE（PyInstaller ~15MB），双击默认打开 GUI；`--run`/`--watchdog` 参数走无头模式（计划任务调用）。GUI 与计划任务共用单写者锁，手动触发抢不到锁时提示"运行中"。

**全局**：左侧边栏五页签导航；中/英文案切换（i18n 字典）；深色/浅色/跟随系统主题切换（内置 CustomTkinter appearance_mode）；设置持久化到 config.yaml。

**页签1 今日发布看板（Dashboard）**：
- 顶部控制条：`▶ 立即运行` / `🧪 试运行(Dry-Run)` / `⏸ 暂停自动发布`（写 config 开关，无头运行启动时检查）+ 进度徽章（X/6 完成）
- 今日素材卡：文件名、IP/角色、类型（视频/图片组）
- 平台状态表：平台 | 计划时间 | 状态（待发/成功/失败/跳过）| 帖子链接 | 错误摘要 | 行内`重试`按钮（仅失败行）
- **文案编辑区（2026-08-28 新增）**：点平台行显示该平台当日文案（text/title/description/tags 分字段可编辑）+ `应用到今日`按钮（写回 state.json 当日文案，当天未发的平台用编辑后版本；已发平台不受影响）+ `AI重新生成`按钮（对该平台重调 LLM）+ `预生成今日文案`按钮（在自动运行前手动触发：选素材→调 LLM→缓存文案，之后可编辑，到点无头运行直接用缓存）。支持完全手写（不点 AI，直接在空字段填写后应用）。无人值守模式不强制等待编辑（AI 生成后按计划直接发），编辑是可选的人工干预点。

**页签2 素材余量+历史**：
- 素材池状态卡：剩余素材数、折算可发天数（<7 天变警示色）
- inbox 待发列表（文件名排序）
- 发布历史表（posts.csv 渲染）：日期 | 平台 | 素材 | 状态 | 链接（点击打开）

**页签3 配置编辑器（Settings）**：分组表单，全部写回 config.yaml/.env
- LLM 三件套：API Key（掩码显示）/ Base URL / 模型名 / `测试连通`按钮（发一条测试请求）
- SMTP：host/port/user/pass/告警收件箱 + `发送测试邮件`
- 发布时间表：六平台时刻 + `自动发布总开关`（暂停即关）
- 品牌：品牌名、@提及策略
- Pinterest 模式：browser/api 单选
- 素材路径：inbox/posted（UNC）
- 语言与主题：中/英、深/浅/系统

**页签4 Token 健康度**：
- 平台 token 表：平台 | 类型 | 剩余有效期（IG/Threads/FB 按到期日倒计时，YouTube/X 显示"永久"）| 状态 | `续期/授权`按钮（拉起内置手动 code 授权向导，复用 spike 流程）

**页签5 日志/告警**：
- 最近运行日志滚动视图（自动刷新，可暂停滚动）
- 告警列表（失败/token 过期/素材不足等历史）

**LLM 中转站支持**：Base URL + API Key + 模型名三件套可填任意 OpenAI 兼容端点（DeepSeek 官方/中转站/其他模型）。**全部在面板 Settings 内随时填写修改**（用户自填，不预置真实值；默认占位 DeepSeek 官方格式）。

**素材路径**：inbox/posted 路径同样**面板内随时可改**（Settings → 素材路径），保存即生效（写入 config.yaml），无需改文件。

**更新仓库（已创建）**：`github.com/beiwuqiaomai-oss/social-auto`（公开，与先见岛仓库隔离）。版本发布、Release 上传、客户端检查更新均指向此仓库。

**软件自动更新（移植自抠图项目的成熟方案）**：
- 版本检查：读 GitHub 仓库 latest release 的 tag_name 与本地 APP_VERSION 语义化比较（GitHub API 走 gh-proxy.com 代理优先，失败回退直连）
- 下载源三级回退：`gh-proxy.com`（国内加速）→ `ghproxy.net`（备选加速）→ GitHub 直连，去重后逐个尝试
- 安全校验：Content-Length 比对 + PE 文件 MZ 魔数校验（防下载到错误页/残缺文件）
- 自更新（便携单 EXE 方案）：运行中的 EXE 先自我改名为 `_old.exe`（Windows 允许运行中重命名）→ 写入新 EXE → 启动新版本退出旧进程 → 新版本启动时清理 `_old.exe`；无安装器，比抠图的 Inno Setup 方案更简洁
- UI：Settings 页"关于/更新"区：当前版本号 + `检查更新`按钮 → 有新版弹窗（版本号+更新日志+文件大小）→ `立即更新`（进度条+取消按钮）
- 发布配套：build_exe.bat 打包后用发布脚本上传 GitHub Release（复用抠图项目 publish_release.py 模式）

**手动触发安全**：`立即运行`/单平台`重试`均弹确认框（列出将真实发布的平台清单）后执行。

**自动发布操控（面板内）**：① 暂停/恢复总开关（写 config，无头运行启动时检查）② 发布时间表编辑（改后自动重注册 schtasks）③ 单平台启停（如 Pinterest 审批期间单独停用）。

**托盘常驻**：面板支持最小化到系统托盘；提供"开机自启"开关（用户可选），托盘菜单：打开面板/今日状态/退出。自动发布不依赖面板常驻（计划任务独立运行）。

**已确认决策（2026-08-27）**：X 平台代码完整内置 EXE（通路已验证仅差充值激活，后续测试如需修改仅改 platforms/x.py 重打包，零架构影响）。

**凭据权威文件**：`docs/平台凭据总表.txt`——实现时所有 key/ID/续期机制以它为准，不得重新申请。

## 4. 素材规范

- 素材池 = 共享盘上一个目录（config 配 UNC 路径，如 `\\server\share\social-materials\inbox`）。
- 支持类型：视频 `mp4/mov/webm`；图片 `jpg/jpeg/png/webp`。
- **命名规范（硬性）**：`IP名__角色名__序号[-组内序号].扩展名`，双下划线分隔三段。IP/角色名写中文或英文均可。
  - 单视频：`原神__雷电将军__001.mp4`
  - 图片组（发轮播）：`原神__雷电将军__002-1.jpg`、`原神__雷电将军__002-2.jpg`
- **1 条素材** = 1 个视频文件，或 1 组同 `IP__角色__序号` 前缀的图片（发 IG 轮播 / Pinterest 多图）。
- 选取规则：按序号排序，取最早的未使用素材；发布成功后整组移入 `posted\YYYY-MM\`。
- 命名不符合规范的素材：自动跳过（取下一条合规素材），日志记录并发邮件提醒改名；素材保留在 inbox，改名后次日即可被正常取用。
- 当日素材为图片组时：YouTube 不跳过——由 ffmpeg 将图片组合成幻灯片视频（每图约 4 秒 + 交叉淡化，16:9）后上传；**BGM 策略：不嵌入任何外部音乐**（用 YouTube 上传后的自动配乐或静音，规避版权侵权）；合成失败时当日退回跳过并记日志，不影响其他平台。
- 余量监控：剩余可发天数 < 7 时发邮件提醒补素材；素材池为空当天只发告警邮件，不动其他状态。

## 5. 每日流程与时间表

schtasks 每天 11:55（北京时间）以当前用户账户触发 `python core\pipeline.py`（用户账户运行是访问共享盘的前提，不能用 SYSTEM）。

进程内时间表（北京时间，全部落在 9:00–18:00、集中在中间段，间隔 30 分钟错峰）：

| 时间 | 平台 |
|---|---|
| 12:00 | Instagram |
| 12:30 | Threads |
| 13:00 | Facebook Page |
| 13:30 | X |
| 14:00 | YouTube（视频日直发；图片日合成幻灯片视频后发） |
| 14:30 | Pinterest |

流程：
1. 启动时读 `state.json` 判断当日各平台状态——**幂等续跑**：当天进程中断后重新触发，已成功的平台自动跳过（应对中途重启机器）。
2. 选取当日素材（见第 4 节）。
3. 调 DeepSeek 一次性生成当日全部文案（见第 6 节）。
4. 按时间表逐平台发布；每平台失败自动重试 1 次，仍失败则记录并继续下一平台。
5. 每步结果实时写 `state.json` 与 `stats\posts.csv`。
6. 结束时汇总：有失败 → 发告警邮件（含平台、错误、素材名）；全部成功 → 不发邮件。

**调度可靠性设计（防漏跑/重叠/重复发布）**：

- **运行契约**：一次成功运行 = 当日计划内平台全部到达终态（成功或按规则跳过/失败已告警）；可接受迟至当日 23:00 完成（含补跑）。
- **单写者锁**：pipeline 启动即获取锁文件（含 PID），若已有实例在运行则本次直接退出并记日志——杜绝计划任务重触发或人工+定时并发导致的重复发帖。
- **时间基准**：全部使用机器本地时间（UTC+8，无夏令时切换），state.json 日期键 = 本地日期，不存在夏令时双发/漏发窗口。
- **截止**：单平台操作超时 10 分钟；定时轮次 deadline 当日 18:00，超时未执行的平台记 skipped 并告警；补跑轮次硬停 23:00。
- **漏跑/卡死检测**：第二个计划任务 watchdog 每天 20:00 检查 state.json——当日无运行记录（机器白天没开/触发丢失）→ 告警邮件 + 自动补跑；有运行记录但未完成（卡死）→ 告警 + 续跑。
- **补跑（catch-up）**：pipeline 支持 `--catchup`——当日未完成平台立即逐个发布（间隔 5 分钟压缩错峰），幂等跳过已成功平台；**跨日不回补**（社媒内容时效性优先），缺口记录进 stats。
- **素材在途保护**：当日素材选定即写入 state（material_key），进程中断重跑复用同一素材不重选；仅当日全部平台终态后才归档移盘，杜绝素材被重复消费或丢失。
- **完成证据**：state.json 每日记录 run_started_at / run_ended_at / 各平台终态与 post_url；stats\posts.csv 为可审计的运行历史，"没发出去"永远可被发现而非被静默吞掉。

## 6. 文案生成（LLM，OpenAI 兼容端点）

- LLM 三件套（Base URL / API Key / 模型名）面板内配置，兼容 DeepSeek 官方与任意中转站。
- 输入：素材命名中解析出的 IP 名与角色名、品牌信息、各平台格式要求；输出：一份 JSON，含全部平台文案。中文 IP/角色名由 LLM 转换为英文常用名/圈内别名后写入文案与标签（如 雷电将军 → Raiden Shogun）。
- 语言英文，语气：cosplay 种草向，活泼、突出服装还原度与上身效果，不硬卖。
- **去AI味（2026-08-28 新增，硬性要求）**——提示词包含以下规则：
  - 像真实 cosplayer 本人随手发的帖子，**不是**品牌营销文案
  - 禁 AI 套话/陈词滥调："stunning", "elevate", "game-changer", "dive into", "must-have", "level up your..." 等一律不用
  - 禁 "not just X, but Y" / "Whether you're X or Y" 这类 AI 高频句式
  - 句子长短参差，允许口语化缩写（gonna/obsessed/fr）和轻微不完整句；**不堆 emoji**（IG 最多 2-3 个，其余平台 0-1 个）
  - 用具体细节代替形容词堆砌：说 "the gradient on the sleeves is spot on" 而不是 "amazing quality"
  - 允许一点真实的个人视角（如 "wore this all day at the con, zero regrets"）
- 品牌露出（config per-platform 可改）：全部平台文案轻量带 `@yumecosplay`。
- **文案永不含 URL**（X 平台带链接 $0.20/帖 + 品牌策略：链接在主页不挂文案）。
- **手工文案优先机制（2026-08-28 新增）**：当日文案生成后缓存进 state.json（`copies` 字段）；面板可编辑并"应用到今日"；pipeline 发布某平台前检查——**存在当日缓存文案（含手工编辑版）则直接使用，不重新生成**；编辑只影响当天未发的平台。
- 各平台格式：
  - X：≤280 字符 + 2–3 个 hashtag
  - IG：caption（可含 emoji）+ 最多 10 个 hashtag
  - Threads：短正文，无标签或 1 个标签
  - FB Page：正文（可稍长）+ 2–3 个 hashtag
  - Pinterest：title（≤100 字符）+ description（≤500 字符，关键词自然植入）
  - YouTube：标题（≤90 字符）+ 描述 + tags
- 文案失败（API 超时等）重试 2 次，仍失败则当日告警邮件并终止当日发布。

## 7. 授权与 token 管理（2026-08-27 实测定稿）

- **token 已全部获得并存于部署机 `spike_meta_token.json`**，实现阶段迁移到 `auth\`（见《平台凭据总表》），无需重新授权。
- `auth_wizard.py` 保留为应急工具（token 真过期时用），全部采用已验证的**手动 code 模式**（同 spike-kit 流程）。
- 各平台续期机制（自动执行，无人值守）：
  - IG 原生：每日运行时 `ig_refresh_token` 续 60 天
  - Threads：自动 refresh_access_token
  - FB：每次运行 `fb_exchange_token` 交换长效
  - YouTube / X：refresh_token 永久，access 自动换
  - Pinterest（API 模式）：自动 refresh
- 唯一失效条件：连续 60 天以上停机 → 告警邮件引导重跑 auth_wizard
- Pinterest 浏览器兜底模式：复用部署机 Chrome 已登录 Pinterest 的用户配置（agent-browser，反检测：屏蔽 `AutomationControlled` + 真实 UA）。

## 8. 失败处理与告警

告警邮件触发条件（收件邮箱、SMTP 均在 `.env`/config 配置）：
1. 任一平台重试后仍失败（含错误信息）
2. 素材池余量 < 7 天
3. 素材池为空
4. 任一平台 token 失效
5. 文案生成失败
6. 发现命名不符合规范的素材（列出文件名，提醒改名）

单平台失败不影响其他平台；当日结果全部落 `stats\posts.csv`。

## 9. 统计

- 一期（本设计范围）：`stats\posts.csv` + `state.json`，命令行报告当日结果。
- 二期（可选，不在本次实现）：拉取 Meta/YouTube 互动数据、本地网页面板。

## 10. 开发与部署（本机开发 → 常开机器部署，Win10 专业版 64 位）

常开机器无开发环境，采用便携式部署包（方式同 Hermes v11 交付经验），目标机器**零安装**。

**阶段一：本机开发与调试**
1. 本机完成全部代码开发。
2. 本机跑 `auth_wizard.py` 完成各平台 OAuth 授权（token 文件不绑机器，随包拷贝）。
3. 本机 `--dry-run` 验证全流程，再逐平台真实发布测试（真实账号、真实素材）。

**阶段二：打包**
4. 便携包结构：嵌入式 Python 3.11 + 全部依赖 + 代码 + `config.yaml` + `.env` + `auth\`（token），zip 交付。
5. 打包前审计：不含本机绝对路径、不含密钥明文以外的新增敏感信息（.env/auth 本来就是密钥，随包走属预期）。

**阶段三：常开机器部署**
6. 解压 zip → 运行 `install.bat`（注册 schtasks：每天 11:55 以当前用户账户运行，记住密码模式以保证可访问共享盘）。
7. 常开机器 Chrome 手动登录一次 Pinterest（浏览器登录态无法随包迁移，此为唯一一次性人工动作）。
8. 验证：手动触发一次计划任务，确认能读共享盘、正常发布。
9. 常开机器需可访问外网（各平台 API 域名 + DeepSeek + SMTP）。

## 11. 已知风险（如实声明，2026-08-27 实测更新）

1. **YouTube 私密锁**：⚠️ 待确认——上传实测成功（HTTP 200），上传时显式设置 public；最终公开/私密状态需用户在 YouTube Studio 确认（已请用户查看）。若被锁：提交 Google 免费合规审核。
2. **Pinterest Trial 审批不确定**：审批中；期间与被拒场景走浏览器兜底（Pinterest 风控温和，风险低但非零）；**架构已预留双模式，切 API 零改动成本**。
3. **X 按量付费**：通路已验证，等充值激活；$0.015/帖（无链接），文案策略已锁定"永不含 URL"规避 $0.20/帖。若 X 未来涨价，浏览器兜底为备选。
4. **通用**：API 路线触发验证码概率≈0（4 平台实测零验证码），但任何平台的风控/政策变化无法 100% 预知，不承诺绝对零风险。

## 12. 验收标准

1. `--dry-run` 全流程跑通：选素材 → 生成 6 份文案 → 输出当日计划，不真实发布。
2. 每个平台真实发布 1 条测试内容成功（分平台逐一验证；IG/Threads/FB/YouTube 已在 spike 阶段验证过通路）。
3. 连续 3 天无人值守自动发布全部成功。
4. 人为断网制造失败 → 收到告警邮件，且次日恢复正常。
5. 素材自动归档、`state.json` 断点续跑验证（中途杀进程重跑，不重复发帖）。
6. 命名不规范素材被跳过并触发邮件提醒；改名后次日恢复取用。
7. 图片素材日：YouTube 幻灯片视频合成并发布成功（方案 B）。

## 13. 依赖（精简，2026-08-27 更新）

`requests`（全平台 API 直调——spike 实测确认无需 tweepy/praw/google-sdk，手动实现 OAuth 与上传更可控）、`pyyaml`、`python-dotenv`、`openai`（DeepSeek 兼容）、`cryptography`（本地 https 回调证书）、`agent-browser`（Pinterest/浏览器兜底，部署时从 F:\zsw\HermesAgent 复制）、`ffmpeg`（部署机安装，图片合成视频用）。

**平台模块代码蓝本 = spike-kit/spike_meta.py**（全部流程已实测验证，正式实现直接移植改造）。
