/**
 * Shared types for Cursed App
 */

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  images?: string[];
  attachments?: Attachment[];
  timestamp: number;
}

/** A file attached to a message. Documents carry their extracted text; images live in Message.images. */
export interface Attachment {
  name: string;
  kind: "image" | "doc";
  text?: string;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  modelId: string;
  archived?: boolean;
}

export interface AIModel {
  id: string;
  name: string;
  description: string;
  size: string;
  format: 'GGUF' | 'GGML' | 'ONNX';
  isDownloaded: boolean;
  downloadProgress?: number;
  parameters: string;
  type: 'General' | 'Vision' | 'Fast' | 'Reasoning';
  /** Direct HTTPS URL to the .gguf file. Omitted for models with no working download path yet. */
  downloadUrl?: string;
  /** Where it runs: a GGUF file, or an external local server. */
  source?: 'gguf' | 'ollama' | 'lmstudio';
  /** Capability flags: Reasoning, Coding, Multilingual, Vision, Tools, Embedding. */
  tags?: string[];
}

export interface AppSettings {
  vulkanEnabled: boolean;
  theme: 'light' | 'dark' | 'system';
  apiPort: number;
  apiEnabled: boolean;
  memoryEnabled: boolean;
  voiceEnabled: boolean;
  /** 'browser' = Web Speech API (fast, needs Chrome + isn't fully offline).
   *  'whisper' = real local Whisper model via /api/voice/transcribe (offline, slower). */
  voiceEngine: 'browser' | 'whisper';
  temperature: number;
  topP: number;
  maxTokens: number;
  /** CPU threads handed to the local llama.cpp context. */
  threads: number;
  /** Context window size (tokens) requested when the model is loaded. */
  kvCacheSize: number;
}

export interface LogLine {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  /** data: URL (base64) */
  src: string;
  createdAt: number;
}

export type VideoJobStatus = 'pending' | 'done' | 'error' | 'cancelled';

export interface VideoJob {
  id: string;
  prompt: string;
  status: VideoJobStatus;
  /** Set once status is 'done' - relative URL to stream the result from. */
  resultUrl?: string;
  error?: string;
  createdAt: number;
}
