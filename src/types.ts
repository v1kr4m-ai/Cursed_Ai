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
}
