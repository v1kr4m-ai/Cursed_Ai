/**
 * Voice commands about ComfyUI itself, understood without asking the language model:
 * "start ComfyUI", "launch comfy ui for me", "is ComfyUI running?".
 */
export type ComfyCommand = "start" | "stop" | "status";

const NAME = "comfy\\s?ui|comfy";
const START = new RegExp(`\\b(start|launch|run|boot|open|turn on|switch on|fire up|bring up|power on)\\b[^.?!]*\\b(${NAME})\\b`, "i");
const STOP = new RegExp(`\\b(stop|close|quit|shut down|shutdown|turn off|switch off|kill|exit)\\b[^.?!]*\\b(${NAME})\\b`, "i");
const STATUS = new RegExp(`\\b(is|check if|check whether|see if|tell me if)\\b[^.?!]*\\b(${NAME})\\b[^.?!]*\\b(running|on|up|started|working|alive|open)\\b`, "i");

export function parseComfyCommand(raw: string): ComfyCommand | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || text.length > 120) return null;
  if (STATUS.test(text)) return "status";
  if (STOP.test(text)) return "stop";
  if (/^(what|who|why|how|tell me about|explain)\b/i.test(text)) return null;
  return START.test(text) ? "start" : null;
}
