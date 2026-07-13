# Git 历史清理指南：从提交记录中删除敏感信息

> 当你不小心把密钥、IP、密码等敏感信息 commit 到 Git 后，如何彻底清除？本文记录完整流程、踩过的坑和最终方案。

## 一、问题背景

### 1.1 发生了什么

在之前的部署文档中，我把服务器的 IP、用户名、绝对路径等信息写进了 markdown 文件并 commit 推送了。虽然后来用占位符替换了文件内容，但 `git log` 里依然能看到旧版本：

```bash
$ git log --all -p | grep "106.55.186.39"
# 还能看到所有历史提交里包含这个 IP
```

**核心问题**：Git 是分布式版本控制系统，一旦 commit，文件内容会变成 blob 对象永久保存在历史里。`git rm` + `git commit` 只删了"当前版本"的引用，旧 blob 还在 reflog 和对象库里。

### 1.2 为什么必须清理

- GitHub 是公开仓库 → 任何人都能 `git clone` → 都能看到历史
- 搜索引擎会索引 GitHub 代码（GitHub Code Search）
- 即使删了文件，commit message 里可能也有敏感信息
- 攻击者拿到历史 commit 就能知道你的服务器 IP、SSH 用户名、项目路径

### 1.3 清理思路

**核心原则**：重写历史，让旧的 blob 不再被任何 commit 引用。

```
旧历史：  A → B → C → D → E (包含敏感信息)
                    ↓
新历史：  A' → B' → C' → D' → E' (替换为占位符)
```

具体步骤：
1. 找出所有敏感字符串
2. 用工具重写所有 commit 的内容
3. 清理 reflog 和垃圾对象
4. 强制推送到远程
5. 服务器端重新克隆（self-hosted runner 需要）

---

## 二、工具选型

### 2.1 可选工具

| 工具 | 优点 | 缺点 |
|---|---|---|
| `git filter-branch` | Git 内置，无需安装 | 慢，会产生大量警告 |
| `git filter-repo` | 现代工具，速度快 | 需要额外安装 |
| BFG Repo-Cleaner | 速度极快，专注大文件 | 需要 Java 运行环境 |
| 删库重建 | 最干净 | 失去所有 fork、star、watch |

### 2.2 我的选择：`git filter-branch`

**为什么不用 `filter-repo`**：我先试了 `git filter-repo`，但它有个坑——当某个 commit 的内容**经过替换后和另一个 commit 完全一样时**会被去重，导致旧 blob 看起来没被替换。实际上需要先彻底清理 reflog 再 push，但我中途遇到了麻烦，最后切换到 `filter-branch` 一把搞定。

**为什么不用 BFG**：BFG 主要针对大文件（>1MB），我们的敏感信息是几行文本，`filter-branch` 的 `sed` 更灵活。

**为什么不用删库**：仓库已经有一定历史（24 个 commit），删库太粗暴。

---

## 三、完整操作流程

### 3.1 第一步：备份（可选但强烈建议）

```bash
# 备份当前仓库
cp -r .git /tmp/git-backup-$(date +%Y%m%d)
```

万一操作失误可以恢复。

### 3.2 第二步：列出所有敏感字符串

把所有要替换的内容列出来：

| 原值 | 占位符 |
|---|---|
| `106.55.186.39` | `<YOUR_SERVER_IP>` |
| `/home/ubuntu/project/chengjiabiao` | `<YOUR_PROJECT_PATH>` |
| `/home/ubuntu/project` | `<YOUR_PARENT_DIR>` |
| `ubuntu@106.55.186.39` | `<USER>@<YOUR_SERVER_IP>` |

### 3.3 第三步：尝试 `git filter-repo`（可选）

```bash
# 安装
pip install --user git-filter-repo

# 创建替换文件
cat > /tmp/replacements.txt << 'EOF'
106.55.186.39==<YOUR_SERVER_IP>
/home/ubuntu/project/chengjiabiao==<YOUR_PROJECT_PATH>
/home/ubuntu/project==<YOUR_PARENT_DIR>
ubuntu@106.55.186.39==<USER>@<YOUR_SERVER_IP>
EOF

# 执行替换
git-filter-repo --replace-text /tmp/replacements.txt --force
```

> **坑 1**：`filter-repo` 会自动删除 origin 远程，需要手动加回：
> ```bash
> git remote add origin git@github.com:USER/REPO.git
> ```

> **坑 2**：执行后 `git log --all` 还能看到旧 commit hash（addfe30 等），但 `git log main` 已经显示新 hash。这说明 `filter-repo` 把旧 commit 变成"悬空对象"。需要清理 reflog：
> ```bash
> git reflog expire --expire=now --all
> git gc --prune=now --aggressive
> ```

