# CourseLens 2.1.1 验证记录

本记录仅描述当前衍生项目，不把上游历史浏览器测试当作当前版本验收结果。

2026-10-04 本地验证：

- 构建、JavaScript 语法检查通过。
- 29 项自动测试通过，涵盖附件识别、权限、默认整页适应与阅读模式、DOCX 渲染、真实 HEIC 解码及 ZIP 校验。
- 安装包资源、Manifest V3 CSP、第三方许可、源码包完整性、SHA-256 以及确定性重复打包检查通过。
- npm audit 未报告已知漏洞。

浏览器端 CI 已配置 Linux Chromium 与 Windows Edge，并检查跨系统构建一致性。Chromium 153 与 Windows Edge 153 的 11 组实际扩展安装检查通过，包含默认权限、离线示例、弹窗、整页适应、滚动 / 手动翻页、主动下载、DOCX、真实 HEIC、ZIP、SpeedGrader 切换与错误处理。测试使用模拟课程，无真实学生数据。

[浏览器通过的 CI 记录](https://github.com/Makashibata02/fudan-elearning-CourseLens/actions/runs/37185033577)对应提交 `dc1232f`；该轮跨系统包比较发现示例 ZIP 使用构建时间戳，现已修正为固定日期。最终跨系统校验以最新工作流结果为准。早期 DOCX / ZIP 模拟响应误用 Uint8Array，已改为 Playwright 要求的 Buffer，不代表生产版文件读取故障。

发布前仍需验证真实 eLearning 登录、跨服务器授权、SpeedGrader 切换学生 / 附件，以及代表性 DOCX、HEIC 和 ZIP 的显示效果。用户已反馈先前版本 PDF 可读取，该反馈不自动覆盖本候选的全部格式和浏览器。

没有提交商店审核或上游 PR。Firefox 不在当前维护范围内。
