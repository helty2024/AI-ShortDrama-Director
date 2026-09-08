# Production Manifest

分集摘要点击“导出 … Manifest”，主进程打开系统保存对话框并写 JSON。renderer 不提供任意输出路径，也不获得文件系统接口。

schemaVersion=1 包含项目、分集、导出时间和按 Scene.order / Shot.order 排序的 shots。每行至少有 episode、scene、shotId、shotNumber、duration、confirmedVideoAssetVersionId、characters、location、promptVersion、provider、cost、qcStatus、productionComplete。

media 为 `{scheme: "director-media", reference: "<project UUID>/<asset UUID>/<file UUID>.mp4", hash: "<SHA-256>"}`。reference 是 userData/media 下的受控相对引用，不是 renderer 可随意读取的路径；导出文件本身不含 API Key、Profile 凭据或临时云下载 URL。尚未确认的视频字段为 null，不能用最新 draft 代替。

当前导出是素材清单，不复制文件、不转码、不编码成片。消费者需要在用户授权后取得配套受控媒体目录或经后续显式素材交付接口访问文件，并校验 hash；仅复制 JSON 到另一机器不会使本地视频自动可用。

Codex Video Studio 边界：未来消费 Manifest + confirmed video assets，负责时间线、剪辑、转场、字幕、BGM、混音和最终编码。本项目不实现这些能力。Manifest 使用固定版本，后续生成或 Asset Promote 不会改变已导出的清单指向。
