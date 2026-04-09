# GeekNote
一个纯前端的本地笔记应用，数据存在浏览器里，不需要服务器，也不用注册账号。打开就能用。

## 为什么做这个

市面上的笔记应用要么需要登录，要么数据存在云端，要么界面太花哨加载半天。我就想要一个简单的东西：打开浏览器就能写，数据只留在本地，操作流畅不卡。所以就有了这个项目。

## 怎么用

1. 下载项目文件夹
2. 直接用浏览器打开 `index.html`（推荐 Chrome 或 Edge）
3. 没了

不需要安装任何依赖，不需要启动服务器，不需要 Node.js。纯 HTML/CSS/JS，打开即用。

---

## 技术栈

| 技术 | 说明 |
|------|------|
| HTML5 | 页面结构，`contenteditable` 实现富文本编辑 |
| CSS3 | CSS 变量、Flexbox、动画、深浅主题 |
| Vanilla JS (ES6+) | 零依赖，不用任何框架 |
| IndexedDB | 本地数据持久化 |
| Blob API | 图片二进制存储 |

项目只有三个文件：

```
index.html   — 页面结构
style.css    — 样式
app.js       — 全部逻辑
```

---

## 浏览器兼容

| 浏览器 | 支持 |
|--------|------|
| Chrome / Edge | ✅ 推荐 |
| Firefox | ✅ 支持 |
| Safari | ⚠️ 基本可用，存储有限制 |
| IE | ❌ 不支持 |

---
## 截图

> 深色主题

<img width="2393" height="1299" alt="image" src="https://github.com/user-attachments/assets/af5e5268-a324-47ef-b5f3-1d26a44b4289" />


> 浅色主题

<img width="2390" height="1308" alt="image" src="https://github.com/user-attachments/assets/cb124f10-e882-4bc0-b104-647f40deb5b6" />
