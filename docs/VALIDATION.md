# CourseLens 2.2.0 验证记录

2026-10-04 本地构建与 JavaScript 语法检查通过，34 项自动测试通过。新增检查使用真实二进制 PPT 样例及包含中文和图片的两页 PPTX，验证幻灯片顺序、整页适应、滚动 / 手动翻页、解析 Worker 释放、异常压缩结构和外部资源隔离。原有 PDF、DOCX、HEIC、ZIP、权限与 HTTP 406 回归检查继续保留。

安装包检查核对 Manifest V3 CSP、随包资源、第三方许可、源码包完整性、SHA-256 和重复打包一致性。

[最新浏览器 CI](https://github.com/Makashibata02/fudan-elearning-CourseLens/actions/workflows/extension.yml)在 Linux Chromium 与 Windows Edge 中加载实际扩展，执行 11 组检查，涵盖离线示例、弹窗、整页适应、滚动 / 手动翻页、下载、DOCX、PPT / PPTX、真实 HEIC、ZIP、SpeedGrader 切换与错误处理，并比较跨系统安装包。每次提交的通过状态及截图以该次工作流结果为准；测试使用模拟课程，不含真实学生资料。

上一版 2.1.1 的[最终 CI 记录](https://github.com/Makashibata02/fudan-elearning-CourseLens/actions/runs/37185599459)已通过两个浏览器与跨系统构建一致性检查。

真实 eLearning 登录、跨服务器授权、SpeedGrader 切换，以及具体课件的排版仍需在实际课程中验收。自动检查使用的少量样例不保证所有 Office 文件都能完整还原；特殊字体、图表、公式、动画与加密文件的兼容范围见 README。

没有提交商店审核或上游 PR。Firefox 不在当前维护范围内。
