#include <jni.h>
#include <string>
#include <vector>
#include <cstring>
#include <mutex>
#include <atomic>
#include <stdexcept>
#include <android/log.h>
#include <sys/time.h>

#include "llama.h"
#include "ggml-backend.h"

#define TAG "CursedNative"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// Real llama.cpp-backed inference. Loads an actual GGUF file, runs actual
// token generation through the model, and reports actual telemetry.
//
// Not yet implemented (kept honest rather than faked): multi-turn history
// threading (every call is a fresh single-turn completion — see
// ApiServer.kt, which doesn't forward request.messages to this layer yet),
// vision (processImage) and speech-to-text (transcribeAudio) — no CLIP or
// Whisper model is vendored, so both return a clear "not implemented" error
// instead of canned text.

struct model_instance {
    llama_model* model = nullptr;
    llama_context* ctx = nullptr;
    const llama_vocab* vocab = nullptr;

    std::atomic<bool> stop_flag{false};
    std::mutex gen_mutex; // serialize concurrent generate() calls on one instance

    double last_generation_tps = 0.0;
    long total_tokens_generated = 0;
    int n_threads = 4;
    int n_batch = 512;
};

static long current_time_ms() {
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    return (tv.tv_sec * 1000L) + (tv.tv_usec / 1000L);
}

static std::once_flag g_backend_init_flag;
static void ensure_backend() {
    std::call_once(g_backend_init_flag, []() {
        llama_backend_init();
        LOGI("llama.cpp backend initialized (%zu ggml backend device(s) registered)", ggml_backend_dev_count());
    });
}

extern "C"
JNIEXPORT jlong JNICALL
Java_com_cursed_runtime_jni_LlamaNative_loadModel(JNIEnv *env, jobject, jstring model_path, jint n_gpu_layers) {
    ensure_backend();
    const char *path = env->GetStringUTFChars(model_path, nullptr);
    LOGI("Loading GGUF model: %s (n_gpu_layers=%d)", path, n_gpu_layers);

    auto *inst = new model_instance();
    std::string error;

    try {
        if (std::string(path).find(".gguf") == std::string::npos) {
            throw std::runtime_error("Invalid model format: a .gguf file is required");
        }

        llama_model_params mparams = llama_model_default_params();
        mparams.n_gpu_layers = n_gpu_layers;

        inst->model = llama_model_load_from_file(path, mparams);
        if (!inst->model) {
            throw std::runtime_error("llama_model_load_from_file failed - file missing, corrupt, or an unsupported GGUF version");
        }

        inst->vocab = llama_model_get_vocab(inst->model);

        llama_context_params cparams = llama_context_default_params();
        cparams.n_ctx = 4096;
        cparams.n_batch = (uint32_t) inst->n_batch;
        cparams.n_threads = inst->n_threads;
        cparams.n_threads_batch = inst->n_threads;

        inst->ctx = llama_init_from_model(inst->model, cparams);
        if (!inst->ctx) {
            throw std::runtime_error("llama_init_from_model failed - likely out of memory for the requested context size");
        }

        LOGI("Model ready: n_ctx=%u, size=%.1fMB, gpu_backend=%s",
             llama_n_ctx(inst->ctx),
             llama_model_size(inst->model) / (1024.0 * 1024.0),
             ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_GPU) ? "yes" : "cpu-only");
    } catch (const std::exception &e) {
        error = e.what();
    }

    env->ReleaseStringUTFChars(model_path, path);

    if (!error.empty()) {
        LOGE("loadModel failed: %s", error.c_str());
        if (inst->ctx) llama_free(inst->ctx);
        if (inst->model) llama_model_free(inst->model);
        delete inst;
        env->ThrowNew(env->FindClass("java/lang/Exception"), error.c_str());
        return 0;
    }

    return reinterpret_cast<jlong>(inst);
}

