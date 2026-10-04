package com.cursed.runtime.api

import com.cursed.runtime.jni.LlamaNative
import com.cursed.runtime.inference.ModelManager
import com.cursed.runtime.inference.MultimodalManager
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.http.content.*
import io.ktor.server.routing.*
import io.ktor.util.AttributeKey
import io.ktor.utils.io.*
import android.content.Context
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.fromFilePath
import java.io.File
import java.io.InputStream
import kotlinx.coroutines.channels.Channel
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.contentOrNull

@Serializable
data class GenerationOptions(
    val temperature: Float? = null,
    val topP: Float? = null,
    val maxTokens: Int? = null,
    // Accepted for parity with the web client's request shape; Android has no
    // memory/RAG implementation yet (see the /api/memory stub below), so this
    // is currently unused rather than silently ignored-and-crashing on a type
    // mismatch (this field used to break deserialization of the old
    // Map<String, Float> options shape, since it's a Boolean, not a Float).
    val memoryEnabled: Boolean? = null
)

@Serializable
data class ChatRequest(
    val prompt: String,
    val messages: List<Message>? = null,
    val model: String? = null,
    val options: GenerationOptions? = null,
    val gpu_layers: Int? = null,
    val images: List<String>? = null // Base64 encoded images
)

@Serializable
data class Message(val role: String, val content: String, val images: List<String>? = null)

@Serializable
data class TokenResponse(val token: String? = null, val error: String? = null, val vision_status: String? = null)

@Serializable
data class MemoryEntry(val text: String, val timestamp: Long)

// kotlinx.serialization needs a concrete type to derive a serializer for -
// a raw mapOf(...) with mixed value types (String, String?, List<String>,
// Double, Int...) compiles fine as Map<String, Any?> but fails at runtime
// with no serializer found, which Ktor turns into an empty-body 500. Same
// response shape as the desktop server's /api/models and /api/stats.
@Serializable
data class ModelsResponse(val storage: String, val active: String?, val available: List<String>)

@Serializable
data class RamStats(val heapUsed: String)

@Serializable
data class ModelStats(val active: String?, val status: String)

@Serializable
data class EngineStats(val tps: Double, val totalTokens: Long, val threads: Int, val batch: Int)

@Serializable
data class StatsResponse(
    val ram: RamStats,
    val model: ModelStats,
    val engine: EngineStats,
    val performanceMode: String,
    val thermalState: String,
    val localAddress: String
)

// Real, file-backed memory store (no embeddings/semantic search yet - unlike
// the desktop server's MiniLM+cosine-similarity RAG, this just persists and
// lists entries verbatim). Real, not a lie about doing more than it does.
private class MemoryStore(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true }
    private val entries = mutableListOf<MemoryEntry>()

    init {
        if (file.exists()) {
            try {
                entries.addAll(json.decodeFromString<List<MemoryEntry>>(file.readText()))
            } catch (e: Exception) {
                android.util.Log.e("MemoryStore", "Failed to load memory file", e)
            }
        }
    }

    @Synchronized
    fun add(text: String) {
        entries.add(MemoryEntry(text, System.currentTimeMillis()))
        persist()
    }

    @Synchronized
    fun list(): List<MemoryEntry> = entries.toList()

    @Synchronized
    fun clear() {
        entries.clear()
        persist()
    }

    private fun persist() {
        file.writeText(json.encodeToString(entries.toList()))
    }
}

class ApiServer(private val context: Context, private val port: Int = 11434) {
    private var engine: NettyApplicationEngine? = null
    private val memoryStore = MemoryStore(File(context.filesDir, "memory.json"))
    private val modelsDir get() = ModelManager.modelsDir

    fun start() {
        try {
            startInternal()
            android.util.Log.i("ApiServer", "Started successfully on 127.0.0.1:$port")
        } catch (e: Throwable) {
            android.util.Log.e("ApiServer", "FAILED to start on port $port", e)
        }
    }

