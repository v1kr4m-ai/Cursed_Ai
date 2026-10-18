import React from "react";
import { Sparkles, Loader2, Undo2 } from "lucide-react";
import { AIService } from "../../services/aiService";
import { MessageRole } from "../../types";
import { notifyError, notify } from "../../lib/notify";

const BRIEF = {
  image: "Rewrite the idea below as one detailed prompt for an AI image generator: subject, setting, composition, lighting, style, colours, camera or lens. Keep the original meaning, no invented text in the image.",
  video: "Rewrite the idea below as one detailed prompt for an AI video generator: subject, action over time, setting, camera movement, lighting, style, mood. Keep the original meaning.",
};

/**
 * Sparkle button that rewrites a short idea into a rich generation prompt using the chat model that is selected
 * (runs locally). The previous text can be restored with the undo arrow.
 */
export function EnhancePromptButton({ kind, prompt, onPrompt, modelId, tab, className = "" }: { kind: "image" | "video"; prompt: string; onPrompt: (t: string) => void; modelId?: string; tab: string; className?: string }) {
  const [busy, setBusy] = React.useState(false);
  const [previous, setPrevious] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);

  const enhance = async () => {
    if (busy) { abort.current?.abort(); return; }
    if (!prompt.trim() || !modelId) { if (!modelId) notifyError("Select a chat model first (Chat tab).", tab); return; }
    const original = prompt;
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    let out = "";
    try {
      await AIService.generate(
        [{ id: "e", role: MessageRole.USER, content: `${BRIEF[kind]}\n\nReply with the prompt only - one paragraph, no quotes, no preamble.\n\nIdea: ${original}`, timestamp: Date.now() }],
        modelId,
        { onToken: (t) => { out += t; }, onError: (e) => notifyError(e?.message || String(e), tab), onComplete: () => {} },
        { signal: controller.signal, memoryEnabled: false, maxTokens: 300 },
      );
      const cleaned = out.replace(/<think>[\s\S]*?<\/think>/g, "").trim().replace(/^["']|["']$/g, "").replace(/^(prompt|enhanced prompt)\s*:\s*/i, "").trim();
      if (cleaned) { setPrevious(original); onPrompt(cleaned); notify({ message: "Prompt enhanced", tab }); }
      else if (!controller.signal.aborted) notifyError("The model returned nothing. Try another chat model.", tab);
    } catch (e: any) {
      if (e?.name !== "AbortError") notifyError(e?.message || String(e), tab);
    } finally { abort.current = null; setBusy(false); }
  };

  const btn = "p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors disabled:opacity-40";
  return (
    <span className={`inline-flex gap-1.5 shrink-0 ${className}`}>
      <button onClick={enhance} disabled={!busy && !prompt.trim()} title={busy ? "Stop" : "Enhance prompt with the local chat model"} className={btn}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} className="text-amber-400" />}
      </button>
      {previous !== null && !busy && <button onClick={() => { onPrompt(previous); setPrevious(null); }} title="Restore the previous text" className={btn}><Undo2 size={15} /></button>}
    </span>
  );
}
