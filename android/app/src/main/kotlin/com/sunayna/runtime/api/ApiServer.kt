package com.sunayna.runtime.api

import com.sunayna.runtime.jni.LlamaNative
import com.sunayna.runtime.inference.ModelManager
import com.sunayna.runtime.inference.MultimodalManager
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
import java.io.InputStream
import kotlinx.coroutines.channels.Channel
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString

@Serializable
data class ChatRequest(
    val prompt: String,
    val messages: List<Message>? = null,
    val model: String? = null,
    val options: Map<String, Float>? = null,
    val gpu_layers: Int? = null,
    val images: List<String>? = null // Base64 encoded images
)

@Serializable
data class Message(val role: String, val content: String, val images: List<String>? = null)

@Serializable
data class TokenResponse(val token: String? = null, val error: String? = null, val vision_status: String? = null)

class ApiServer(private val context: Context, private val port: Int = 11434) {
    private var engine: NettyApplicationEngine? = null

    fun start() {
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

                    // Phase 10: Process images before generation if present
                    request.images?.firstOrNull()?.let { b64 ->
                        val result = MultimodalManager.processVisionInput(handler, b64)
                        channel.trySend(Json.encodeToString(TokenResponse(vision_status = "Image embedded into context")))
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
                            LlamaNative.generate(handler, request.prompt, "{}", callback)
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
                    // Return list of memories (mock for now)
                    call.respond(listOf<String>())
                }

                post("/api/memory") {
                    val request = call.receive<Map<String, String>>()
                    val text = request["text"] ?: ""
                    // Save memory...
                    call.respond(mapOf("status" to "success"))
                }

                get("/api/models") {
                    call.respond(mapOf(
                        "storage" to "/sdcard/Sunayna/models",
                        "active" to ModelManager.getActiveModel(),
                        "available" to listOf("phi-3-mini.gguf", "mistral-7b.gguf")
                    ))
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
                    val handler = ModelManager.modelHandler
                    val nativeStatsStr = LlamaNative.getStats(handler)
                    val nativeStats = Json.parseToJsonElement(nativeStatsStr)
                    call.respond(mapOf(
                        "native" to nativeStats,
                        "engine_state" to ModelManager.currentState.name,
                        "performance_mode" to ModelManager.currentPerformanceMode.name,
                        "thermal_state" to ModelManager.thermalState.name,
                        "active_model" to ModelManager.getActiveModel()
                    ))
                }
            }
        }.start(wait = false)
    }

    fun stop() {
        engine?.stop(1000, 5000)
    }
}
