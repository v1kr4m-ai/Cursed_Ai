import { Message, MessageRole } from "../types";
import { chatWithGemini } from "../lib/gemini";

export interface AIResponseHandlers {
  onToken: (token: string) => void;
  onError: (error: any) => void;
  onComplete: () => void;
}

import { friendlyError } from "./errors";

export interface AIGenerationOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  memoryEnabled?: boolean;
  signal?: AbortSignal;
}

export class AIService {
  private static useLocal = true;

  static setMode(local: boolean) {
    this.useLocal = local;
  }

  static isLocal() {
    return this.useLocal;
  }

  static async getModels() {
    try {
      const response = await fetch("/api/models");
      if (!response.ok) throw new Error("Failed to fetch models");
      return await response.json();
    } catch (e) {
      console.error("Local API not available, using hardcoded models", e);
      return null;
    }
  }

  static async getStats() {
    try {
      const response = await fetch("/api/stats");
      if (!response.ok) throw new Error("Failed to fetch stats");
      return await response.json();
    } catch (e) {
      return null;
    }
  }

  static async addMemory(text: string) {
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      return await response.json();
    } catch (e) {
      console.error("Failed to add memory", e);
      return null;
    }
  }

  static async getMemories() {
    try {
      const response = await fetch("/api/memory");
      if (!response.ok) throw new Error("Failed to fetch memories");
      return await response.json();
    } catch (e) {
      console.error("Failed to get memories", e);
      return [];
    }
  }

  static async generate(
    messages: Message[], 
    modelId: string, 
    handlers: AIResponseHandlers,
    options?: AIGenerationOptions
  ) {
    if (this.useLocal) {
      return this.generateLocal(messages, modelId, handlers, options);
    } else {
      return this.generateCloud(messages, modelId, handlers, options);
    }
  }

  private static async generateLocal(
    messages: Message[], 
    modelId: string, 
    handlers: AIResponseHandlers,
    options?: AIGenerationOptions
  ) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options?.signal,
        body: JSON.stringify({
          messages: messages.map(m => ({
            role: m.role === MessageRole.USER ? "user" : "assistant",
            // Attached documents are sent to the model as text after the user's own words.
            content: [m.content, ...(m.attachments || []).filter(a => a.kind === "doc").map(a => `

--- Attached file: ${a.name} ---
${a.text}
--- End of ${a.name} ---`)].join(""),
            images: m.images
          })),
          model: modelId,
          options: {
            temperature: options?.temperature,
            topP: options?.topP,
            maxTokens: options?.maxTokens,
            memoryEnabled: options?.memoryEnabled
          }
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to start inference");
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            if (dataStr === "[DONE]") {
              handlers.onComplete();
              return;
            }
            try {
              const data = JSON.parse(dataStr);
              if (data.error) {
                handlers.onError(new Error(data.error));
                return;
              }
              if (data.token) {
                handlers.onToken(data.token);
              }
            } catch (e) {
              // Ignore empty or malformed chunks
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log("[AIService] Generation aborted by client");
      } else {
        handlers.onError(new Error(friendlyError(error)));
      }
    }
  }

  private static async generateCloud(
    messages: Message[], 
    modelId: string, 
    handlers: AIResponseHandlers,
    options?: AIGenerationOptions
  ) {
    try {
      const fullText = await chatWithGemini(
        messages, 
        "gemini-1.5-flash", 
        (token) => {
          if (options?.signal?.aborted) return;
          handlers.onToken(token);
        }
      );
      if (!options?.signal?.aborted) {
        handlers.onComplete();
      }
      return fullText;
    } catch (error) {
      handlers.onError(error);
    }
  }
}
