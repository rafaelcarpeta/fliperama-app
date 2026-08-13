import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: (err: Error, reset: () => void) => ReactNode
}

interface State {
  err: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error, info: { componentStack?: string }): void {
    console.error("[ErrorBoundary]", err, info.componentStack)
  }

  reset = (): void => {
    this.setState({ err: null })
  }

  render(): ReactNode {
    const { err } = this.state
    if (!err) return this.props.children
    if (this.props.fallback) return this.props.fallback(err, this.reset)
    return (
      <div className="right-panel empty">
        <div className="empty-art" />
        <p style={{ color: "#ef4444", padding: 16, fontSize: 12 }}>
          Erro ao renderizar painel: <code>{err.message}</code>
        </p>
      </div>
    )
  }
}