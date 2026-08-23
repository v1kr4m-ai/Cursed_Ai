package com.sunayna.runtime.jni

/**
 * JNI Bridge for llama.cpp native code.
 * This class handles the low-level interaction with the GGUF models.
 */
object LlamaNative {
    init {
        System.loadLibrary("sunayna-local-engine")
    }

    /**
     * Loads a GGUF model from the given path.
     * @return a pointer to the model instance (long)
     */
    external fun loadModel(modelPath: String, nGpuLayers: Int): Long

    /**
     * Generates tokens based on a prompt.
     * @param modelHandler the pointer returned by loadModel
     * @param options JSON string of inference options (temperature, top_p, etc.)
     * @param callback a callback to receive tokens in real-time
     */
    external fun generate(modelHandler: Long, prompt: String, options: String, callback: ModelCallback)

    /**
     * Stops the current generation process.
     */
    external fun stopGeneration(modelHandler: Long)

    /**
     * Unloads the model and frees resources.
     */
    external fun releaseModel(modelHandler: Long)

    /**
     * Process an image for vision reasoning (Moondream/LLaVA).
     */
    external fun processImage(modelHandler: Long, imageData: ByteArray): String

    /**
     * Transcribe audio using Whisper.
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
