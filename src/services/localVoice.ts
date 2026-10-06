/**
 * Local, offline voice transcription — records the mic, decodes/resamples
 * to 16kHz mono PCM in-browser (Web Audio API), and posts the raw samples
 * to /api/voice/transcribe, which runs a real local Whisper model
 * (transformers.js) server-side. No audio leaves the machine.
 */

const TARGET_SAMPLE_RATE = 16000;

// Whisper writes things like [BLANK_AUDIO], (silence) or [MUSIC] for non-speech; those are not words.
function cleanTranscript(text: string): string {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const decodeCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    decodeCtx.close();
  }

  const targetLength = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

export class LocalVoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  static get isSupported(): boolean {
    return typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined" &&
      (typeof AudioContext !== "undefined" || typeof (window as any).webkitAudioContext !== "undefined");
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  /** Stops recording, decodes it, and returns the transcribed text from the local Whisper model. */
  async stopAndTranscribe(): Promise<string> {
    const recorder = this.mediaRecorder;
    if (!recorder) throw new Error("Recording was never started");

    const blob: Blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      recorder.stop();
    });
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.mediaRecorder = null;

    if (blob.size === 0) return "";

    const samples = await decodeToMono16k(blob);
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: samples.buffer as ArrayBuffer,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Transcription failed (HTTP ${response.status})`);
    }
    const data = await response.json();
    return data.text || "";
  }

  private endListening: (() => void) | null = null;
  private cancelled = false;
  private pcmStop: (() => void) | null = null;

  /** POST 16 kHz mono samples to the local Whisper endpoint. */
  private static async transcribe(raw: Float32Array): Promise<string> {
    // Quiet microphones: scale the clip up (never more than 40x) so Whisper gets a healthy signal.
    let peak = 0;
    for (let i = 0; i < raw.length; i++) { const a = Math.abs(raw[i]); if (a > peak) peak = a; }
    const samples = peak > 0 && peak < 0.5 ? raw.map(v => v * Math.min(40, 0.8 / peak)) : raw;
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Transcription failed (HTTP ${response.status})`);
    }
    return cleanTranscript((await response.json()).text || "");
  }

  /** Linear resample to 16 kHz. */
  private static to16k(input: Float32Array, rate: number): Float32Array {
    if (rate === TARGET_SAMPLE_RATE) return input;
    const ratio = rate / TARGET_SAMPLE_RATE;
    const out = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, input.length - 1);
      out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
    }
    return out;
  }

  /**
   * Hands-free capture: records until you stop talking, then transcribes locally (no internet needed).
   * Audio is taken as raw samples (no encode/decode step), a short pause ends the phrase, and
   * transcription is started a moment BEFORE the pause is confirmed, so the answer is ready sooner.
   * Resolves "" if nothing was said.
   */
  async listenOnce(opts: { onLevel?: (level: number) => void; onSpeechStart?: () => void; onPartial?: (text: string) => void; onEnd?: () => void; silenceMs?: number; maxWaitMs?: number; maxMs?: number } = {}): Promise<string> {
    const { onLevel, onSpeechStart, onPartial, onEnd, silenceMs = 650, maxWaitMs = 10000, maxMs = 30000 } = opts;
    this.cancelled = false;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AudioCtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    // Browsers can create an audio context "suspended" when it was not started by a click; wake it up.
    try { await ctx.resume(); } catch { /* already running */ }
    const rate = ctx.sampleRate;
    const source = ctx.createMediaStreamSource(this.stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);   // universal across browsers
    const mute = ctx.createGain(); mute.gain.value = 0;    // keep the node running without playing the mic back
    source.connect(proc); proc.connect(mute); mute.connect(ctx.destination);

    const chunks: Float32Array[] = [];
    const t0 = performance.now();
    let noise = 0.004, spoke = false, speechStartIdx = 0, lastLoud = 0, quietChunks = 0;
    let speculative: { len: number; promise: Promise<string> } | null = null;
    let partialBusy = false, lastPartialAt = t0, finished = false;
    const lastLoudChunk = { i: -1 };

    const merge = (from: number, to: number) => {
      const part = chunks.slice(from, to);
      const out = new Float32Array(part.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of part) { out.set(c, o); o += c.length; }
      return out;
    };
    // Speech from ~300 ms before it was detected up to a short tail after the last loud moment.
    const utterance = () => {
      const pre = Math.ceil((0.3 * rate) / 2048);
      return LocalVoiceRecorder.to16k(merge(Math.max(0, speechStartIdx - pre), Math.min(chunks.length, lastLoudChunk.i + 1 + Math.ceil((0.25 * rate) / 2048))), rate);
    };

    await new Promise<void>((resolve) => {
      const stop = () => { proc.onaudioprocess = null; resolve(); };
      this.pcmStop = stop;
      this.endListening = stop;
      proc.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0)); // copy: the browser reuses its buffer
        const idx = chunks.push(data) - 1;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();
        if (now - t0 < 350) noise = Math.max(noise * 0.9, rms); // learn the room's background level first
        const threshold = Math.max(0.003, noise * 3); // sensitive enough for quiet microphones
        onLevel?.(Math.min(1, rms * 8));
        if (rms > threshold) {
          if (!spoke) { spoke = true; speechStartIdx = idx; onSpeechStart?.(); }
          lastLoud = now; lastLoudChunk.i = idx; quietChunks = 0;
          speculative = null; // still talking: any early transcription is stale
          // Live captions while you speak: transcribe what has been said so far every ~1.5 s.
          if (onPartial && !partialBusy && now - lastPartialAt > 1500) {
            partialBusy = true; lastPartialAt = now;
            LocalVoiceRecorder.transcribe(utterance())
              .then(t => { if (!finished && t.trim()) onPartial(t.trim()); })
              .catch(() => {})
              .finally(() => { partialBusy = false; });
          }
        } else if (spoke) {
          quietChunks++;
          const quietFor = now - lastLoud;
          // Halfway to the pause: begin transcribing what we have. If you keep quiet it is already under way.
          if (!speculative && quietFor > silenceMs * 0.5) {
            const samples = utterance();
            speculative = { len: samples.length, promise: LocalVoiceRecorder.transcribe(samples) };
            speculative.promise.catch(() => {});
          }
          if (quietFor > silenceMs) return stop();
        }
        if ((!spoke && now - t0 > maxWaitMs) || now - t0 > maxMs) stop();
      };
    });
    finished = true;
    this.pcmStop = null; this.endListening = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    ctx.close();
    if (this.cancelled || !spoke) return "";
    onEnd?.(); // the caller can show "transcribing..." while Whisper works
    const final = utterance();
    const spec = speculative as { len: number; promise: Promise<string> } | null;
    return spec && spec.len === final.length ? spec.promise : LocalVoiceRecorder.transcribe(final);
  }

  /** End the current listenOnce right now (what was said so far is still transcribed). */
  finish(): void { this.endListening?.(); }

  cancel(): void {
    this.cancelled = true;
    this.endListening?.();
    this.pcmStop?.();
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
  }
}