> **坑 3（我的实际遭遇）**：`filter-repo` 操作后，老 commit 的 blob 内容看起来**没被替换**。可能是因为我的替换文件格式问题或工具的边界情况。**最终我放弃 `filter-repo`，改用 `filter-branch`**。

### 3.4 第四步：改用 `git filter-branch`（最终方案）

```bash
git filter-branch -f --tree-filter '
find . -type f \( -name "*.md" -o -name "*.yml" -o -name "*.yaml" -o -name "*.json" -o -name "*.ts" -o -name "*.vue" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" \
  -exec sed -i \
    -e "s|106.55.186.39|<YOUR_SERVER_IP>|g" \
    -e "s|/home/ubuntu/project/chengjiabiao|<YOUR_PROJECT_PATH>|g" \
    -e "s|/home/ubuntu/project|<YOUR_PARENT_DIR>|g" \
    -e "s|ubuntu@106.55.186.39|<USER>@<YOUR_SERVER_IP>|g" \
  {} +
' HEAD
```

**参数解释**：

- `-f` (force)：覆盖已有的备份引用
- `--tree-filter`：对每个 commit 检出文件树，执行命令，再提交
- `find ... -exec sed ...`：查找所有文本文件并替换敏感字符串
- `-not -path "./node_modules/*"`：排除依赖目录（重要！否则会修改几十万个文件）
- `-not -path "./.git/*"`：排除 git 自身目录
- `HEAD`：只重写当前分支

**输出解读**：

```
Rewrite 4bc685a5e69fd56c7973cd9071be3a44e4ad0cd5 (1/24)
...
Rewrite 169c4cf4f5d6a7b6c726018de1d7d1c3c1fb6f5d (23/24)
Ref 'refs/heads/main' was rewritten
```

`1/24` 表示正在处理第 1 个 commit，共 24 个。耗时几秒到几分钟。

### 3.5 第五步：清理 reflog 和垃圾对象

```bash
# 清除所有 reflog 记录
git reflog expire --expire=now --all

# 垃圾回收，删除不可达对象
git gc --prune=now --aggressive
```

**为什么需要**：`filter-branch` 重写了 commit，但旧的 commit 对象还存在于 reflog（HEAD@{1}, HEAD@{2} 等）。`git gc` 才会真正删除它们。

### 3.6 第六步：验证清理结果

```bash
# 检查 main 分支是否还有敏感信息
git log main -p | grep "106.55"
# 应该输出 0 行

# 检查文件当前内容
git show HEAD:pages/posts/deploy-personal-website.md | grep "106.55"
# 应该输出 0 行

# 检查所有可达 commit 的 blob
git rev-list main | while read sha; do
  git ls-tree -r $sha | grep -E "\.(md|yml|json|ts)$"
done | awk '{print $3}' | sort -u | while read blob; do
  git cat-file -p $blob | grep -l "106.55" && echo "FOUND IN $blob"
done
# 应该没有任何输出
```

### 3.7 第七步：强制推送到远程

```bash
# 重新加回 origin（filter-branch 不会删除远程）
git remote -v
# 确认 origin 还在

# 强制推送
git push --force origin main
```

**为什么需要 `--force`**：本地历史与远程历史不一致（commit hash 全变了），普通 push 会被拒绝。

**警告**：`--force` 会**覆盖远程历史**，如果有人基于远程开了 PR，他们的 PR 会失效或冲突。生产环境慎用。

如果担心，可以加保护：

```bash
# 先备份远程
git push origin main:backup-before-rewrite  # 推一个备份分支

# 再强制推送
git push --force origin main

# 如果出问题，恢复
git push --force origin backup-before-rewrite:main
```

### 3.8 第八步：服务器端重新克隆

如果是 self-hosted runner 或 CI 机器：

```bash
ssh user@server

# 备份当前部署
sudo cp -r /path/to/dist /tmp/dist-backup

# 删除旧仓库
cd /path/to/parent
sudo rm -rf project-name

# 重新克隆
git clone git@github.com:USER/REPO.git project-name
cd project-name

# 安装依赖并部署
pnpm install
pnpm run build
sudo systemctl reload nginx
```

**为什么必须重新克隆**：
- 服务器上的 git 对象数据库还指向旧 hash
- `git pull` 可能会合并失败
- 重新克隆最干净

---

## 四、踩过的坑汇总

