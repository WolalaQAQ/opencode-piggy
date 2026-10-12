# 上游与第三方许可

本仓库的兼容层使用 [MIT](LICENSE) 许可。原版代码、客户端和素材通过 `upstream/dsh-piggy/` 子模块使用，不作为父仓库中的源码副本保存；适配安装包保留原版目录和许可。

- 原版 dsh-piggy：[LICENSE](upstream/dsh-piggy/LICENSE)。
- 原版素材及第三方依赖：[THIRD-PARTY.md](upstream/dsh-piggy/THIRD-PARTY.md)、[LICENSE-noto-emoji.txt](upstream/dsh-piggy/LICENSE-noto-emoji.txt)、[素材来源登记](upstream/dsh-piggy/assets/PROVENANCE.md)。
- Electron 及其依赖按原版运行时使用；完整许可证随各依赖包提供。
- Windows 安装包的独立 Node 运行时附带对应版本的完整许可，位于 `resources/bridge-node/LICENSE`。

兼容层没有引入新的美术资源。