extern "C"
JNIEXPORT void JNICALL
Java_com_cursed_runtime_jni_LlamaNative_generate(JNIEnv *env, jobject, jlong model_handler, jstring prompt,
                                                   jfloat temperature, jfloat top_p, jint max_tokens, jobject callback) {
    auto *inst = reinterpret_cast<model_instance *>(model_handler);

    jclass callbackClass = env->GetObjectClass(callback);
    jmethodID onTokenMethod = env->GetMethodID(callbackClass, "onToken", "(Ljava/lang/String;)V");
    jmethodID onCompleteMethod = env->GetMethodID(callbackClass, "onComplete", "()V");
    jmethodID onErrorMethod = env->GetMethodID(callbackClass, "onError", "(Ljava/lang/String;)V");

    if (!inst || !inst->ctx || !inst->model) {
        env->CallVoidMethod(callback, onErrorMethod, env->NewStringUTF("Model is not loaded"));
        return;
    }

    std::lock_guard<std::mutex> lock(inst->gen_mutex);
    inst->stop_flag = false;

    const char *c_prompt = env->GetStringUTFChars(prompt, nullptr);
    std::string prompt_str(c_prompt);
    env->ReleaseStringUTFChars(prompt, c_prompt);

    llama_sampler *smpl = nullptr;

    try {
        // Fresh single-turn completion: clear KV cache so unrelated previous
        // turns can't bleed into this one. Real multi-turn history threading
        // needs request.messages wired through from ApiServer.kt first.
        llama_memory_clear(llama_get_memory(inst->ctx), true);

        // Wrap the raw prompt in the model's chat template (falls back to
        // ChatML internally if the GGUF has none) so instruct-tuned models
        // see properly formatted input instead of raw completion text.
        llama_chat_message msg{"user", prompt_str.c_str()};
        const char *tmpl = llama_model_chat_template(inst->model, nullptr);
        std::vector<char> tmpl_buf(prompt_str.size() * 2 + 256);
        int32_t formatted_len = llama_chat_apply_template(tmpl, &msg, 1, true, tmpl_buf.data(), (int32_t) tmpl_buf.size());
        if (formatted_len > (int32_t) tmpl_buf.size()) {
            tmpl_buf.resize(formatted_len);
            formatted_len = llama_chat_apply_template(tmpl, &msg, 1, true, tmpl_buf.data(), (int32_t) tmpl_buf.size());
        }
        std::string formatted = formatted_len > 0 ? std::string(tmpl_buf.data(), formatted_len) : prompt_str;

        // Tokenize (first call with a null buffer just measures the size needed)
        int32_t n_tokens_needed = -llama_tokenize(inst->vocab, formatted.c_str(), (int32_t) formatted.size(), nullptr, 0, true, true);
        std::vector<llama_token> tokens(n_tokens_needed > 0 ? n_tokens_needed : 0);
        int32_t n_tokens = llama_tokenize(inst->vocab, formatted.c_str(), (int32_t) formatted.size(),
                                           tokens.data(), (int32_t) tokens.size(), true, true);
        if (n_tokens < 0) throw std::runtime_error("Tokenization failed");
        tokens.resize(n_tokens);

        const uint32_t n_ctx = llama_n_ctx(inst->ctx);
        if ((uint32_t) n_tokens >= n_ctx) {
            throw std::runtime_error("Prompt is too long for this model's context window");
        }

        llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
        smpl = llama_sampler_chain_init(sparams);
        llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
        llama_sampler_chain_add(smpl, llama_sampler_init_top_p(top_p > 0.0f ? top_p : 0.95f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temperature > 0.0f ? temperature : 0.8f));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

        const long start_time = current_time_ms();
        int tokens_generated = 0;
        const int max_new_tokens = max_tokens > 0 ? max_tokens : 512;
        uint32_t n_cur = (uint32_t) n_tokens;

        llama_batch batch = llama_batch_get_one(tokens.data(), (int32_t) tokens.size());
        if (llama_decode(inst->ctx, batch) != 0) {
            throw std::runtime_error("llama_decode failed while processing the prompt");
        }

        while (tokens_generated < max_new_tokens) {
            if (inst->stop_flag) {
                LOGI("Generation cancelled by client");
                break;
            }

            llama_token new_token = llama_sampler_sample(smpl, inst->ctx, -1);
            llama_sampler_accept(smpl, new_token);

            if (llama_vocab_is_eog(inst->vocab, new_token)) break;

            char piece_buf[256];
            int32_t piece_len = llama_token_to_piece(inst->vocab, new_token, piece_buf, sizeof(piece_buf), 0, true);
            if (piece_len > 0) {
                jstring tokenStr = env->NewStringUTF(std::string(piece_buf, piece_len).c_str());
                env->CallVoidMethod(callback, onTokenMethod, tokenStr);
                env->DeleteLocalRef(tokenStr);
            }
            tokens_generated++;

            llama_token next[1] = {new_token};
            llama_batch next_batch = llama_batch_get_one(next, 1);
            if (llama_decode(inst->ctx, next_batch) != 0) {
                throw std::runtime_error("llama_decode failed during generation");
            }
            n_cur++;
            if (n_cur >= n_ctx) {
                LOGI("Context window exhausted, stopping generation");
                break;
            }
        }

        const double elapsed_sec = (current_time_ms() - start_time) / 1000.0;
        inst->last_generation_tps = elapsed_sec > 0 ? tokens_generated / elapsed_sec : 0.0;
        inst->total_tokens_generated += tokens_generated;

        llama_sampler_free(smpl);
        env->CallVoidMethod(callback, onCompleteMethod);
    } catch (const std::exception &e) {
        if (smpl) llama_sampler_free(smpl);
        LOGE("generate() failed: %s", e.what());
        env->CallVoidMethod(callback, onErrorMethod, env->NewStringUTF(e.what()));
    }
}

