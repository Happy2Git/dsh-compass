# dsh-compass

[English](README.md) | 中文

单包形态的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：为 Web 界面新增右侧上下文文件面板——目录浏览、注入上下文文档、只读 Git 提交图，以及会话日志下载动作。

一个包 = 一个 bundle = 一行 loader 条目：host 半把本地 Git 后端（`/git/*`）、插件自有目录路由（`/dir/*`）和 `/export` 命令作为子插件挂载；浏览器半把面板注册进 `shell.overlay`，把下载动作注册进面板头部工具区。

## main-track 兼容性

本包自带它需要的全部能力面，因此可以装到任何 web 组合包含槽位系统的 dsh 构建上（槽位系统已在上游 `master`；最后一次 npm 发布早于它）：

- 目录列表与文本读取走包内自带的有界浏览器（`/dir/*` 直接读文件系统——不需要 `directoryPicker.readText`、不需要 browse 后端，profile 组合了原生选择器也能用）；
- git seam 与本地后端随包内置（`ctx.subprocess` + `ctx.webServer` 来自基础组合）；
- 对话避让使用包自己的 `--dsh-compass-width` 变量 + 针对 shell 稳定钩子 `[data-shell-overlay]` 的 CSS `:has()` 规则——不需要 fork 的 CSS（fork 内置规则读的是另一个变量，任何组合都不会双重避让）。

## 安装

从本仓库安装并固定 commit：

```sh
dsh plugin --profile web add github:Happy2Git/dsh-compass#<commit-sha>
```

Git 安装通过包的 `prepare` 脚本从源码构建（纯转译，无开发环境依赖）。pnpm ≥10 会拦截构建脚本：首次 `add` 失败后，把 pnpm 打印的确切键复制进 profile 的 `pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-compass: true
```

再重新 `add`。这条允许意味着「安装时执行本包代码」——请固定 commit，防止后续推送悄悄改变执行内容。

fork 默认的 `web` profile 已内置同一面板。改用本包时，在 profile 自己的 `cordis.patch.yml` 里禁用内置四行：

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

本地目录安装不需要任何构建授权：

```sh
dsh plugin --profile web add ./dsh-compass
```

## 构建

`pnpm build`（也就是 `prepare` 脚本）只跑 tsdown：发布入口从 `src/` 转译、不做类型检查，git 安装因此完全自包含。类型安全由源码的源头负责：这些源码在抽取前经过 fork 严格聚合类型检查，仓库自带的 `tsconfig.json` 把 `@deepseek-ai/dsh-*` 类型映射到旁边的 `../deepseek-harness` 检出，供编辑器使用。

## 许可证

MIT。Copyright (c) 2026 DeepSeek。
