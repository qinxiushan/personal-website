---
title: 项目 - chengjiabiao
display: 项目
description: 我引以为豪的项目列表
wrapperClass: 'text-center'
art: dots
projects:
  我的项目:
    - name: '你的项目'
      link: 'https://github.com/qinxiushan'
      desc: '在这里添加你的项目描述'
      icon: 'i-carbon-star'
---

<!-- @layout-full-width -->
<ListProjects :projects="frontmatter.projects" />
