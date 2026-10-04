# 隐私说明

CourseLens 是非官方的本地浏览器扩展。没有接收用户作业的服务端、广告或遥测。

- 仅在复旦 eLearning 识别附件链接，使用同一浏览器的已有登录状态读取用户有权访问的附件；不读取或保存账号密码，没有 cookies API 权限。
- PDF、DOCX、PPT / PPTX、HEIC、图片、文本和 ZIP 在浏览器本地解析，库、Worker、字体和解码资源随扩展提供。不发送到在线预览、AI 或分析服务。
- 默认网站权限仅为 `https://elearning.fudan.edu.cn/*`。`webRequest` 用来识别实际文件重定向；授权按钮仅申请该目标服务器，不默认授予所有网站访问权。
- 不持久保存作业或请求日志；浏览器自身可能缓存数据。用户主动点击下载才保存文件，本地文件选择也只在浏览器读取。
- 不修改成绩、评语、学生列表或发布状态。可随时撤销可选网站权限或卸载扩展。
- DOCX 外部嵌入资源和 HTML 块不加载；文档网页链接仅手动点击后打开。PPT / PPTX 仅显示静态幻灯片，不加载外部图片或播放嵌入媒体。

反馈：[本项目的 Issues](https://github.com/Makashibata02/fudan-elearning-CourseLens/issues)。公开反馈不要包含学生资料、账号密码或带 verifier / 授权参数的文件链接。
