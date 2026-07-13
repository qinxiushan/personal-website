# AGENTS.md

> 个人网站（chengjiabiao.com）开发指南。专为 AI 编程助手编写，帮助快速理解项目结构、约定、踩坑记录。

## 1. 项目本质

- **类型**：Vue 3 + Vite SSG 静态网站（从 Anthony Fu 模板改造）
- **语言**：中文（zh-CN），所有面向用户的内容必须用中文
- **包管理**：pnpm 11.2.2（用 `corepack` 激活，不要 `npm install -g pnpm`）
- **Node 版本**：必须 22+（之前用 18 报 `styleText` 错误）
- **部署方式**：Self-hosted Runner + Nginx（已配置，无需 Netlify）

## 2. 目录结构（高频操作区）

| 路径                   | 用途         | 备注                                      |
| ---------------------- | ------------ | ----------------------------------------- |
| `pages/`             | 路由源文件   | `.md` 文件即网页，`index.md` = `/`  |
| `pages/posts/`       | 博客文章     | 顶部必须有 frontmatter                    |
| `pages/index.md`     | 首页         | 修改此处                                  |
| `pages/projects.md`  | 项目页       | 修改此处                                  |
| `src/components/`    | Vue 组件     | 头部、底部、Logo 等                       |
| `src/logics/`        | 业务逻辑     | localStorage 键名以`chengjiabiao-` 开头 |
| `data/`              | 静态数据     | talks.ts、media.ts                        |
| `public/`            | 静态资源     | 直接复制到`dist/`                       |
| `scripts/`           | 构建脚本     | 字体、RSS、压缩图片等                     |
| `docs/`              | 私人开发笔记 | **已在 .gitignore，不提交**         |
| `.github/workflows/` | CI/CD        | deploy.yml 是部署入口                     |

## 3. 关键命令

```bash
# 开发
pnpm dev              # 启动开发服务器（端口 3333）

# 构建
pnpm run build        # 完整构建：static + vite-ssg + fonts + rss
pnpm run static       # 仅下载静态资源
pnpm run lint         # ESLint 检查

# 部署（服务器上）
pnpm run build && sudo systemctl reload nginx
```

**注意**：`pnpm run build` 会执行 `simple-git-hooks` 的 pre-commit hook，速度很慢。**提交时务必用 `git commit --no-verify` 跳过**。

## 4. 部署架构

```
push → main 分支
  ↓
GitHub Actions 触发 (.github/workflows/deploy.yml)
  ↓
Self-hosted Runner (服务器: ~/actions-runner)
  ↓
1. cd 到生产目录 /home/ubuntu/project/chengjiabiao
2. git pull origin main（SSH 通道，绕过 HTTPS 443 封锁）
3. pnpm install --frozen-lockfile
4. pnpm run build（直接生成到 ./dist/，Nginx 服务根）
5. sudo systemctl reload nginx
  ↓
Nginx 80 端口提供静态文件
```

**重要约束**：

- workflow 只监听 `push: branches: [main]` 和 `workflow_dispatch`
- **不监听 `pull_request`**（防外部 PR 触发 runner 执行恶意代码）
- Runner 是 self-hosted 模式，跑在服务器本地
- **不用 `actions/checkout@v4`**：服务器到 github.com 的 HTTPS（443）被防火墙拦，checkout 会超时。改用 `cd` 到生产目录 + `git pull`（走 SSH 22）
- 首次部署需要手动 `git clone` 一次，让生产目录成为 git 仓库

## 5. 新增博客文章

```bash
# 1. 创建文件
touch pages/posts/my-new-post.md
```

文件格式：

```markdown
---
title: 文章标题
description: 简短描述
date: 2026-07-13
art: random  # 可选：首页背景动画类型
---

# 文章标题

正文内容...
```

**注意**：

- `art: random` 触发首页动画，其他选项见 `src/components/ArtDots.vue` `ArtPlum.vue`
- 不要在 frontmatter 写 `image`，会自动从 `pages/posts/<name>.png` 或 OG 模板生成

## 6. 修改组件

组件在 `src/components/` 下，使用 Vue 3 `<script setup lang="ts">` 语法。

修改后：

1. `pnpm run build` 测试
2. 检查 `dist/` 是否有变化
3. commit 并 push（自动部署）

## 7. 安全红线（高优先级）

### 7.1 绝对不能 commit 的内容

- ❌ 服务器真实 IP
- ❌ SSH 用户名
- ❌ 真实项目绝对路径（除非是 workflow 必需的）
- ❌ `.env` 文件
- ❌ 任何 secrets（GitHub PAT、API key 等）

### 7.2 公开文档（博客）脱敏规则

