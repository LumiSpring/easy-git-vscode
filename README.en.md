# Easy Git

**v1.0.1** · IntelliJ IDEA-style Git tool windows for VS Code and Cursor.

**Languages:** [English](README.en.md) · [简体中文](README.md)

**Author:** LumiSpring  
**Email:** lumispring0129@gmail.com  
**Repository:** https://github.com/LumiSpring/easy-git-vscode

Easy Git splits daily Git work into two familiar tool windows: **Commit** on the left for local changes, and **Git Log** in the bottom panel for branches, history, and remotes. Buttons and menus stay English. Hints, confirmations, and notifications can be Chinese or English.

## Features

### Commit window (`Alt+0`)

Open it from the Easy Git icon in the Activity Bar.

- **Change lists:** Changes / Unversioned / Conflicts, in the IntelliJ style. Modified, added, deleted, and untracked files use different colors, and keep M / A / D status letters.
- **ChangeGroup (changelist):** Create, rename, set active, and drag or move files so you can commit tasks separately.
- **Grouping:** The eye menu groups by directory, Maven / Gradle module, or both. Empty intermediate folders are collapsed.
- **Commit:** Check files, write a message, then Commit, Commit and Push, or Amend.
- **Add / Diff / Rollback:** Toolbar Add moves Unversioned files into Changes. You can also show diffs or roll selected files back to HEAD.
- **Ignore / Ignore Directory:** Write a file or its parent directory into `.gitignore`.
- **Stashes:** Stash selected changes, then Pop / Apply / Drop.
- **Shelf:** Park changes on a plugin-local shelf (not `git stash`), then Unshelve or delete.
- **In-progress operations:** During Merge / Rebase / Cherry-Pick / Revert, the top bar shows Continue and Abort. If there are conflicts, Apply resolved files first.
- **Empty repo:** If the folder is not a Git repository yet, initialize it in one click.

### Git Log (`Alt+9`)

Open it from the Git icon on the bottom panel (same row as the Terminal). The Git Log button in the Commit window also opens it.

- **Branch tree:** Local and remote groups, current branch on top. A single click does not switch the log; **double-click** a branch to show that branch’s graph.
- **Commit graph:** First open shows the current branch (`HEAD` when detached). Colored lanes show merges and forks.
- **Commit actions:** Checkout Revision, New Branch from Here, Cherry-Pick, Revert, Soft / Mixed / Hard Reset, copy hash.
- **Branch actions:** Checkout, New Branch, Push (second item on local branch context menu), Merge into Current, Rebase Current onto This, Compare with Current, rename, delete.
- **Remotes:** Add / edit URL / remove, set the active remote, Fetch, open in browser, copy URL.
- **Changed Files:** Files in the selected commit, with the same directory / module grouping. Double-click opens a diff.
- **Commit details:** Author, email, time, hash, message body, tags, and branches that contain the commit.
- **Search:** Filter by message or hash.
- **Console:** The git commands the plugin actually ran, plus their output.
- **Layout:** Branch pane, file pane, and details pane are resizable.

### Conflicts and the merge editor

When merge / rebase / cherry-pick / revert hits conflicts:

1. A **Conflicts** list appears (multi-select is supported).
2. Merge opens the **three-pane editor** (Yours / Result / Theirs), close to the IntelliJ look: conflicts in red, additions in green, deletions in gray.
3. Each side can Accept or Ignore. **Apply** is enabled only after both sides are handled.
4. Applying a file closes its three panes. Continue when every conflict is done.

You can also right-click a conflict file: Accept Yours, Accept Theirs, Resolve in Merge Editor.

### Status bar

- Current branch, plus how many commits you are ahead or behind.
- Click it for branch actions.
- During merge-like operations, an extra entry lets you Continue or Abort.
- If there is no Git repo yet, the status bar can initialize one.

## Install

### Install from VSIX (recommended)

1. Command Palette → `Extensions: Install from VSIX...`
2. Pick `easy-git-1.0.1.vsix` in the repo root
3. Reload the window

Or in a terminal:

```bash
cursor --install-extension easy-git-1.0.1.vsix
```

For VS Code: `code --install-extension easy-git-1.0.1.vsix`.

Source and releases: https://github.com/LumiSpring/easy-git-vscode

### Debug (F5)

1. Press `F5` in this repo to launch “Run Easy Git Extension”
2. Open a **Git repository** in the Extension Development Host
3. Find **Easy Git** (Commit) in the Activity Bar, and **Git Log** on the bottom panel next to the Terminal

Repackage:

```bash
npm run package
```

## Shortcuts

| Action | What it does |
| --- | --- |
| `Alt+0` | Open the Commit window |
| `Alt+9` | Open Git Log |
| Git Log button on Commit | Open commit history |
| Command Palette `Easy Git: Show Git Log` | Open commit history |

Git must be installed and on `PATH`, or set `easyGit.gitPath` in Settings.

## Settings

Search `Easy Git` in Settings:

- **Easy Git: Language** (default `zh-cn`)  
  Affects hints, confirmations, and notifications only. Buttons and menus stay English. Use `en` for English prompts.
- **Easy Git: Git Path**  
  Path to the git executable.
- **Easy Git: Pull Rebase**  
  Rebase when pulling / updating the project.
- **Easy Git: Log Limit**  
  Maximum commits shown in Git Log. Default 500.
