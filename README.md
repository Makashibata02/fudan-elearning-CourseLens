# CourseLens · 复旦 eLearning 文件阅读器

面向学生与助教，在复旦 eLearning 中直接阅读课程和作业附件：SpeedGrader 左侧阅读、右侧评分，普通课程附件在当前页面弹窗打开。

这是 [sjy0630/fudan-elearning-pdf-preview](https://github.com/sjy0630/fudan-elearning-pdf-preview) 独立插件分支的衍生项目。**本仓库的 `main` 是浏览器插件源码**，当前维护 Chrome / Microsoft Edge。与复旦大学及 eLearning 平台无官方关联。

## 安装与更新

当前候选版本 **2.1.1**。本项目 尚未发布商店版本或 GitHub Release；原作者的商店安装链接不代表本项目的功能版本。

1. 本地构建后解压 `dist/fudan-elearning-courselens-chromium-2.1.1.zip`，或直接使用仓库的 `dist/chromium`。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`；开启开发者模式，选择“加载已解压的扩展”，选中包含 `manifest.json` 的目录。
3. 登录 eLearning 并刷新课程页面。若已启用同类预览插件或脚本，请停用重复版本。

Chrome 与 Edge 使用同一个 Chromium 安装包。更新文件后在扩展管理页点击“重新加载”，再刷新 eLearning。手动安装不会自动接收商店更新。

推送后的检查结果和候选安装包见 [GitHub Actions](https://github.com/Makashibata02/fudan-elearning-CourseLens/actions/workflows/extension.yml)。请以实际成功的工作流为准；自动生成的 GitHub Source code ZIP 不是可直接安装的插件包。

## 使用

- 在 SpeedGrader 点击文件名或“阅读作业附件”，左侧显示阅读器。下拉框切换附件，“关闭”恢复原页面，评分和评语继续使用学校功能。
- 默认“适应页面”，完整显示一页或一张照片。可切换“适应宽度”或手动缩放查看细节。
- 多页 PDF / DOCX 默认连续滚动；阅读方式可切换为手动翻页，两种方式均可跳页。
- 普通课程附件优先弹窗阅读，可点击背景、关闭或按 Esc 退出；也可主动选择新标签页。
- ZIP 显示包内文件列表和目录路径，选择文件后解压并预览。其他类型可单独下载。
- 原下载图标和 Ctrl / Command / Shift 点击保留浏览器原行为。扩展菜单提供 PDF / DOCX / ZIP 示例及本地文件入口。

| 类型 | 支持内容 |
| --- | --- |
| PDF | 连续 / 手动翻页、跳页、整页 / 宽度适应、缩放、文字选择、密码输入和下载 |
| DOCX | 分页、文字、表格、图片、页眉页脚、脚注及支持的 OMML 数学公式 |
| HEIC / HEIF | 苹果照片本地解码；多图容器当前显示第一张照片 |
| PNG / JPEG / GIF / WebP / BMP | 整张显示与缩放 |
| TXT / MD / CSV / TSV / JSON / LOG / 常见代码 / TEX | 纯文本显示，UTF-8、带 BOM 的 UTF-16、GB18030 回退 |
| ZIP | Stored / Deflate 压缩，预览其中支持的文件，单独下载其他文件 |

DOCX 排版可能与 Word 不同，复杂图形、图表、SmartArt 和部分公式请下载核对。旧版 DOC 需另存为 DOCX 或 PDF。文本和代码不执行；扫描 PDF 未包含 OCR。阅读器不提供画笔批注、自动评分或成绩提交。

单文件最多 100 MiB，文本 8 MiB，照片 5000 万像素。ZIP 最多 2048 个条目，单文件解压最多 100 MiB、声明总量最多 300 MiB；校验实际大小及 CRC，忽略苹果辅助文件。不支持加密、分卷、ZIP64 和嵌套 ZIP 的直接预览。DOCX 另有压缩结构及条目大小检查。

## 隐私与权限

默认仅访问 `https://elearning.fudan.edu.cn/*`；跨文件服务器时按实际目标域名申请权限。附件在浏览器本地解析，执行代码随包提供，不上传在线转换服务。不会修改成绩、评语或发布状态。详见 [隐私说明](docs/PRIVACY.md)。

## 从源码构建

推荐 Node.js 24，最低 22.13。依赖及完整性固定在锁文件中。保留 optional dependencies，esbuild 需要对应平台的二进制包。

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check
npm run package:source
npm run verify:packages
```

`dist/chromium` 为安装目录；`dist/*.zip` 为最新版安装 / 源码包；`dist/SHA256SUMS.txt` 为校验值。构建会清理本项目旧版本产物，源码包排除 `.git`、依赖、构建输出及私人文件，并包含工作树中的新增文件。

自动测试保留上游的 Linux Chromium / Windows Edge 检查及跨系统包一致性比较。浏览器测试使用隔离配置和模拟课程，不访问真实学生资料。验证状态见 [验证记录](docs/VALIDATION.md)，贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 来源与许可

保留上游 Git 历史和作者版权；来源基线见 [来源说明](docs/UPSTREAM.md)。本项目 独立维护，向原作者的 PR 暂缓，待获得其同意后再讨论。

项目代码沿用 MIT；第三方代码分别遵循其许可证，HEIC 解码器使用 LGPL-3.0，对应源码和构建说明随包提供。详见 [第三方说明](THIRD-PARTY-NOTICES.md)。