| # | 问题 | 原因 | 解决 |
|---|---|---|---|
| 1 | `filter-repo` 后老 commit 还有敏感信息 | 可能是我用法不对，或对象去重问题 | 改用 `filter-branch` |
| 2 | `filter-repo` 删除了 origin 远程 | 工具默认行为（防止误推） | 手动 `git remote add origin` |
| 3 | `filter-branch` 警告 "glut of gotchas" | Git 官方推荐用 `filter-repo` | 设置 `FILTER_BRANCH_SQUELCH_WARNING=1` 或忽略 |
| 4 | 推送到 GitHub 报错 "stale info" | 本地 ref 和远程不匹配 | 用 `git push --force` 替代 `--force-with-lease` |
| 5 | 服务器 runner 部署失败 | 本地仓库 hash 全变了 | 服务器重新克隆 |
| 6 | `node_modules` 被处理 | find 默认会遍历所有文件 | 加 `-not -path "./node_modules/*"` |
| 7 | `git log -p` 还能看到旧字符串 | diff 的 `-` 行（被删除的内容）显示 | 这是正常的，当前文件已干净 |

---

## 五、为什么 `git log -p` 还能看到敏感信息？

**这不是 bug，是正常显示**。

`git log -p` 显示的是 commit 的**差异**（diff），格式是：

```diff
-旧内容（被删除）
+新内容（新增）
```

即使新内容已经是占位符，`-` 行（删除的内容）依然会显示原值。这是 Git diff 的固有行为，**不代表历史没清理干净**。

**正确验证方式**：

```bash
# ❌ 错误验证（会显示 diff 的 - 行）
git log -p | grep "106.55"

# ✅ 正确验证（只看当前内容）
git show HEAD:filename | grep "106.55"

# ✅✅ 最严谨验证（检查所有可达 blob）
for sha in $(git rev-list main); do
  git ls-tree -r $sha | awk '{print $3}' | while read blob; do
    git cat-file -p $blob 2>/dev/null | grep -q "106.55" && echo "LEAK in $blob"
  done
done
```

---

## 六、更激进的方案对比

如果 `filter-branch` 也不够（比如泄露了 SSH 私钥），考虑更彻底的方案：

| 方案 | 适用场景 | 代价 |
|---|---|---|
| `filter-branch` 本文档 | 文本类敏感信息（IP、路径、用户名） | 低，仅重写历史 |
| BFG Repo-Cleaner | 大文件泄露（密钥文件、数据库 dump） | 中，需 Java |
| 删库重建 + 通知用户 | 严重泄露（生产环境密钥） | 高，失去 star/issue |
| 联系 GitHub Support | 紧急泄露，需要立即清除 | 不可控 |

---

## 七、预防胜于治疗

清理历史很麻烦，**最好从一开始就别 commit 敏感信息**。

### 7.1 使用 `.gitignore`

```gitignore
# .gitignore
.env
.env.local
*.pem
*.key
secrets/
```

### 7.2 使用环境变量

```typescript
// ❌ 错误
const serverIp = '106.55.186.39'

// ✅ 正确
const serverIp = process.env.SERVER_IP || '<YOUR_SERVER_IP>'
```

### 7.3 提交前检查

```bash
# 提交前搜索敏感关键字
git diff --cached | grep -iE "password|secret|key|token|106\.|192\."
```

### 7.4 使用 pre-commit hook

```bash
# .git/hooks/pre-commit
#!/bin/bash
git diff --cached | grep -qE "106\.\d+\.\d+\.\d+" && {
  echo "ERROR: 检测到 IP 地址，禁止提交"
  exit 1
}
```

### 7.5 GitHub Secret Scanning

仓库 → Settings → Code security and analysis → 启用 **Secret scanning**，GitHub 会自动检测常见的密钥模式。

---

## 八、命令速查

```bash
# 1. 备份
cp -r .git /tmp/git-backup-$(date +%Y%m%d)

# 2. 重写历史（核心命令）
git filter-branch -f --tree-filter '
find . -type f \( -name "*.md" -o -name "*.yml" \) \
  -not -path "./node_modules/*" \
  -not -path "./.git/*" \
  -exec sed -i \
    -e "s|OLD_VALUE|NEW_VALUE|g" \
  {} +
' HEAD

# 3. 清理 reflog 和对象
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 4. 验证
git log main -p | grep "OLD_VALUE"  # 应该输出 0 行
git show HEAD:filename | grep "OLD_VALUE"  # 应该输出 0 行

# 5. 强制推送
git push --force origin main

# 6. 服务器重新克隆
ssh user@server "cd /path && rm -rf repo && git clone git@github.com:USER/REPO.git repo"
```

---

## 九、总结

清理 Git 历史的本质是**重写 commit 内容 + 清理不可达对象**。

- **简单情况**（少量敏感信息）→ `git filter-branch` 一行命令搞定
- **复杂情况**（大文件、密钥）→ 用 BFG Repo-Cleaner
- **严重情况**（生产密钥泄露）→ 删库重建 + 通知 GitHub

**最重要的**：事前预防 > 事后清理。配置好 `.gitignore`、pre-commit hook、GitHub Secret Scanning，别让敏感信息进仓库。
