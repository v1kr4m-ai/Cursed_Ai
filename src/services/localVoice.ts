/**
 * Local, offline voice transcription — records the mic, decodes/resamples
 * to 16kHz mono PCM in-browser (Web Audio API), and posts the raw samples
 * to /api/voice/transcribe, which runs a real local Whisper model
 * (transformers.js) server-side. No audio leaves the machine.
 */

const TARGET_SAMPLE_RATE = 16000;

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

  /**
   * Hands-free capture: records until you stop talking (or the wait/length limit), then transcribes locally.
   * Resolves "" if nothing was said. Works in any browser with a microphone, no internet needed.
   */
  async listenOnce(opts: { onLevel?: (level: number) => void; onSpeechStart?: () => void; onEnd?: () => void; silenceMs?: number; maxWaitMs?: number; maxMs?: number } = {}): Promise<string> {
    const { onLevel, onSpeechStart, onEnd, silenceMs = 1300, maxWaitMs = 10000, maxMs = 30000 } = opts;
    this.cancelled = false;
    await this.start();
    const AudioCtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(this.stream!).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const t0 = performance.now();
    let noise = 0.01, spoke = false, lastLoud = 0;

    await new Promise<void>((resolve) => {
      this.endListening = resolve;
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (now - t0 < 400) noise = Math.max(noise * 0.9, rms); // learn the room's background level first
        const threshold = Math.max(0.02, noise * 2.5);
        onLevel?.(Math.min(1, rms * 8));
        if (rms > threshold) {
          if (!spoke) { spoke = true; onSpeechStart?.(); }
          lastLoud = now;
        }
        const quietFor = now - lastLoud;
        if ((spoke && quietFor > silenceMs) || (!spoke && now - t0 > maxWaitMs) || now - t0 > maxMs) resolve();
      }, 60);
      const done = this.endListening;
      this.endListening = () => { clearInterval(timer); done?.(); };
    });
    this.endListening = null;
    ctx.close();
    if (this.cancelled || !spoke) { this.cancel(); return ""; }
    onEnd?.(); // the caller can show "transcribing..." while Whisper works
    return this.stopAndTranscribe();
  }

  /** End the current listenOnce right now (what was said so far is still transcribed). */
  finish(): void { this.endListening?.(); }

  cancel(): void {
    this.cancelled = true;
    this.endListening?.();
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
  }
}
