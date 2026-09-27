import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
interface Props { children: ReactNode }
interface State { error: Error | null; retry: number }
export class CreatorErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retry: 0 }
  static getDerivedStateFromError(error: Error): Partial<State> { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Creator workspace failed', error, info) }
  render() {
    if (this.state.error) return <section className="creator-error" role="alert">
      <h2>当前工作区加载失败</h2>
      <p>可以重新加载当前工作区。</p>
      <button onClick={() => this.setState(({ retry }) => ({ error: null, retry: retry + 1 }))}>重新加载当前工作区</button>
      <details><summary>技术详情</summary><pre>{this.state.error.stack ?? this.state.error.message}</pre></details>
    </section>
    return <div key={this.state.retry}>{this.props.children}</div>
  }
}
