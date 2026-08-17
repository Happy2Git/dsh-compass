# dsh-compass

[English](README.md) | 中文

> **⚠️ 警告：npm 发布版 dsh 无法显示本面板——官方源码构建可以。** DeepSeek Harness 最近一次 npm 发布早于面板渲染所需的 web 槽位系统。上游 `master`（≥ `47f9438`，已验证）已包含槽位系统、模块加载器与 `shell.overlay` 挂载点，可直接承载本包——从官方仓库源码构建后安装即可。[fork](https://github.com/Happy2Git/deepseek-harness) 则内置同一面板。详见[要求](#%EF%B8%8F-要求)。

单包形态的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：为 Web 界面新增右侧上下文文件面板——带 git 状态徽章的目录浏览、实时重投影的注入上下文文档与压缩历史流水（来源标注 + 实测占用条 + 未读信号）、带边框的只读 Git 提交图与工作区状态、面板文件拖入对话（支持图片的模型直接收图），以及会话日志下载动作。

一个包 = 一个 bundle = 一行 loader 条目：host 半把本地 Git 后端（`/git/*`）、插件自有目录路由（`/dir/*`）和 `/export` 命令作为子插件挂载；浏览器半把面板注册进 `shell.overlay`，把下载动作注册进面板头部工具区。

## ⚠️ 要求

面板通过 web 槽位系统渲染（`window.__ModuleLoader__`、冻结模块表、`ui-layout` 的 `shell.overlay` 挂载点）。dsh-compass 适配的是 DeepSeek Harness 的 GitHub 源码版本——npm 发布版早于槽位系统。先从源码构建它：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install && pnpm run build
```

宿主分三档，2026-08 实测：

- **上游 `master` 源码构建——可用。** `https://github.com/deepseek-ai/deepseek-harness` 的 `47f9438` 已包含槽位系统、`dsh.client` 清单处理和 `shell.overlay` 渲染点；本包的外部模块全部可解析，面板正常挂载。按下面的步骤从源码构建官方仓库即可——npm 发布版还落后于这些提交。
- **[fork](https://github.com/Happy2Git/deepseek-harness)——可用，面板内置。** fork 默认 `web` profile 自带同一面板，在 fork 上安装本包是为了运行独立产物。
- **npm 发布版——不可用。** 最近一次 npm 发布早于槽位系统；「每一步安装检查都通过、界面上却没有面板」就是它的预期症状。等下一次包含槽位系统的上游发布。

先确认宿主的挂载面：

```sh
pnpm dsh --profile web --dump-config
```

fork 上输出里必须包含 `ui-context-files`、`git`、`directory-routes`、`session-log-download` 四行。上游源码构建上，面板不依赖任何上游行——改查服务页面的启动清单里有 `modules` 行（`packages/client/modules`，即 `__ModuleLoader__` 的提供方）。

## 截图

**文件夹标签** — 惰性目录树，目录优先排序，按名过滤，带 git 工作区状态徽章，每行可打开/复制。文件行显示自身状态字母（A/M/D/U/!）；目录行聚合其下最强的状态并描边显示（目录内含修改/新增/删除/未跟踪，整目录忽略显示 !），大仓库根目录也能在输出上限内完成折叠：

![文件夹标签](screenshots/01-files-tab.png?v=3)

更多截图见安装之后的[效果展示](#效果展示)。

## main-track 兼容性

本包自带它需要的全部能力面，因此可以装到任何 web 组合包含槽位系统的 dsh 构建上（槽位系统已在上游 `master`；最后一次 npm 发布早于它）：

- 目录列表与文本读取走包内自带的有界浏览器（`/dir/*` 直接读文件系统——不需要 `directoryPicker.readText`、不需要 browse 后端，profile 组合了原生选择器也能用）；
- git seam 与本地后端随包内置（`ctx.subprocess` + `ctx.webServer` 来自基础组合）；
- 对话避让使用包自己的 `--dsh-compass-width` 变量 + 针对 shell 稳定钩子 `[data-shell-overlay]` 的 CSS `:has()` 规则——不需要 fork 的 CSS（fork 内置规则读的是另一个变量，任何组合都不会双重避让）。

## 安全与性能

**安全。** 本包注册的所有宿主路由仅限回环，在非回环 webserver 主机上直接拒绝加载。请求体上限 64 KiB 且必须是 `application/json`；路径必须完全限定，线上值绝不会相对宿主工作目录解析。读取失败即关闭：超限图片整读拒绝（`file-too-large`，叠加已组合附件的单文件上限 413），图片格式按魔数判定而非文件名扩展名，git 哈希做格式校验使选项无法混进哈希槽，工作区 diff 路径必须留在仓库内，仓库外的 git 调用回答 `not-a-repository`。面板只读：git 命令从不写入，拖入的图片从不复制进工作区，文件内容只经有界读取路由跨线。

**性能。** 上下文标签的文档流做了签名门控，面板只在注入文档真正变化时重投影、重渲染，不随每个流式批次动作。完整历史经 `/dir/injected-docs` 获取，该路由在服务端过滤持久化日志、只发文本块；在 18 万事件的会话上，它把每次激活约 120 MB 的历史页 JSON 换成单次 KB 级响应。所有列举与读取都有界（`maxEntries`、`maxTextBytes`、`maxImageBytes`、git 的 `maxOutputBytes` 与 `maxCommits`），每次抓取都挂 `AbortSignal` 随调用方取消，按会话的抓取标记随会话列表剪枝，离开的会话不留下累积。目录徽章的忽略项走 `ls-files --directory` 折叠列出，一个 node_modules 只占一行（fork 仓库根目录实测 14 MB 输出降到约 18 KB）；截断时仅忽略项优雅降级，M/A/D/U 徽章不受影响。

## 安装

**克隆后安装。** clone 本仓库、构建，然后回到 dsh 检出目录按路径安装：

```sh
git clone https://github.com/Happy2Git/dsh-compass.git
cd path://dsh-compass        # 本机上的 dsh-compass 检出目录
pnpm install                 # 装构建工具链（tsdown）——每个 clone 一次
pnpm run build               # 产出 lib/（index.js + client.js）
```

然后回到 dsh 检出目录：

```sh
pnpm dsh plugin --profile web add path://dsh-compass
```

到此安装完成。两条性质使它成为本项目开发对标的安装方式：

- **没有 allowBuilds 步骤。** pnpm 把本地目录按 `link:` 依赖安装，不会运行它的 `prepare` 脚本，因此不存在构建授权门槛——`lib/` 由 clone 自己的 `pnpm run build` 产出。
- **profile 记录的是文件系统链接。** 这份安装随 clone 生、随 clone 灭：检出目录不能删也不能挪；在 clone 里重新 `pnpm run build` 后重启 `pnpm dsh web` 即生效，无需重新 add。

**可复现部署：钉 commit 的 git 安装。** 宿主上没有 clone 时，用 GitHub spec 安装并放行 pnpm 拦截的构建：

```sh
pnpm dsh plugin --profile web add github:Happy2Git/dsh-compass#<commit-sha>
```

git 安装通过包的 `prepare` 脚本从源码构建（纯转译，无开发环境依赖）。pnpm ≥10 会拦截构建脚本：首次 `add` 失败后，把 pnpm 打印的确切键复制进 profile 的 `pnpm-workspace.yaml`——同一个 commit 可能打印出两种键（`codeload.github.com/.../tar.gz/...` 和 `git+https://github.com/...git#...`），**两种都放行**再重跑同一条 `add`。不要手动进 `node_modules` 补构建：失败的 `add` 不会登记层，手动构建同样不会登记。这条允许意味着「安装时执行本包代码」，请固定 commit，防止后续推送悄悄改变执行内容。

两种安装都要核对：

   - `~/.dsh/profiles/web/package.json` 的 `dependencies` 和 `dsh.profile.bundles` 里都有 `dsh-compass`（bundles 缺条目说明 `add` 没有成功，补跑 `pnpm dsh plugin --profile web install` 登记）；
   - `~/.dsh/profiles/web/node_modules/dsh-compass/lib/` 里有 `index.js` 和 `client.js`（本地 clone 由 `pnpm run build` 产出，git 安装由 `prepare` 产出）。

**上游源码构建**到此即可：本包自己的 bundle patch 会禁用官方的 `session-log-download` 行（它的 `/export` 命令与本包的撞名；本包自带该命令与自己的下载按钮和对话框，ZIP 端点本身属于 ApiProxy，不受影响）。

**fork** 默认的 `web` profile 已内置同一面板。改用本包时，在 profile 自己的 `cordis.patch.yml` 里禁用内置面板行（`session-log-download` 已由本包的 patch 处理）：

   ```yaml
   - id: ui-context-files
     disabled: true
   - id: git
     disabled: true
   - id: directory-routes
     disabled: true
   ```

启动（若已在运行则重启）`pnpm dsh web`，刷新页面后核对：`curl -X POST http://127.0.0.1:<端口>/dir/list -H 'content-type: application/json' -d '{"path":"<任意目录>"}'` 返回 JSON（host 半已挂载），浏览器控制台没有 `__ModuleLoader__` 报错，右侧出现面板。

## 效果展示

**Git 标签** — 带边框的工作区区块加提交树：分支位置、未提交文件、泳道、引用徽章、惰性展开提交与刷新按钮。工作区行与提交内文件都在中部弹出 diff，按行角色着色：

![Git 标签](screenshots/02-git-tab.png?v=3)
![工作区 diff 预览](screenshots/06-workspace-diff.png?v=3)

**上下文标签** — 注入上下文文档分为当前有效窗口与压缩历史流水，带搜索；视图随会话事件流实时重投影，会话激活时带外拉取完整历史（最多 1,000 条消息，不动共享对话窗口），两个区块持有完整日志。v0.14 起标签头新增**占用条**（按字节实测的窗口占用，分指令文件/技能/插件/跨会话召回/运行时五类来源着色）、每篇文档带**来源标注与实测大小**、历史流水头部注明**最近一次压缩**移出的篇数与体量；不在上下文标签时，新注入与压缩边界移动会让「上下文」标签页带**未读计数**徽标（打开即清零，折叠态显示圆点）：

![上下文标签](screenshots/03-context-tab.png?v=4)

**目录优先** — 指向目录的符号链接与目录同组排序：

![文件夹标签，目录优先](screenshots/04-files-tab-dirs-first.png?v=3)

**面板文件拖入** — 文件行把绝对路径拖进对话。fork 上由 composer 原生接收（支持视觉的模型对图片直接附加内容）；其他宿主——包括尚不认识该拖拽 MIME 的上游源码构建——由包内自带的整窗接收器接住拖放，把路径说明追加进草稿，模型仍可用工具处理该路径。接收器对已认领拖拽的 composer 主动让位，两种宿主都只有一条接收链路：

![面板文件拖入](screenshots/05-drag-image.png?v=3)

## 卸载

```sh
pnpm dsh plugin --profile web remove dsh-compass
```

它执行 `pnpm remove` 并把本包从层列表摘除；profile 无法启动时这条命令仍然可用。fork 上删掉上面加的三行 `disabled: true` 恢复内置面板；上游构建上被本包 patch 禁用的 `session-log-download` 行随卸载自动恢复。

## 面板仍然不出现时

- **官方 npm 发布版 dsh。** 预期行为，不是安装失败。发布版没有槽位系统，面板无法渲染；按上文卸载，要么按安装一节从上游 `master` 源码构建，要么等下一次上游发布。
- **启动报 `ERR_MODULE_NOT_FOUND`。** `prepare` 构建被拦截或未执行；补 `allowBuilds` 后重跑 `add`。
- **启动报 `command "export" is already registered`。** 组合里还在挂官方 `session-log-download` 行，而本包的 patch 没排在它后面生效。确认 `dsh.profile.bundles` 里有 `dsh-compass`（插件 `add` 会排在官方 bundle 之后），且 profile 的 `node_modules/dsh-compass/cordis.patch.yml` 里有对 `session-log-download` 的禁用。
- **host 路由有响应，界面没有面板。** 宿主构建缺槽位系统；回到要求检查。

## 构建

`pnpm build`（也就是 `prepare` 脚本）只跑 tsdown：发布入口从 `src/` 转译、不做类型检查，git 安装因此完全自包含。类型安全由源码的源头负责：这些源码在抽取前经过 fork 严格聚合类型检查，仓库自带的 `tsconfig.json` 把 `@deepseek-ai/dsh-*` 类型映射到旁边的 `../deepseek-harness` 检出，供编辑器使用。

## 许可证

MIT。Copyright (c) 2026 DeepSeek。
