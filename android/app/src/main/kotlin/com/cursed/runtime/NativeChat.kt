package com.cursed.runtime

import android.app.AlertDialog
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** A model the chat can use: on the PC (by its id there, e.g. "ollama:qwen3:8b") or on this phone (a GGUF file name). */
data class ChatModel(val id: String, val name: String, val onPhone: Boolean, val note: String = "")

/**
 * The native chat screen. Answers come from a model on the PC (the studio's own engine, Ollama, LM Studio or an online
 * model set up there) or from the small engine on this phone; the person picks which. The conversation is kept on the
 * phone (one chat at a time, "New chat" starts over).
 *
 * `pcBase` is the connected PC's address (null when there is none), `openPc` opens a request to it with the access
 * code and the PC's pinned certificate, and `startPhoneEngine` starts the on-phone engine (http://127.0.0.1:11434).
 */
class NativeChat(
    private val ctx: Context,
    private val prefs: SharedPreferences,
    private val pcBase: () -> String?,
    private val openPc: (String) -> HttpURLConnection,
    private val startPhoneEngine: () -> Unit,
) {
    private val ui = Handler(Looper.getMainLooper())
    private val messages = JSONArray(prefs.getString("chat_messages", "[]"))
    private var model: ChatModel? = prefs.getString("chat_model", null)?.let { JSONObject(it) }?.let { ChatModel(it.getString("id"), it.getString("name"), it.getBoolean("onPhone")) }
    private var live: HttpURLConnection? = null
    private var busy = false

    private lateinit var list: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private lateinit var send: Button
    private lateinit var modelBtn: Button

    private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()
    private fun round(color: String, r: Int) = GradientDrawable().apply { setColor(Color.parseColor(color)); cornerRadius = dp(r).toFloat() }

    fun view(): View {
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#0E0E10")) }

        // Top bar: which model answers, and a new chat.
        val bar = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10)) }
        modelBtn = Button(ctx).apply {
            isAllCaps = false; textSize = 13f; setTextColor(Color.WHITE); background = round("#27272A", 18); setPadding(dp(14), 0, dp(14), 0)
            setOnClickListener { pickModel() }
        }
        bar.addView(modelBtn, LinearLayout.LayoutParams(0, dp(38), 1f))
        bar.addView(Button(ctx).apply {
            text = "New chat"; isAllCaps = false; textSize = 13f; setTextColor(Color.parseColor("#D4D4D8")); background = round("#18181B", 18)
            setOnClickListener { if (!busy) { while (messages.length() > 0) messages.remove(0); save(); render() } }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(38)).apply { leftMargin = dp(8) })
        col.addView(bar)

        list = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(4), dp(12), dp(12)) }
        scroll = ScrollView(ctx).apply { addView(list); isFillViewport = true }
        col.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        // Message box and send / stop.
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM; setPadding(dp(10), dp(8), dp(10), dp(10)) }
        input = EditText(ctx).apply {
            hint = "Message"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            maxLines = 6; textSize = 15f; setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#71717A"))
            background = round("#18181B", 20); setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        row.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        send = Button(ctx).apply {
            isAllCaps = false; textSize = 14f; setTextColor(Color.WHITE)
            setOnClickListener { if (busy) stop() else sendMessage() }
        }
        row.addView(send, LinearLayout.LayoutParams(dp(76), dp(46)).apply { leftMargin = dp(8) })
        col.addView(row)

        render()
        return col
    }

    private fun save() {
        prefs.edit().putString("chat_messages", messages.toString())
            .putString("chat_model", model?.let { JSONObject().put("id", it.id).put("name", it.name).put("onPhone", it.onPhone).toString() }).apply()
    }

    private fun render() {
        modelBtn.text = model?.let { "${it.name}  ·  ${if (it.onPhone) "on this phone" else "on your PC"}  ▾" } ?: "Choose a model  ▾"
        send.text = if (busy) "Stop" else "Send"
        send.background = round(if (busy) "#DC2626" else "#7C3AED", 20)
        list.removeAllViews()
        if (messages.length() == 0) list.addView(TextView(ctx).apply {
            text = if (model == null) "Choose a model at the top: one on your PC (faster, bigger) or one on this phone (works without the PC)." else "Ask anything."
            setTextColor(Color.parseColor("#71717A")); textSize = 14f; gravity = Gravity.CENTER; setPadding(dp(16), dp(80), dp(16), 0)
        })
        for (i in 0 until messages.length()) list.addView(bubble(messages.getJSONObject(i)))
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    /** Streams into the last bubble without redrawing the whole conversation. */
    private fun showLast(text: String) {
        ((list.getChildAt(list.childCount - 1) as? LinearLayout)?.getChildAt(0) as? TextView)?.text = text
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun bubble(m: JSONObject): View {
        val mine = m.getString("role") == "user"
        val t = TextView(ctx).apply {
            text = m.getString("content").ifEmpty { "..." }; textSize = 15f; setTextIsSelectable(true)
            setTextColor(Color.parseColor(if (m.optBoolean("error")) "#FCA5A5" else "#F4F4F5"))
            background = round(if (mine) "#5B21B6" else "#1F1F23", 16); setPadding(dp(14), dp(10), dp(14), dp(10))
            setLineSpacing(0f, 1.15f)
        }
        return LinearLayout(ctx).apply {
            gravity = if (mine) Gravity.END else Gravity.START; setPadding(if (mine) dp(48) else 0, dp(6), if (mine) 0 else dp(48), 0)
            addView(t, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
    }

    /** Lists the PC's models and the phone's, then lets the person pick one. */
    private fun pickModel() {
        modelBtn.text = "Looking for models..."
        thread {
            val pc = try { pcModels() } catch (e: Exception) { null }
            val phone = try { phoneModels() } catch (e: Exception) { emptyList() }
            ui.post {
                render()
                val items = mutableListOf<ChatModel?>()
                val labels = mutableListOf<String>()
                fun group(title: String, ms: List<ChatModel>, empty: String) {
                    items.add(null); labels.add(title)
                    if (ms.isEmpty()) { items.add(null); labels.add("    $empty") }
                    ms.forEach { items.add(it); labels.add("    ${it.name}${if (it.note.isNotEmpty()) "  (${it.note})" else ""}") }
                }
                group("ON YOUR PC", pc ?: emptyList(), if (pcBase() == null) "not connected to a PC" else if (pc == null) "the PC did not answer" else "no models found on the PC")
                group("ON THIS PHONE", phone, "no GGUF model on the phone yet")
                AlertDialog.Builder(ctx).setTitle("Which model answers?")
                    .setItems(labels.toTypedArray()) { _, i -> items[i]?.let { model = it; save(); render() } }
                    .setNegativeButton("Cancel", null).show()
            }
        }
    }

    private fun readJson(c: HttpURLConnection): String = c.inputStream.bufferedReader().use { it.readText() }.also { c.disconnect() }

    /** The PC's models, the same ones its chat lists: its own GGUF files, Ollama, LM Studio, Gemini and online providers. */
    private fun pcModels(): List<ChatModel>? {
        if (pcBase() == null) return null
        val out = mutableListOf<ChatModel>()
        val files = JSONObject(readJson(openPc("/api/models").apply { connectTimeout = 5000; readTimeout = 8000 }))
        val avail = files.optJSONArray("available") ?: JSONArray()
        val ext = try { JSONObject(readJson(openPc("/api/external-models").apply { connectTimeout = 5000; readTimeout = 8000 })) } catch (e: Exception) { JSONObject() }
        val ollamaUp = ext.optJSONObject("ollama")?.optBoolean("running") == true
        for (i in 0 until avail.length()) {
            val f = avail.getString(i)
            val d = files.optJSONObject("details")?.optJSONObject(f)
            if (ollamaUp && d?.optString("origin") == "ollama") continue
            val name = d?.optString("name")?.takeIf { it.isNotEmpty() } ?: f.removeSuffix(".gguf")
            if (name.contains("embed", true)) continue
            out.add(ChatModel(if (f.startsWith("@")) f else f.removeSuffix(".gguf"), name, false, "studio engine"))
        }
        for ((key, label) in listOf("ollama" to "Ollama", "lmstudio" to "LM Studio")) {
            val ms = ext.optJSONObject(key)?.optJSONArray("models") ?: continue
            for (i in 0 until ms.length()) out.add(ChatModel("$key:${ms.getString(i)}", ms.getString(i), false, label))
        }
        try {
            if (JSONObject(readJson(openPc("/api/gemini-key"))).optBoolean("set"))
                listOf("gemini-2.5-flash" to "Gemini 2.5 Flash", "gemini-2.5-pro" to "Gemini 2.5 Pro").forEach { (id, n) -> out.add(ChatModel("gemini:$id", n, false, "online")) }
            val provs = JSONObject(readJson(openPc("/api/online/providers"))).optJSONArray("providers") ?: JSONArray()
            for (i in 0 until provs.length()) {
                val p = provs.getJSONObject(i)
                if (!p.optBoolean("keySet") || !p.optBoolean("enabled")) continue
                val ms = p.optJSONArray("models") ?: continue
                for (j in 0 until ms.length()) out.add(ChatModel("online:${p.getString("id")}:${ms.getString(j)}", ms.getString(j), false, "${p.optString("label")}, online"))
            }
        } catch (e: Exception) { /* online models are optional */ }
        return out
    }

    /** GGUF files on the phone, from its own engine (started if needed). */
    private fun phoneModels(): List<ChatModel> {
        ui.post { startPhoneEngine() }
        val body = retry { readJson((URL("http://127.0.0.1:11434/api/models").openConnection() as HttpURLConnection).apply { connectTimeout = 2000; readTimeout = 5000 }) }
        val avail = JSONObject(body).optJSONArray("available") ?: JSONArray()
        return (0 until avail.length()).map { val f = avail.getString(it).removeSuffix(".gguf"); ChatModel(f, f, true) }
    }

    /** The phone's engine takes a few seconds to start; try again for a while. */
    private fun <T> retry(times: Int = 12, f: () -> T): T {
        var last: Exception? = null
        repeat(times) { try { return f() } catch (e: Exception) { last = e; Thread.sleep(700) } }
        throw last!!
    }

    private fun sendMessage() {
        val text = input.text.toString().trim()
        val m = model
        if (text.isEmpty()) return
        if (m == null) { pickModel(); return }
        input.setText("")
        messages.put(JSONObject().put("role", "user").put("content", text))
        val answer = JSONObject().put("role", "assistant").put("content", "")
        messages.put(answer)
        busy = true; save(); render()
        val history = JSONArray((0 until messages.length() - 1).map { messages.getJSONObject(it) }.filter { !it.optBoolean("error") }.map { JSONObject().put("role", it.getString("role")).put("content", it.getString("content")) })
        thread {
            try {
                val c = if (m.onPhone) {
                    ui.post { startPhoneEngine() }
                    // The phone's engine reads one prompt; the conversation is written out as a transcript.
                    val prompt = (0 until history.length()).joinToString("\n") { val h = history.getJSONObject(it); (if (h.getString("role") == "user") "User: " else "Assistant: ") + h.getString("content") } + "\nAssistant:"
                    retry { post(URL("http://127.0.0.1:11434/api/chat").openConnection() as HttpURLConnection, JSONObject().put("prompt", prompt).put("model", m.id)) }
                } else post(openPc("/api/chat"), JSONObject().put("messages", history).put("model", m.id).put("options", JSONObject()))
                live = c
                if (c.responseCode >= 400) throw Exception(c.errorStream?.bufferedReader()?.readText()?.let { runCatching { JSONObject(it).optString("error") }.getOrNull() ?: it } ?: "Error ${c.responseCode}")
                c.inputStream.bufferedReader().useLines { lines ->
                    for (line in lines) {
                        if (!line.startsWith("data: ")) continue
                        val data = line.removePrefix("data: ").trim()
                        if (data == "[DONE]") break
                        val j = runCatching { JSONObject(data) }.getOrNull() ?: continue
                        if (j.has("error") && !j.isNull("error")) throw Exception(j.getString("error"))
                        val tok = j.optString("token", "")
                        if (tok.isNotEmpty()) ui.post { answer.put("content", answer.getString("content") + tok); showLast(answer.getString("content")) }
                    }
                }
            } catch (e: Exception) {
                if (busy) ui.post { if (answer.getString("content").isEmpty()) answer.put("content", e.message ?: "Something went wrong.").put("error", true) }
            } finally {
                ui.post { busy = false; live = null; save(); render() }
            }
        }
    }

    private fun post(c: HttpURLConnection, body: JSONObject): HttpURLConnection = c.apply {
        requestMethod = "POST"; doOutput = true; connectTimeout = 5000; readTimeout = 0
        setRequestProperty("Content-Type", "application/json")
        outputStream.use { it.write(body.toString().toByteArray()) }
    }

    /** Closing the request stops the answer (both engines stop when the reader goes away). */
    private fun stop() {
        busy = false
        thread { live?.disconnect() }
        render()
    }
}
