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

我以为是 GitHub 服务挂了，等了一会重试，还是不行。本地 `ssh ubuntu@<YOUR_SERVER_IP>` 完全正常，说明不是 SSH 配置问题。

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
git clone git@github.com:qinxiushan/personal-website.git chengjiabiao
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
