package com.cursed.runtime.jni

/**
 * JNI Bridge for llama.cpp native code.
 * This class handles the low-level interaction with the GGUF models.
 */
object LlamaNative {
    init {
        System.loadLibrary("cursed-local-engine")
    }

    /**
     * Loads a GGUF model from the given path.
     * @return a pointer to the model instance (long)
     */
    external fun loadModel(modelPath: String, nGpuLayers: Int): Long

    /**
     * Generates tokens based on a prompt.
     * @param modelHandler the pointer returned by loadModel
     * @param temperature sampling temperature (<= 0 uses the native default)
     * @param topP nucleus sampling threshold (<= 0 uses the native default)
     * @param maxTokens maximum tokens to generate (<= 0 uses the native default)
     * @param callback a callback to receive tokens in real-time
     */
    external fun generate(modelHandler: Long, prompt: String, temperature: Float, topP: Float, maxTokens: Int, callback: ModelCallback)

    /**
     * Stops the current generation process.
     */
    external fun stopGeneration(modelHandler: Long)

    /**
     * Unloads the model and frees resources.
     */
    external fun releaseModel(modelHandler: Long)

    /**
     * Not implemented: no CLIP model is vendored in this build. Returns a
     * JSON error string rather than pretending to embed the image.
     */
    external fun processImage(modelHandler: Long, imageData: ByteArray): String

    /**
     * Not implemented: no Whisper model is vendored in this build (voice
     * input uses the browser's Web Speech API instead, which never calls
     * this). Returns an empty string.
     */
    external fun transcribeAudio(modelHandler: Long, pcmData: ShortArray): String

    /**
     * Phase 10: Performance configuration for battery/thermal awareness.
     */
    external fun setPerformanceConfig(modelHandler: Long, nThreads: Int, nBatch: Int)

    /**
     * Phase 10: Lazy context restoration logic.
     */
    external fun restoreContext(modelHandler: Long)

    /**
     * Returns runtime stats (VRAM, RAM, active context tokens, profiling).
     */
    external fun getStats(modelHandler: Long): String

    interface ModelCallback {
        fun onToken(token: String)
        fun onComplete()
        fun onError(message: String)
    }
}
