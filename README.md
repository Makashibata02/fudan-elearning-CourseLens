# 复旦 eLearning PDF 弹窗预览

在 eLearning 作业页面点击 PDF 文件名时，用 Chrome 自带的 PDF 阅读器在当前页面打开弹窗。适用于网站自带预览提示“没有预览可用于此文件”的情况。本项目与复旦大学及其 eLearning 平台无官方关联。

## 安装

1. 确认 Chrome 中已安装并启用 Tampermonkey。
2. 点击[安装用户脚本](https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js)，在 Tampermonkey 的安装页面确认。
3. 重新加载 `elearning.fudan.edu.cn` 的作业页面。

也可以在 Tampermonkey 中选择“添加新脚本”，把 [`elearning-pdf-preview.user.js`](elearning-pdf-preview.user.js) 的完整内容粘贴到编辑器并保存。脚本元数据包含更新地址，安装后可接收后续版本。

脚本仅在 `https://elearning.fudan.edu.cn/` 运行。Tampermonkey 元数据中的 `@connect *` 用于处理学校文件服务的跨域重定向；代码只会向当前 eLearning 站点的文件下载地址发起初始请求，不会把 PDF 发给其他自选服务。

## 使用

- 点击 PDF 文件名，弹窗会读取并显示 PDF。点击页面原有的下载图标仍按网站原行为处理。
- 点击弹窗的“下载 PDF”才会主动保存文件。点“关闭”、弹窗外部或按 Escape 可返回页面。
- 如果预览失败，弹窗会给出原因，并提供“打开原文件”和“下载 PDF”入口。
- Ctrl/⌘ 点击等浏览器常见的新标签页操作仍按原行为处理。

预览仍需从网站传输文件数据到浏览器，只是不主动保存到“下载”目录。浏览器自身可能使用缓存。

## 验证

在项目目录运行：

```sh
node --check elearning-pdf-preview.user.js
node --test tests/userscript.test.cjs
```

脚本的本地测试覆盖了 Canvas 文件链接的识别、下载按钮排除、普通链接排除及跨域重定向后的读取回退。由于不同课程的文件权限和文件服务可能不同，请在自己有权限访问的 PDF 上验证。

## 许可

本项目以 [MIT 许可证](LICENSE)发布。