- ✅ 用占位符：`<YOUR_SERVER_IP>`、`<YOUR_PROJECT_PATH>`、`<USER>`、`<REPO>`
- ❌ 不要在 `pages/posts/*.md` 里写真实路径
- 详细配置写真实信息只放 `docs/`（本地、不提交）

### 7.3 Self-hosted Runner 风险

仓库是 public，任何人都能 fork + 提 PR。**确保 workflow 不监听 `pull_request` 事件**，否则攻击者可以执行任意代码在服务器上。

## 8. Git 工作流约定

```bash
# 提交规范（参考 conventional commits）
git commit --no-verify -m "chore: xxx"     # 杂项
git commit --no-verify -m "docs: xxx"      # 文档
git commit --no-verify -m "ci: xxx"        # CI/CD
git commit --no-verify -m "feat: xxx"      # 新功能
git commit --no-verify -m "fix: xxx"       # 修复
```

**提交时必须用 `--no-verify`**，否则 pre-commit 的 lint-staged 会非常慢（几十秒到几分钟）。

## 9. 常见踩坑

| 问题                 | 原因                               | 解决                            |
| -------------------- | ---------------------------------- | ------------------------------- |
| `styleText` 报错   | Node.js 版本太低                   | 升级到 22+                      |
| 部署 timeout 10 分钟 | 托管 Runner 受限                   | 用 self-hosted                  |
| 提交非常慢           | pre-commit hook                    | `git commit --no-verify`      |
| OG 图不显示          | 缺`image` frontmatter 或同名 png | 让 vite 自动生成或手动加        |
| 路由 404             | 没在`pages/` 下                  | vite-router 自动从`pages/` 读 |
| 中文乱码             | 文件编码不是 UTF-8                 | 确保编辑器用 UTF-8              |
| 刷新页面 404         | 缺 Nginx`try_files`              | Nginx 配置加 SPA fallback       |

## 10. 调试技巧

```bash
# 本地预览构建产物
pnpm run build && pnpm run preview

# 查看 dist 目录
ls -la dist/

# 手动部署（服务器）
cd /home/ubuntu/project/chengjiabiao
pnpm run build
sudo systemctl reload nginx

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/error.log
```

## 11. 修改 Logo / 身份信息的位置

| 位置            | 文件                                                 |
| --------------- | ---------------------------------------------------- |
| Logo SVG        | `src/components/Logo.vue`、 `LogoStroke.vue`     |
| Favicon         | `public/favicon*.svg`                              |
| 页面标题        | `index.html`（`lang="zh-CN"`, `title`）        |
| Footer          | `src/components/Footer.vue`                        |
| NavBar 链接     | `src/components/NavBar.vue`                        |
| RSS/OG 域名     | `scripts/rss.ts`、`vite.config.ts`               |
| 分享 URL base   | `src/components/WrapperPost.vue`                   |
| localStorage 键 | `src/logics/index.ts`（以 `chengjiabiao-` 开头） |

## 12. 与上游模板（Anthony Fu）的差异

本项目基于 `antfu.me` 改造，去除了：

- 大量 `pages/*.md`（赞助商、演讲、媒体等页面）
- `pages/posts/*.md`（原博客文章）
- `src/components/{photos,qrcode,quansync,shiki,slides}/` 等未用组件

**保留的核心**：

- 工具链（Vite、UnoCSS、markdown-it 插件链）
- 设计系统（`src/styles/`）
- 构建脚本（`scripts/`）
- `@antfu/*` 依赖（包名是技术依赖，不是内容）

## 13. 风格与语言

- **面向用户的内容**：必须中文，包括页面、组件文本、博客
- **代码注释**：中文或英文都可以，但保持一致
- **commit message**：英文（遵循 conventional commits）
- **变量名 / 函数名**：英文（代码标准）
- **文档（AGENTS.md、本地笔记）**：中文

## 14. 沉淀经验的位置

- **公开博客**：`pages/posts/*.md`（脱敏后）
- **私人笔记**：`docs/*.md`（已在 .gitignore，不提交）
- **本文件**：`AGENTS.md`（提交，供 AI 助手参考）

## 15. 紧急情况处理

- **部署失败**：去 https://github.com/qinxiushan/personal-website/actions 查看日志
- **Runner 离线**：服务器 `sudo systemctl status actions.runner.*`、 `sudo ./svc.sh start`
- **网站无法访问**：检查 Nginx 状态 `sudo systemctl status nginx`、 `sudo nginx -t`
- **历史泄露敏感信息**：用 `git filter-branch` 重写 + `git push --force`（详见本地笔记）
- **想完全重置**：删 `dist/` 重新 `pnpm run build`
