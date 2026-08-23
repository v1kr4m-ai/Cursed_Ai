/**
 * Shared types for Sunayna App
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
  timestamp: number;
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
}

export interface AppSettings {
  vulkanEnabled: boolean;
  theme: 'light' | 'dark' | 'system';
  apiPort: number;
  apiEnabled: boolean;
  memoryEnabled: boolean;
  voiceEnabled: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  /** CPU threads handed to the local llama.cpp context. */
  threads: number;
  /** Context window size (tokens) requested when the model is loaded. */
  kvCacheSize: number;
}
