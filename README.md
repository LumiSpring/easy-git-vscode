# Easy Git

**v1.0.1** · IntelliJ IDEA 风格的 Git 工具窗口，用于 VS Code / Cursor。

**语言：** [简体中文](README.md) · [English](README.en.md)

**作者：** LumiSpring  
**邮箱：** lumispring0129@gmail.com  
**仓库：** https://github.com/LumiSpring/easy-git-vscode

Easy Git 把日常 Git 操作收成两块熟悉的工作台：**左侧 Commit** 管本地改动与提交，**底部 Git Log** 管分支、历史图和远程。界面按钮、菜单保持英文；提示、确认框和通知可切换中英文。

## 功能

### Commit 窗口（`Alt+0`）

左侧 Activity Bar 的 Easy Git 图标进入提交工作台。

- **变更列表**：按 IDEA 习惯分成 Changes / Unversioned / Conflicts；修改、新增、删除、未跟踪用不同颜色，并保留 M / A / D 等状态字母。
- **ChangeGroup（Changelist）**：新建、重命名、设为活动组、拖拽或右键移动文件，分开提交不同任务。
- **分组查看**：眼睛菜单可按目录、模块（Maven / Gradle）分组，也可同时启用；空的中间目录会折叠。
- **提交**：勾选文件后填写说明，支持 Commit、Commit and Push、Amend。
- **Add / Diff / Rollback**：工具栏 Add 把 Unversioned 文件加入 Changes；也可查看差异，或把选中文件回滚到 HEAD。
- **Ignore / Ignore Directory**：把文件或其所在目录写入 `.gitignore`。
- **Stashes**：把选中改动暂存起来，之后 Pop / Apply / Drop。
- **Shelf**：把改动搁到插件自己的架子上（不走 `git stash`），之后 Unshelve 或删除。
- **进行中的操作**：Merge / Rebase / Cherry-Pick / Revert 时顶部会出现 Continue、Abort；有冲突时还可 Apply 已解决的文件。
- **空仓库**：工作区还不是 Git 仓库时，可一键 `Initialize Git Repository`。

### Git Log（`Alt+9`）

底部面板（与终端同一排）的 Git 图标打开提交历史。Commit 窗口里的「提交历史」按钮也会打开它。

- **分支树**：本地 / 远程分组；当前分支置顶；单击不高亮切换，**双击**才切换该分支的提交图。
- **提交图**：首次打开默认显示当前分支（游离 HEAD 则显示 `HEAD`），彩色 lane 表示合并与分叉。
- **提交操作**：Checkout Revision、从此创建分支、Cherry-Pick、Revert、Soft / Mixed / Hard Reset、复制 hash。
- **分支操作**：Checkout、New Branch、Push（本地分支右键第二项）、Merge into Current、Rebase Current onto This、Compare with Current、重命名、删除。
- **远程**：添加 / 编辑 URL / 删除、设为活动远程、Fetch、在浏览器打开、复制 URL。
- **Changed Files**：查看选中提交改了哪些文件，同样支持目录 / 模块分组；双击打开 diff。
- **提交详情**：作者、邮箱、时间、hash、说明正文、标签，以及包含该提交的分支。
- **搜索**：按说明文字或 hash 过滤。
- **Console**：查看插件实际执行的 git 命令与输出。
- **布局**：分支栏、文件栏、详情区可拖动宽度 / 高度。

### 冲突与合并编辑器

发生 merge / rebase / cherry-pick / revert 冲突时：

1. 弹出 **Conflicts** 列表（可多选）。
2. 点 Merge 打开 **三栏合并编辑器**（Yours / Result / Theirs），风格接近 IDEA：冲突红色、新增绿色、删除灰色。
3. 左右可分别 Accept / Ignore；两边都处理完后才能 **Apply**。
4. Apply 后对应三栏会关闭；全部解决后再 Continue。

也可在冲突文件上右键：Accept Yours、Accept Theirs、Resolve in Merge Editor。

### 状态栏

- 显示当前分支，以及领先 / 落后远程的提交数。
- 点击可打开分支相关操作。
- 进行 merge 等操作时会多出一个入口，方便 Continue 或 Abort。
- 还不是 Git 仓库时，状态栏可直接初始化。

## 安装

### 安装 .vsix（推荐日常使用）

1. 命令面板运行 `Extensions: Install from VSIX...`
2. 选择仓库根目录的 `easy-git-1.0.1.vsix`
3. 重新加载窗口

或在终端执行：

```bash
cursor --install-extension easy-git-1.0.1.vsix
```

VS Code 则用 `code --install-extension easy-git-1.0.1.vsix`。

源码与发行版：https://github.com/LumiSpring/easy-git-vscode

### 开发调试（F5）

1. 在本仓库按 `F5`，启动 “Run Easy Git Extension”
2. 在弹出的扩展开发宿主中打开一个 **Git 仓库**
3. 左侧 Activity Bar 找 **Easy Git**（Commit）；底部与终端同一排找 **Git Log**

重新打包：

```bash
npm run package
```

## 快捷键

| 操作 | 说明 |
| --- | --- |
| `Alt+0` | 打开 Commit 窗口 |
| `Alt+9` | 打开 Git Log |
| Commit 面板上的 Git Log 按钮 | 打开提交历史 |
| 命令面板 `Easy Git: Show Git Log` | 打开提交历史 |

需要本机已安装 `git`，并在 PATH 中；也可在设置里指定 `easyGit.gitPath`。

## 设置

在 Settings 搜索 `Easy Git`：

- **Easy Git: Language**（默认 `zh-cn`）  
  只影响提示、确认框和通知。按钮、菜单等功能名称始终为英文。可选 `en`。
- **Easy Git: Git Path**  
  Git 可执行文件路径。
- **Easy Git: Pull Rebase**  
  Pull / Update Project 时是否 rebase。
- **Easy Git: Log Limit**  
  Git Log 最多显示的提交数，默认 500。
