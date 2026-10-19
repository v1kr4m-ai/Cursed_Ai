/**
 * Shared types for Cursed_Ai
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
  /** Instructions given to the model at the start of this chat (persona, tone, rules). */
  systemPrompt?: string;
  /** A reply arrived while this chat was not on screen. Cleared when it is opened. */
  unread?: boolean;
  /** Pinned chats stay at the top of History. */
  pinned?: boolean;
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
  /** File size in bytes when known, for the RAM-fit hint. */
  sizeBytes?: number;
  /** Which folder a local file came from (read-only unless it is the download folder). */
  origin?: "download" | "lmstudio" | "ollama" | "custom";
  /** Full path on disk, when it is a local file. */
  location?: string;
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
  voiceEngine: 'auto' | 'browser' | 'whisper';
  temperature: number;
  topP: number;
  maxTokens: number;
  /** CPU threads handed to the local llama.cpp context. */
  threads: number;
  /** Context window size (tokens) requested when the model is loaded. */
  kvCacheSize: number;
  /** Advanced sampling. topK 0 / minP 0 / repeatPenalty 1 mean "off". */
  topK: number;
  minP: number;
  repeatPenalty: number;
  /** 'random' = a different seed every reply; 'fixed' = the same seed (repeatable answers at low temperature). */
  seedMode: 'random' | 'fixed';
  seed: number;
  /** Instructions given to every NEW chat (a chat can still change its own). */
  defaultSystemPrompt: string;
  /** true: Enter sends, Shift+Enter is a new line. false: Ctrl+Enter sends, Enter is a new line. */
  enterToSend: boolean;
  /** Read every finished reply aloud. */
  autoSpeak: boolean;
  /** Ask before deleting a chat. */
  confirmDelete: boolean;
  /** Popups for finished work and errors. */
  popups: boolean;
  /** Also raise a Windows notification when the window is in the background. */
  desktopNotify: boolean;
  /** Turns off animations and transitions everywhere. */
  reduceMotion: boolean;
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