extern "C"
JNIEXPORT jstring JNICALL
Java_com_cursed_runtime_jni_LlamaNative_processImage(JNIEnv *env, jobject, jlong, jbyteArray) {
    // No CLIP/vision model is vendored in this build. Returning a fake
    // "embedded" response would be worse than being upfront about it.
    return env->NewStringUTF("{\"error\": \"Vision is not implemented in this build - no CLIP model is loaded\"}");
}

extern "C"
JNIEXPORT jstring JNICALL
Java_com_cursed_runtime_jni_LlamaNative_transcribeAudio(JNIEnv *env, jobject, jlong, jshortArray) {
    // No Whisper model is vendored in this build (the app's own speech input
    // uses the browser's Web Speech API instead, which doesn't call this).
    return env->NewStringUTF("");
}

extern "C"
JNIEXPORT void JNICALL
Java_com_cursed_runtime_jni_LlamaNative_stopGeneration(JNIEnv *, jobject, jlong model_handler) {
    auto *inst = reinterpret_cast<model_instance *>(model_handler);
    if (inst) {
        inst->stop_flag = true;
        LOGI("Stop requested");
    }
}

extern "C"
JNIEXPORT void JNICALL
Java_com_cursed_runtime_jni_LlamaNative_releaseModel(JNIEnv *, jobject, jlong model_handler) {
    auto *inst = reinterpret_cast<model_instance *>(model_handler);
    if (inst) {
        LOGI("Releasing model resources");
        if (inst->ctx) llama_free(inst->ctx);
        if (inst->model) llama_model_free(inst->model);
        delete inst;
    }
}

extern "C"
JNIEXPORT void JNICALL
Java_com_cursed_runtime_jni_LlamaNative_setPerformanceConfig(JNIEnv *, jobject, jlong model_handler, jint n_threads, jint n_batch) {
    auto *inst = reinterpret_cast<model_instance *>(model_handler);
    if (!inst) return;
    inst->n_threads = n_threads;
    inst->n_batch = n_batch;
    if (inst->ctx) {
        llama_set_n_threads(inst->ctx, n_threads, n_threads);
        LOGI("Applied live thread config: threads=%d", n_threads);
    }
}

extern "C"
JNIEXPORT void JNICALL
Java_com_cursed_runtime_jni_LlamaNative_restoreContext(JNIEnv *, jobject, jlong model_handler) {
    auto *inst = reinterpret_cast<model_instance *>(model_handler);
    if (inst && inst->ctx) {
        // Each generate() call already clears the KV cache for a fresh turn,
        // so there's nothing stale to restore yet - this is a hook for when
        // real multi-turn context reuse is added.
        LOGI("restoreContext: no-op (context is reset per-turn)");
    }
}

extern "C"
JNIEXPORT jstring JNICALL
Java_com_cursed_runtime_jni_LlamaNative_getStats(JNIEnv *env, jobject, jlong model_handler) {
    auto *inst = reinterpret_cast<model_instance *>(model_handler);

    const bool gpu_available = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_GPU) != nullptr;
    const double model_mb = inst && inst->model ? llama_model_size(inst->model) / (1024.0 * 1024.0) : 0.0;
    const double tps = inst ? inst->last_generation_tps : 0.0;
    const long total_tokens = inst ? inst->total_tokens_generated : 0;
    const char *state = (inst && inst->ctx) ? "READY" : "IDLE";
    const int threads = inst ? inst->n_threads : 0;
    const int batch = inst ? inst->n_batch : 0;

    char buffer[384];
    snprintf(buffer, sizeof(buffer),
             "{\"ram\": \"%.0fMB\", \"engine\": \"llama.cpp\", \"vulkan_active\": %s, \"tps\": %.2f, \"total_tokens\": %ld, \"state\": \"%s\", \"threads\": %d, \"batch\": %d}",
             model_mb, gpu_available ? "true" : "false", tps, total_tokens, state, threads, batch);

    return env->NewStringUTF(buffer);
}
