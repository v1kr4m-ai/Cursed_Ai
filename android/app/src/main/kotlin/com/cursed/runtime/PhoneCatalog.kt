package com.cursed.runtime

/**
 * Small models that run well on a phone (0.3 - 3.3 GB), with tags like the desktop's model list; the ones tagged
 * Vision can see pictures.
 * The links were checked against Hugging Face; each downloads straight into the phone engine's model folder.
 */
object PhoneCatalog {
    /**
     * A model, and for a model that can see pictures its picture reader (`mmprojUrl`), saved next to it as
     * "<file>.mmproj.gguf"; `bytes` is the two together.
     */
    data class Entry(val file: String, val name: String, val url: String, val bytes: Long, val tags: List<String>, val about: String,
                     val mmprojUrl: String? = null, val mmprojBytes: Long = 0) {
        val vision get() = mmprojUrl != null
    }

    private const val HF = "https://huggingface.co"
    val models = listOf(
        // These can see pictures (attach one in the chat).
        Entry("SmolVLM-256M-Instruct-Q8_0", "SmolVLM 256M", "$HF/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/SmolVLM-256M-Instruct-Q8_0.gguf", 278_824_384, listOf("Vision", "Tiny", "English"), "Sees pictures. Smallest; short descriptions.",
            "$HF/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-256M-Instruct-Q8_0.gguf", 103_769_856),
        Entry("SmolVLM-500M-Instruct-Q8_0", "SmolVLM 500M", "$HF/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf", 545_590_272, listOf("Vision", "Recommended", "Fast"), "Sees pictures. Best small choice for photos.",
            "$HF/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf", 108_783_360),
        Entry("SmolVLM2-2.2B-Instruct-Q4_K_M", "SmolVLM2 2.2B", "$HF/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/SmolVLM2-2.2B-Instruct-Q4_K_M.gguf", 1_705_125_856, listOf("Vision", "Smarter"), "Sees pictures in more detail. Needs 4 GB+ RAM.",
            "$HF/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/resolve/main/mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf", 592_523_200),
        Entry("Qwen2.5-VL-3B-Instruct-Q4_K_M", "Qwen 2.5 VL 3B", "$HF/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf", 2_774_658_784, listOf("Vision", "Multilingual", "Smarter"), "Reads text in photos well. Needs 6 GB+ RAM.",
            "$HF/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf", 844_757_728),
        Entry("gemma-3-4b-it-Q4_K_M", "Gemma 3 4B", "$HF/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf", 3_341_008_960, listOf("Vision", "Multilingual", "Smarter"), "Strongest here at pictures and chat. Needs 8 GB+ RAM.",
            "$HF/ggml-org/gemma-3-4b-it-GGUF/resolve/main/mmproj-model-f16.gguf", 851_251_104),
        // Text only.
        Entry("qwen2.5-0.5b-instruct-q4_k_m", "Qwen 2.5 0.5B", "$HF/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf", 491_400_032, listOf("Fast", "Tiny", "Multilingual"), "Tiny and quick. Short answers on any phone."),
        Entry("google_gemma-3-1b-it-Q4_K_M", "Gemma 3 1B", "$HF/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q4_K_M.gguf", 806_058_496, listOf("Fast", "Multilingual"), "Google's small model. Good everyday chat."),
        Entry("Llama-3.2-1B-Instruct-Q4_K_M", "Llama 3.2 1B", "$HF/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf", 807_694_464, listOf("Fast", "Multilingual"), "Meta's small model. Quick and friendly."),
        Entry("tinyllama-1.1b-chat-v1.0.Q4_K_M", "TinyLlama 1.1B", "$HF/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf", 668_788_096, listOf("Fast", "English"), "Older and simple. Fine for light chat."),
        Entry("SmolLM2-1.7B-Instruct-Q4_K_M", "SmolLM2 1.7B", "$HF/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf", 1_055_609_824, listOf("General", "English"), "Hugging Face's small model. Balanced."),
        Entry("qwen2.5-1.5b-instruct-q4_k_m", "Qwen 2.5 1.5B", "$HF/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf", 1_117_320_736, listOf("Recommended", "Multilingual"), "Best all-round choice for most phones."),
        Entry("qwen2.5-coder-1.5b-instruct-q4_k_m", "Qwen 2.5 Coder 1.5B", "$HF/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf", 1_117_320_768, listOf("Coding"), "Writes and explains code."),
        Entry("DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M", "DeepSeek R1 1.5B", "$HF/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf", 1_117_320_800, listOf("Reasoning"), "Thinks step by step before answering (slower)."),
        Entry("gemma-2-2b-it-Q4_K_M", "Gemma 2 2B", "$HF/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf", 1_708_582_752, listOf("Multilingual", "Writing"), "Good writing quality. Needs 4 GB+ RAM."),
        Entry("Llama-3.2-3B-Instruct-Q4_K_M", "Llama 3.2 3B", "$HF/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf", 2_019_377_696, listOf("Smarter", "Multilingual"), "Clearly smarter, slower. Needs 6 GB+ RAM."),
        Entry("qwen2.5-3b-instruct-q4_k_m", "Qwen 2.5 3B", "$HF/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf", 2_104_932_768, listOf("Smarter", "Multilingual"), "Strong for its size. Needs 6 GB+ RAM."),
        Entry("Phi-3.5-mini-instruct-Q4_K_M", "Phi 3.5 mini", "$HF/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf", 2_393_232_672, listOf("Reasoning", "English"), "Microsoft's small model. Good at maths and logic. Needs 6 GB+ RAM."),
    )

    /** The small model that can see pictures, to suggest when there is none on the phone. */
    val suggestedVision get() = models.first { it.file == "SmolVLM-500M-Instruct-Q8_0" }

    /** A friendly name for a model file on the phone (catalog name, or the file name). */
    fun nameFor(fileBase: String): String = models.firstOrNull { it.file.equals(fileBase, true) }?.name ?: fileBase
}
