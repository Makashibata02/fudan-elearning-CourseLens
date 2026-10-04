# 参与 CourseLens

本仓库 `main` 维护 Chrome / Edge 插件。功能分支向本仓库 `main` 提交 PR；向原作者贡献前先沟通接收方向，不直接将本项目的重构合并到其油猴版 main。

## 开发与检查

使用 Node.js 24 和锁文件安装依赖：

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check
npm run package:source
npm run verify:packages
```

交互修改还应运行浏览器检查并附结果：

```sh
npx playwright install chromium
npm run test:browser
```

Windows Edge 可在 PowerShell 设置 `$env:BROWSER_CHANNEL='msedge'`、`$env:HEADED='1'` 后运行相同测试命令。该测试创建临时配置，拦截所有 HTTP 请求，仅使用模拟课程和合成样例；不要改为日常浏览器配置或真实学生附件。

## 提交说明

README 和安装后的欢迎页以功能、使用方法、安装及兼容限制为主，不写版本更新、审核或发布进度。具体改动与验证结果在 commit 说明中交代。

描述具体问题、改变后的行为及验证范围。新增文件类型应包含合理的限制、失败提示和样例；新增依赖应固定版本并保留许可及对应源码要求。构建产物、浏览器配置、真实课程文件、账号信息和授权链接不提交到 Git。

保持所有执行代码随包提供；保留 MV3 `worker-src 'self'` 和按实际服务器申请权限的流程。更改不得自动提交成绩或评语。

本项目当前未要求 CLA 或 DCO。公开 PR 规则可能变化，提交前检查仓库规则和 CI；不要把测试配置写成已运行的验证结果。
