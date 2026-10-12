# 发布 Windows 安装包

Release 工作流构建带 OpenCode 接收适配的 Windows x64 安装包。游戏从仓库记录的 dsh-piggy 子模块提交读取，不构建原客户端，不发布原版游戏的热更新包。

## 发布前准备

1. 将根目录、`packages/opencode-piggy/` 和 `packages/opencode-bridge/` 的 `package.json` 更新为同一个兼容层版本。桌面外壳和上游游戏各自保留自己的版本。
2. 在 `CHANGELOG.md` 写好对应版本的小节，更新 README 中的版本与必要使用说明。
3. 初始化固定子模块，在 Windows x64 上准备依赖并检查构建：

   ```sh
   git submodule update --init --recursive
   node scripts/prepare-release.mjs
   npm run check
   npm run typecheck
   npm run dist:win
   ```

   本地构建需要 NSIS 3；`makensis.exe` 不在 PATH 时，用环境变量 `MAKENSIS` 指定完整路径。固定依赖版本在 `scripts/release-dependencies.json`，修改构建依赖时同步更新它。

4. 试用安装包，确认安装、OpenCode 工作联动和卸载行为后再发布。

仓库需要启用 GitHub Actions，并允许工作流写入仓库内容。工作流使用自动提供的 `GITHUB_TOKEN`，无需配置个人访问令牌。

## 标签发布

提交版本改动并推送 `v<兼容层版本>` 标签，例如 `v0.1.0-rc.3`。标签必须与根目录 `package.json` 的版本一致。

工作流读取该标签及固定子模块，准备 Node、Electron 与 NSIS，运行接入点检查和类型检查，再构建安装包。构建成功后创建草稿 Release，上传完整安装包，最后公开 Release。包含 `-` 的版本标签会标记为预发布版。

下载文件名包含游戏和兼容层版本：

```text
opencode-piggy-setup-game-<游戏版本>-<兼容层版本>-x64.exe
```

只上传安装包，不上传解包目录、本机存档或开发记录。安装包未签名。

## 手动运行与重试

在 GitHub 的 **Actions → Release → Run workflow** 中填写已经存在的版本标签。手动运行始终构建该标签的代码，而不是所选分支当前的代码。

默认勾选「仅生成草稿」，可先检查产物与发布说明；确认后在 Releases 页面发布草稿，或取消勾选后运行工作流。

上传失败时 Release 保持草稿，可重跑同一标签的工作流继续上传。已公开的 Release 不会被覆盖；后续修正使用新的版本号和标签。
