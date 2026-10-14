export function comfyStatus(runtime?: string) {
  if (runtime === 'ready-for-configured-template') return { label: '可用', reason: '本地服务、模型和制作模板检测通过，可以生成图像。' }
  if (runtime === 'capability-blocked') return { label: '需要配置', reason: '本地服务已连接，但模型或模板尚未就绪。打开配置检查模型，再检测连接。' }
  return { label: '未连接本地服务', reason: '请启动本机 ComfyUI，打开配置检查地址和模型，再检测连接。' }
}
export function h3Status(configured: boolean, authenticated: boolean | undefined) {
  if (authenticated === true) return '连接检测通过'
  if (authenticated === false) return '连接检测未通过'
  return configured ? '密钥已保存' : '尚未配置密钥'
}
