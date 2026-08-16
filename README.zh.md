# dsh-compass

[English](README.md) | 中文

单包形态的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：为 Web 界面新增右侧上下文文件面板——带 git 状态徽章的目录浏览、实时重投影的注入上下文文档与压缩历史流水、带边框的只读 Git 提交图与工作区状态、面板文件拖入对话（支持图片的模型直接收图），以及会话日志下载动作。

一个包 = 一个 bundle = 一行 loader 条目：host 半把本地 Git 后端（`/git/*`）、插件自有目录路由（`/dir/*`）和 `/export` 命令作为子插件挂载；浏览器半把面板注册进 `shell.overlay`，把下载动作注册进面板头部工具区。

## 要求

面板通过 web 槽位系统渲染，而 DeepSeek Harness 最近一次 npm 发布早于槽位系统，不包含它。在官方发布的 dsh 上，本包无法显示面板，任何安装步骤都改变不了这一点；典型症状是每一步安装检查都通过，界面上却没有面板。

请使用 [fork](https://github.com/Happy2Git/deepseek-harness)（`pnpm dsh web`）。fork 默认的 `web` profile 已内置同一面板，在 fork 上安装本包是为了运行独立产物。先确认挂载面：

```sh
dsh --profile web --dump-config
```

输出里必须包含 `ui-context-files`、`git`、`directory-routes`、`session-log-download` 四行。没有这些行，组合里就没有面板的挂载位置，到此为止。

## 截图

**文件夹标签** — 惰性目录树，目录优先排序，按名过滤，带 git 工作区状态徽章，每行可打开/复制：

![文件夹标签](screenshots/01-files-tab.png?v=3)

**Git 标签** — 带边框的工作区区块加提交树：分支位置、未提交文件、泳道、引用徽章、惰性展开提交与刷新按钮。工作区行与提交内文件都在中部弹出 diff，按行角色着色：

![Git 标签](screenshots/02-git-tab.png?v=3)
![工作区 diff 预览](screenshots/06-workspace-diff.png?v=3)

**上下文标签** — 注入上下文文档分为当前有效窗口与压缩历史流水，带搜索；视图随会话事件流实时重投影，会话激活时带外拉取完整历史（最多 1,000 条消息，不动共享对话窗口），两个区块持有完整日志：

![上下文标签](screenshots/03-context-tab.png?v=3)

**目录优先** — 指向目录的符号链接与目录同组排序：

![文件夹标签，目录优先](screenshots/04-files-tab-dirs-first.png?v=3)

**面板文件拖入** — 文件行把绝对路径拖进对话；图片文件在支持视觉的模型上直接附加内容，其他模型收到路径说明：

![面板文件拖入](screenshots/05-drag-image.png?v=3)

## main-track 兼容性

本包自带它需要的全部能力面，因此可以装到任何 web 组合包含槽位系统的 dsh 构建上（槽位系统已在上游 `master`；最后一次 npm 发布早于它）：

- 目录列表与文本读取走包内自带的有界浏览器（`/dir/*` 直接读文件系统——不需要 `directoryPicker.readText`、不需要 browse 后端，profile 组合了原生选择器也能用）；
- git seam 与本地后端随包内置（`ctx.subprocess` + `ctx.webServer` 来自基础组合）；
- 对话避让使用包自己的 `--dsh-compass-width` 变量 + 针对 shell 稳定钩子 `[data-shell-overlay]` 的 CSS `:has()` 规则——不需要 fork 的 CSS（fork 内置规则读的是另一个变量，任何组合都不会双重避让）。

## 安全与性能

**安全。** 本包注册的所有宿主路由仅限回环，在非回环 webserver 主机上直接拒绝加载。请求体上限 64 KiB 且必须是 `application/json`；路径必须完全限定，线上值绝不会相对宿主工作目录解析。读取失败即关闭：超限图片整读拒绝（`file-too-large`，叠加已组合附件的单文件上限 413），图片格式按魔数判定而非文件名扩展名，git 哈希做格式校验使选项无法混进哈希槽，工作区 diff 路径必须留在仓库内，仓库外的 git 调用回答 `not-a-repository`。面板只读：git 命令从不写入，拖入的图片从不复制进工作区，文件内容只经有界读取路由跨线。

**性能。** 上下文标签的文档流做了签名门控，面板只在注入文档真正变化时重投影、重渲染，不随每个流式批次动作。完整历史经 `/dir/injected-docs` 获取，该路由在服务端过滤持久化日志、只发文本块；在 18 万事件的会话上，它把每次激活约 120 MB 的历史页 JSON 换成单次 KB 级响应。所有列举与读取都有界（`maxEntries`、`maxTextBytes`、`maxImageBytes`、git 的 `maxOutputBytes` 与 `maxCommits`），每次抓取都挂 `AbortSignal` 随调用方取消，按会话的抓取标记随会话列表剪枝，离开的会话不留下累积。

## 安装

1. 先通过上面的要求检查，再固定 commit 安装：

   ```sh
   dsh plugin --profile web add github:Happy2Git/dsh-compass#<commit-sha>
   ```

2. Git 安装通过包的 `prepare` 脚本从源码构建（纯转译，无开发环境依赖）。pnpm ≥10 会拦截构建脚本：首次 `add` 失败后，把 pnpm 打印的确切键复制进 profile 的 `pnpm-workspace.yaml`：

   ```yaml
   allowBuilds:
     dsh-compass: true
   ```

   然后重跑同一条 `add`。不要手动进 `node_modules` 补构建：失败的 `add` 不会登记层，手动构建同样不会登记。这条允许意味着「安装时执行本包代码」，请固定 commit，防止后续推送悄悄改变执行内容。

3. 核对安装结果：

   - `~/.dsh/profiles/web/package.json` 的 `dependencies` 和 `dsh.profile.bundles` 里都有 `dsh-compass`（bundles 缺条目说明 `add` 没有成功，补跑 `dsh plugin --profile web install` 登记）；
   - `~/.dsh/profiles/web/node_modules/dsh-compass/lib/` 里有 `index.js` 和 `client.js`（由 `prepare` 构建）。

4. fork 默认的 `web` profile 已内置同一面板。改用本包时，在 profile 自己的 `cordis.patch.yml` 里禁用内置四行：

   ```yaml
   - id: ui-context-files
     disabled: true
   - id: git
     disabled: true
   - id: directory-routes
     disabled: true
   - id: session-log-download
     disabled: true
   ```

5. 重启 `dsh web`，刷新页面后核对：`curl http://127.0.0.1:<端口>/dir/list` 返回 JSON（host 半已挂载），浏览器控制台没有 `__ModuleLoader__` 报错，右侧出现面板。

本地目录安装不需要任何构建授权：

```sh
dsh plugin --profile web add ./dsh-compass
```

## 卸载

```sh
dsh plugin --profile web remove dsh-compass
```

它执行 `pnpm remove` 并把本包从层列表摘除；profile 无法启动时这条命令仍然可用。如果做过第 4 步，删掉那四行 `disabled: true` 恢复内置面板。

## 面板仍然不出现时

- **官方 dsh。** 预期行为，不是安装失败。官方发布没有槽位系统，面板无法渲染；按上文卸载，等上游发布槽位系统后再装。
- **启动报 `ERR_MODULE_NOT_FOUND`。** `prepare` 构建被拦截或未执行；补 `allowBuilds` 后重跑 `add`。
- **host 路由有响应，界面没有面板。** 宿主构建缺槽位系统；回到要求检查。

## 构建

`pnpm build`（也就是 `prepare` 脚本）只跑 tsdown：发布入口从 `src/` 转译、不做类型检查，git 安装因此完全自包含。类型安全由源码的源头负责：这些源码在抽取前经过 fork 严格聚合类型检查，仓库自带的 `tsconfig.json` 把 `@deepseek-ai/dsh-*` 类型映射到旁边的 `../deepseek-harness` 检出，供编辑器使用。

## 许可证

MIT。Copyright (c) 2026 DeepSeek。
