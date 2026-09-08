# 视频凭据边界

CredentialStore 定义 get/set/has，当前 EncryptedCredentialStore 使用 Electron safeStorage。Windows 使用系统保护的加密数据；Linux 若后端为 basic_text 或系统加密不可用则拒绝保存，绝不退回明文文件。

通过系统文件对话框选择 Key 文件，主进程限制 8192 字节并读取、加密，写入 userData/credentials/<UUID>.bin。SQLite Profile 和 Task 快照只有 credentialRef；renderer 得到公共设置与是否配置，既没有 Key 字段，也没有任意路径读取接口。网络请求在主进程解密后附加 Bearer，结果下载不附加认证头，日志与错误不输出原始密钥或响应正文。

凭据文件导入不意味着应用删除原文本。请将原文件保存在仓库外并自行妥善处理；.gitignore 排除常见 credentials/secret/key 文件，但不要依赖文件名排除作为唯一防线。系统加密绑定用户/机器，不能承诺复制 userData 后跨机器可解密；需在目标机器重新导入。

Profile 改名或普通设置更新不允许 renderer 伪造 credentialRef，引用仅由安全导入生成。原引用可更新加密内容以轮换 Key。任务使用引用读取当前 Key，历史请求不保存旧 Key。项目删除级联删除 Profile/Task，但不自动清理系统凭据文件或媒体，避免误删共享和恢复材料。

测试使用注入的 AES-GCM 加密器验证磁盘无明文、不可用时拒绝保存和 Profile 隔离；实际应用使用 safeStorage，不把测试加密器用于生产。