    private fun startInternal() {
        engine = embeddedServer(Netty, port = port, host = "127.0.0.1") {
            install(ContentNegotiation) {
                json(Json { prettyPrint = true; isLenient = true; ignoreUnknownKeys = true })
            }
            routing {
                get("/{path...}") {
                    val path = call.parameters.getAll("path")?.joinToString("/") ?: "index.html"
                    val assetPath = "www/$path"

                    try {
                        val inputStream: InputStream = this@ApiServer.context.assets.open(assetPath)
                        val bytes = inputStream.readBytes()
                        val contentType = ContentType.fromFilePath(path).firstOrNull() ?: ContentType.Application.OctetStream
                        call.respondBytes(bytes, contentType)
                    } catch (e: Exception) {
                        if (path == "index.html" || !path.contains(".")) {
                            try {
                                val indexStream = this@ApiServer.context.assets.open("www/index.html")
                                call.respondBytes(indexStream.readBytes(), ContentType.Text.Html)
                            } catch (ex: Exception) {
                                call.respond(HttpStatusCode.NotFound, "Not Found")
                            }
                        } else {
                            call.respond(HttpStatusCode.NotFound, "Not Found")
                        }
                    }
                }

                post("/api/chat") {
                    val request = call.receive<ChatRequest>()

                    if (ModelManager.currentState == ModelManager.EngineState.BUSY) {
                        call.respond(io.ktor.http.HttpStatusCode.TooManyRequests, mapOf("error" to "Engine is busy"))
                        return@post
                    }

                    val channel = Channel<String>(Channel.UNLIMITED)

                    val handler = try {
                        ModelManager.getOrLoadModel(
                            request.model ?: "phi-3-mini",
                            request.gpu_layers ?: 32
                        )
                    } catch (e: Exception) {
                        call.respond(io.ktor.http.HttpStatusCode.InternalServerError, mapOf("error" to e.message))
                        return@post
                    }

                    ModelManager.setBusy(true)

                    // Report the real vision result instead of always claiming success -
                    // there's no CLIP model vendored yet, so this currently always reports
                    // "not implemented" rather than silently pretending it worked.
                    request.images?.firstOrNull()?.let { b64 ->
                        val result = MultimodalManager.processVisionInput(handler, b64)
                        val status = if (result.contains("\"error\"")) result else "Image embedded into context"
                        channel.trySend(Json.encodeToString(TokenResponse(vision_status = status)))
                    }

                    // Register cancellation
                    val closeKey = AttributeKey<() -> Unit>("onClose")
                    if (!call.attributes.contains(closeKey)) {
                        call.attributes.put(closeKey, { ModelManager.stopCurrentInference() })
                    }

                    val callback = object : LlamaNative.ModelCallback {
                        override fun onToken(token: String) {
                            channel.trySend(Json.encodeToString(TokenResponse(token = token)))
                        }
                        override fun onComplete() {
                            channel.trySend("[DONE]")
                            channel.close()
                            ModelManager.setBusy(false)
                        }
                        override fun onError(message: String) {
                            channel.trySend(Json.encodeToString(TokenResponse(error = message)))
                            channel.close()
                            ModelManager.setBusy(false)
                        }
                    }

                    Thread {
                        try {
                            LlamaNative.generate(
                                handler,
                                request.prompt,
                                request.options?.temperature ?: 0f,
                                request.options?.topP ?: 0f,
                                request.options?.maxTokens ?: 0,
                                callback
                            )
                        } catch (e: Exception) {
                            callback.onError(e.message ?: "Native generation failed")
                        }
                    }.start()

                    call.respondTextWriter(contentType = io.ktor.http.ContentType.Text.EventStream) {
                        try {
                            for (item in channel) {
                                if (item == "[DONE]") {
                                    write("data: [DONE]\n\n")
                                } else {
                                    write("data: $item\n\n")
                                }
                                flush()
                            }
                        } catch (e: Exception) {
                            ModelManager.stopCurrentInference()
                            ModelManager.setBusy(false)
                        }
                    }
                }

                post("/api/speech/transcribe") {
                    // Expecting multi-part or raw short array (simplified for mock)
                    val handler = try {
                        ModelManager.getOrLoadModel("whisper-tiny")
                    } catch (e: Exception) {
                        call.respond(io.ktor.http.HttpStatusCode.InternalServerError, mapOf("error" to e.message))
                        return@post
                    }
                    val text = MultimodalManager.handleVoiceTranscription(handler, shortArrayOf(0))
                    call.respond<Map<String, String>>(mapOf("text" to text))
                }

                post("/api/load") {
                    val request = call.receive<ChatRequest>()
                    try {
                        ModelManager.getOrLoadModel(
                            request.model ?: "phi-3-mini",
                            request.gpu_layers ?: 32
                        )
                        call.respond(mapOf("status" to "success", "state" to ModelManager.currentState.name))
                    } catch (e: Exception) {
                        call.respond(io.ktor.http.HttpStatusCode.InternalServerError, mapOf("error" to e.message))
                    }
                }

                get("/api/memory") {
                    call.respond(memoryStore.list())
                }

                post("/api/memory") {
                    val request = call.receive<Map<String, String>>()
                    val text = request["text"] ?: ""
                    if (text.isBlank()) {
                        call.respond(HttpStatusCode.BadRequest, mapOf("error" to "text is required"))
                        return@post
                    }
                    memoryStore.add(text)
                    call.respond(mapOf("status" to "success", "count" to memoryStore.list().size.toString()))
                }

                delete("/api/memory") {
                    memoryStore.clear()
                    call.respond(mapOf("status" to "success"))
                }

                get("/api/models") {
                    try {
                        val dir = File(modelsDir)
                        val available = if (dir.exists()) dir.listFiles { f -> f.extension == "gguf" }?.map { it.name } ?: emptyList()
                                        else emptyList()
                        call.respond(ModelsResponse(
                            storage = modelsDir,
                            active = ModelManager.getActiveModel(),
                            available = available
                        ))
                    } catch (e: Throwable) {
                        android.util.Log.e("ApiServer", "/api/models failed", e)
                        call.respond(HttpStatusCode.InternalServerError, mapOf("error" to (e.message ?: e.toString())))
                    }
                }

                post("/api/mode") {
                    val request = call.receive<Map<String, String>>()
                    val modeStr = request["mode"] ?: "BALANCED"
                    try {
                        val mode = ModelManager.PerformanceMode.valueOf(modeStr)
                        ModelManager.setPerformanceMode(mode)
                        call.respond(mapOf("status" to "success", "mode" to ModelManager.currentPerformanceMode.name))
                    } catch (e: Exception) {
                        call.respond(io.ktor.http.HttpStatusCode.BadRequest, mapOf("error" to "Invalid mode"))
                    }
                }

                get("/api/stats") {
                    // Same response shape as the desktop server's /api/stats -
                    // both share one React UI, so the shapes have to match or
                    // the Engine tab silently shows placeholder dashes again.
                    try {
                        val handler = ModelManager.modelHandler
                        val native = Json.parseToJsonElement(LlamaNative.getStats(handler)).jsonObject

                        call.respond(StatsResponse(
                            ram = RamStats(heapUsed = native["ram"]?.jsonPrimitive?.contentOrNull ?: "---"),
                            model = ModelStats(
                                active = ModelManager.getActiveModel(),
                                status = if (ModelManager.currentState == ModelManager.EngineState.BUSY) "busy" else "idle"
                            ),
                            engine = EngineStats(
                                tps = native["tps"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                                totalTokens = native["total_tokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                                threads = native["threads"]?.jsonPrimitive?.intOrNull ?: 0,
                                batch = native["batch"]?.jsonPrimitive?.intOrNull ?: 0
                            ),
                            performanceMode = ModelManager.currentPerformanceMode.name,
                            thermalState = ModelManager.thermalState.name,
                            localAddress = "http://127.0.0.1:$port/api/*"
                        ))
                    } catch (e: Throwable) {
                        android.util.Log.e("ApiServer", "/api/stats failed", e)
                        call.respond(HttpStatusCode.InternalServerError, mapOf("error" to (e.message ?: e.toString())))
                    }
                }
            }
        }.start(wait = false)
    }

    fun stop() {
        engine?.stop(1000, 5000)
    }
}
