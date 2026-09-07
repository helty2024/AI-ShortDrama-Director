import './App.css'

const modules = [
  { number: '01', title: '故事与剧本', description: '整理创意、人物设定与分集剧本。' },
  { number: '02', title: '分镜与镜头', description: '规划镜头语言、画面构图与拍摄节奏。' },
  { number: '03', title: '素材与生成', description: '组织角色、场景和 AI 生成素材。' },
]
export default function App() {
  const desktop = window.desktop
  return (
    <main className="workspace">
      <header><span className="brand">DIRECTOR / 导演工作台</span><span className="badge">项目骨架 · v0.1.0</span></header>
      <section className="intro" aria-labelledby="title">
        <p className="eyebrow">AI SHORTDRAMA DIRECTOR</p>
        <h1 id="title">让故事，从这里开始。</h1>
        <p className="description">面向 AI 短剧创作的桌面工作台。基础环境已就绪，接下来逐步构建剧本、分镜和素材工作流。</p>
      </section>
      <section className="modules" aria-label="规划中的创作模块">
        {modules.map((module) => (
          <article key={module.number}>
            <span className="number">{module.number}</span>
            <h2>{module.title}</h2><p>{module.description}</p><span className="status">待开发</span>
          </article>
        ))}
      </section>
      <footer><span className="runtime">{desktop ? '桌面环境已连接 · ' + desktop.platform : '浏览器预览模式'}</span><span>{desktop ? 'Electron ' + desktop.versions.electron : 'React + TypeScript'}</span></footer>
    </main>
  )
}
