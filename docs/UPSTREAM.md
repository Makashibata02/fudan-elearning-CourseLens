# 来源与上游沟通

- 原仓库：https://github.com/sjy0630/fudan-elearning-pdf-preview
- 基线分支：`feature/standalone-extension`
- 基线提交：`5cc33865a169cd0945d8fee9f0648f30bc9dc16c`
- 本项目：https://github.com/Makashibata02/fudan-elearning-CourseLens
- 本项目的 main 维护插件，保留原 Git 历史和 MIT 版权。原作者不对本项目 新功能作兼容或发布承诺。

## 上游 PR 规则核对（2026-10-04）

公开 API 检索结果：未发现 CONTRIBUTING、PR 模板、CODEOWNERS 或公开 CLA / DCO 要求。公开 `Protect main` 规则针对原仓库默认 main，要求通过 PR，并限制删除及非快进推送；独立插件分支报告 protected=false。分支保护详情 API 需要登录，因此不把未公开设置当成不存在。

原仓库把油猴版 main 和独立插件分支分开维护。已有涉及非 PDF 文件的 PR；提交前需重新核对规则、路线图及重叠工作，沟通 Office / HEIC / ZIP 功能的接收方向。

规则：https://github.com/sjy0630/fudan-elearning-pdf-preview/rules/24176714
CI：https://github.com/sjy0630/fudan-elearning-pdf-preview/blob/feature/standalone-extension/.github/workflows/extension.yml

当前决定：先建设独立仓库；获得原作者同意后再考虑上游 PR。保留原提交来源不表示已成为上游协作者。

本仓库独立创建，不属于 GitHub fork 网络。以后若向上游提交跨仓库 PR，需按 GitHub 的 fork 工作流准备贡献分支，并先与原作者确认目标分支及范围。
