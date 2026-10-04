import React from "react";

/** Last line of defence: a crash in one screen shows a message and a way out instead of a blank page. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("UI crashed:", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-black text-white">Something went wrong</h1>
          <p className="text-zinc-400 text-sm">The screen hit an unexpected error. Your chats are saved - reloading usually fixes it.</p>
          <p className="text-xs text-red-400 font-mono bg-red-500/10 rounded-xl p-3 break-words">{this.state.error.message}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => this.setState({ error: null })} className="px-5 py-2.5 rounded-xl bg-white/10 text-white text-sm font-bold">Try again</button>
            <button onClick={() => location.reload()} className="px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-bold">Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
