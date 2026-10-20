import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { error: Error | null }

// 描画中の例外で画面が真っ白になるのを防ぐ受け皿。原因の一行と復帰ボタンを出す。
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TYPE ROYALE] 描画エラー', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-text">
        <div className="tr-card max-w-md w-full p-7 text-center">
          <div className="font-tech text-incoming text-xs tracking-[0.3em] mb-2">ERROR</div>
          <h1 className="text-xl font-bold mb-2 [text-wrap:balance]">表示中に問題が起きました</h1>
          <p className="text-sm text-muted mb-5 leading-relaxed">
            記録や設定はこの端末に保存されたままです。ホームに戻ると続きから遊べます。
          </p>
          <div className="flex gap-2 justify-center">
            <button className="tr-btn px-5 py-2" onClick={() => window.location.reload()}>ホームに戻る</button>
          </div>
          <details className="mt-5 text-left">
            <summary className="text-xs text-muted cursor-pointer">エラーの詳細（開発者向け）</summary>
            <pre className="mt-2 text-xs text-muted whitespace-pre-wrap break-all font-mono2">{error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
