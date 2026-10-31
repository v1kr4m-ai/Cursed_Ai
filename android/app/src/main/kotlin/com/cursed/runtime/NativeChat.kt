package com.cursed.runtime

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Calendar
import kotlin.concurrent.thread

/** A model the chat can use: on the PC (by its id there, e.g. "ollama:qwen3:8b") or on this phone (a GGUF file name). */
data class ChatModel(val id: String, val name: String, val onPhone: Boolean, val note: String = "")

/**
 * The native chat screen. Answers come from a model on the PC (the studio's own engine, Ollama, LM Studio or an online
 * model set up there) or from the small engine on this phone; the person picks which.
 *
 *  - History works like ChatGPT's: ☰ slides in the list of chats (search, grouped Today / Yesterday / earlier, long
 *    press to rename or delete), ✎ starts a new chat. Chats are kept in a file on the phone, each with its model.
 *  - 📎 attaches photos and documents: text files are read on the phone, PDF and Word by the PC; photos go to PC
 *    models that can see pictures (the phone's engine reads text only).
 *  - 🎧 is the voice assistant, hands-free like the desktop one: it listens, answers with this chat's model, reads the
 *    answer aloud and listens again, until it is closed.
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
    private val openSettings: () -> Unit,
    /** Opens the phone's file picker for several files. */
    private val pickFiles: ((List<Uri>) -> Unit) -> Unit,
    /** Asks for the microphone if needed; true when it may be used. */
    private val askMic: ((Boolean) -> Unit) -> Unit,
) {
    private val ui = Handler(Looper.getMainLooper())
    private val store = File(ctx.filesDir, "chats.json")

    /** All saved chats ({id, title?, updated, model, messages}); `messages` is the open one's list. */
    private val chats: JSONArray = runCatching { JSONArray(store.readText()) }.getOrNull()
        ?: prefs.getString("chats", null)?.let { JSONArray(it) } // kept in the settings before there was a file
        ?: JSONArray()
    private var current: JSONObject = run {
        val id = prefs.getString("chat_current", null)
        all().firstOrNull { it.optString("id") == id } ?: newChat()
    }
    private val messages: JSONArray get() = current.getJSONArray("messages")
    private fun all() = (0 until chats.length()).map { chats.getJSONObject(it) }
    private fun newChat(): JSONObject = JSONObject().put("id", "c" + System.currentTimeMillis()).put("updated", System.currentTimeMillis()).put("messages", JSONArray()).also { chats.put(it) }
    private fun titleOf(c: JSONObject): String {
        c.optString("title").takeIf { it.isNotBlank() }?.let { return it }
        val ms = c.getJSONArray("messages")
        val first = (0 until ms.length()).map { ms.getJSONObject(it) }.firstOrNull { it.optString("role") == "user" }?.optString("content")?.trim()
        return first?.replace(Regex("\\s+"), " ")?.take(48)?.ifEmpty { null } ?: "New chat"
    }
    private var model: ChatModel? = prefs.getString("chat_model", null)?.let { JSONObject(it) }?.let { ChatModel(it.getString("id"), it.getString("name"), it.getBoolean("onPhone")) }
    private var live: HttpURLConnection? = null
    private var busy = false

    /** Files waiting to go with the next message: {name, kind: image|doc, data (image data URL) | text}. */
    private val pending = mutableListOf<JSONObject>()

    private lateinit var root: FrameLayout
    private lateinit var list: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private lateinit var send: Button
    private lateinit var modelBtn: Button
    private lateinit var status: TextView
    private lateinit var chips: LinearLayout
    private lateinit var drawer: LinearLayout
    private lateinit var scrim: View
    private lateinit var drawerList: LinearLayout
    private lateinit var search: EditText
    private lateinit var speakRow: TextView

    // ------------------------------------------------------------------ look

    private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()
    private fun round(color: String, r: Int) = GradientDrawable().apply { setColor(Color.parseColor(color)); cornerRadius = dp(r).toFloat() }
    private fun iconBtn(icon: String, desc: String, onClick: () -> Unit) = Button(ctx).apply {
        text = icon; textSize = 16f; setTextColor(Color.parseColor("#D4D4D8")); background = round("#18181B", 18); contentDescription = desc
        setPadding(0, 0, 0, 0); setOnClickListener { onClick() }
    }
    private fun toast(t: String) = Toast.makeText(ctx, t, Toast.LENGTH_LONG).show()

    // ---------------------------------------------------------- read aloud

    /** Spoken replies: the phone's own text-to-speech reads each finished answer (always on in the assistant). */
    private var speak = prefs.getBoolean("chat_speak", false)
    private var tts: TextToSpeech? = null
    private fun say(text: String, force: Boolean = false, then: (() -> Unit)? = null) {
        if ((!speak && !force) || text.isBlank()) { then?.invoke(); return }
        val clean = text.replace(Regex("<think>[\\s\\S]*?</think>"), "").replace(Regex("[*#`_>|]"), "").take(3900)
        val go = { t: TextToSpeech ->
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) { ui.post { if (assistant == null) setStatus("Speaking...") else assistantState("Speaking...") } }
                override fun onDone(id: String?) { ui.post { if (assistant == null) setStatus(""); then?.invoke() } }
                @Deprecated("Deprecated in Java") override fun onError(id: String?) { ui.post { setStatus(""); then?.invoke() } }
            })
            t.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "reply")
        }
        tts?.let { go(it); return }
        var made: TextToSpeech? = null
        made = TextToSpeech(ctx) { ok -> if (ok == TextToSpeech.SUCCESS) { tts = made; go(made!!) } else then?.invoke() }
    }

    /** The line above the message box: waiting for the model, replying, speaking. */
    private fun setStatus(t: String) { status.text = t; status.visibility = if (t.isEmpty()) View.GONE else View.VISIBLE }

    // ---------------------------------------------------------------- screen

    fun view(): View {
        root = FrameLayout(ctx)
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#0E0E10")) }

        // Top bar: chats, which model answers, new chat, assistant.
        val bar = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(10), dp(10), dp(10), dp(10)) }
        bar.addView(iconBtn("☰", "Chats") { if (!busy) openDrawer() }, LinearLayout.LayoutParams(dp(44), dp(40)))
        modelBtn = Button(ctx).apply {
            isAllCaps = false; textSize = 13f; setTextColor(Color.WHITE); background = round("#27272A", 20); setPadding(dp(12), 0, dp(12), 0)
            isSingleLine = true; ellipsize = android.text.TextUtils.TruncateAt.END
            setOnClickListener { pickModel() }
        }
        bar.addView(modelBtn, LinearLayout.LayoutParams(0, dp(40), 1f).apply { leftMargin = dp(8); rightMargin = dp(8) })
        bar.addView(iconBtn("✎", "New chat") { if (!busy) startNew() }, LinearLayout.LayoutParams(dp(44), dp(40)))
        bar.addView(iconBtn("🎧", "Voice assistant") { if (!busy) openAssistant() }, LinearLayout.LayoutParams(dp(44), dp(40)).apply { leftMargin = dp(8) })
        col.addView(bar)

        list = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(4), dp(12), dp(12)) }
        scroll = ScrollView(ctx).apply { addView(list); isFillViewport = true }
        col.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        status = TextView(ctx).apply { textSize = 12f; setTextColor(Color.parseColor("#A78BFA")); setPadding(dp(16), dp(4), dp(16), 0); visibility = View.GONE }
        col.addView(status)

        // Files waiting to be sent.
        chips = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(10), dp(6), dp(10), 0) }
        col.addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(chips) })

        // Message box: attach, text, talk, send / stop.
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM; setPadding(dp(8), dp(8), dp(8), dp(10)) }
        row.addView(iconBtn("📎", "Attach photos or documents") { if (!busy) pickFiles { attach(it) } }, LinearLayout.LayoutParams(dp(44), dp(46)).apply { rightMargin = dp(6) })
        input = EditText(ctx).apply {
            hint = "Message"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            maxLines = 6; textSize = 15f; setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#71717A"))
            background = round("#18181B", 22); setPadding(dp(14), dp(11), dp(14), dp(11))
        }
        row.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(iconBtn("🎤", "Dictate") { if (!busy) dictate() }, LinearLayout.LayoutParams(dp(44), dp(46)).apply { leftMargin = dp(6) })
        send = Button(ctx).apply {
            isAllCaps = false; textSize = 14f; setTextColor(Color.WHITE)
            setOnClickListener { if (busy) stop() else sendMessage() }
        }
        row.addView(send, LinearLayout.LayoutParams(dp(68), dp(46)).apply { leftMargin = dp(6) })
        col.addView(row)
        root.addView(col)

        buildDrawer()
        render()
        return root
    }

    private fun save() {
        model?.let { current.put("model", JSONObject().put("id", it.id).put("name", it.name).put("onPhone", it.onPhone)) }
        // Empty chats other than the open one are not kept.
        for (i in chats.length() - 1 downTo 0) { val c = chats.getJSONObject(i); if (c !== current && c.getJSONArray("messages").length() == 0) chats.remove(i) }
        val text = chats.toString()
        thread { runCatching { File(store.path + ".tmp").apply { writeText(text) }.renameTo(store) } }
        prefs.edit().putString("chat_current", current.optString("id")).remove("chats").remove("chat_messages")
            .putString("chat_model", model?.let { JSONObject().put("id", it.id).put("name", it.name).put("onPhone", it.onPhone).toString() }).apply()
    }

    /** Called by Phone settings after a model is downloaded: answer with it from now on. */
    fun useModel(m: ChatModel) { model = m; save(); render() }

    private fun startNew() { if (messages.length() > 0) current = newChat(); pending.clear(); save(); render() }

    private fun render() {
        modelBtn.text = model?.let { "${it.name}  ·  ${if (it.onPhone) "phone" else "PC"}  ▾" } ?: "Choose a model  ▾"
        send.text = if (busy) "Stop" else "Send"
        send.background = round(if (busy) "#DC2626" else "#7C3AED", 22)
        list.removeAllViews()
        if (messages.length() == 0) list.addView(TextView(ctx).apply {
            text = if (model == null) "Choose a model at the top: one on your PC (faster, bigger) or one on this phone (works without the PC). Phone models can be downloaded in Settings."
                   else "Ask anything.\n\n📎 attach a photo or document  ·  🎤 dictate  ·  🎧 talk hands-free"
            setTextColor(Color.parseColor("#71717A")); textSize = 14f; gravity = Gravity.CENTER; setPadding(dp(16), dp(80), dp(16), 0)
        })
        for (i in 0 until messages.length()) list.addView(bubble(messages.getJSONObject(i)))
        renderChips()
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    /** Streams into the last bubble without redrawing the whole conversation. */
    private fun showLast(text: String) {
        ((list.getChildAt(list.childCount - 1) as? LinearLayout)?.getChildAt(0) as? TextView)?.text = text
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun bubble(m: JSONObject): View {
        val mine = m.getString("role") == "user"
        val files = m.optJSONArray("files")
        val label = (0 until (files?.length() ?: 0)).joinToString("") { val f = files!!.getJSONObject(it); (if (f.optString("kind") == "image") "🖼 " else "📄 ") + f.optString("name") + "\n" }
        val t = TextView(ctx).apply {
            text = (label + m.getString("content")).trim().ifEmpty { "..." }; textSize = 15f; setTextIsSelectable(true)
            setTextColor(Color.parseColor(if (m.optBoolean("error")) "#FCA5A5" else "#F4F4F5"))
            background = round(if (mine) "#5B21B6" else "#1F1F23", 16); setPadding(dp(14), dp(10), dp(14), dp(10))
            setLineSpacing(0f, 1.15f)
        }
        return LinearLayout(ctx).apply {
            gravity = if (mine) Gravity.END else Gravity.START; setPadding(if (mine) dp(48) else 0, dp(6), if (mine) 0 else dp(48), 0)
            addView(t, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
    }

    // ---------------------------------------------------------- the drawer

    /** ChatGPT-like list of chats sliding in from the left. */
    private fun buildDrawer() {
        scrim = View(ctx).apply { setBackgroundColor(Color.parseColor("#99000000")); visibility = View.GONE; setOnClickListener { closeDrawer() } }
        root.addView(scrim, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val width = minOf(dp(320), (ctx.resources.displayMetrics.widthPixels * 0.85).toInt())
        drawer = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#141416")); visibility = View.GONE; isClickable = true; setPadding(dp(12), dp(14), dp(12), dp(10)) }
        drawer.addView(TextView(ctx).apply { text = "Cursed_Ai"; textSize = 18f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.WHITE); setPadding(dp(4), 0, 0, dp(10)) })
        drawer.addView(Button(ctx).apply {
            text = "✎   New chat"; isAllCaps = false; textSize = 14f; gravity = Gravity.CENTER_VERTICAL or Gravity.START; setTextColor(Color.WHITE); background = round("#27272A", 14); setPadding(dp(14), 0, dp(14), 0)
            setOnClickListener { startNew(); closeDrawer() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)))
        search = EditText(ctx).apply {
            hint = "Search chats"; textSize = 14f; setSingleLine(); setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#71717A"))
            background = round("#1C1C1F", 14); setPadding(dp(14), dp(9), dp(14), dp(9))
            addTextChangedListener(object : TextWatcher {
                override fun afterTextChanged(s: Editable?) { fillDrawer() }
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
        }
        drawer.addView(search, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        drawerList = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        drawer.addView(ScrollView(ctx).apply { addView(drawerList) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(6) })
        speakRow = TextView(ctx).apply {
            textSize = 14f; setTextColor(Color.parseColor("#D4D4D8")); setPadding(dp(10), dp(12), dp(10), dp(12))
            setOnClickListener { speak = !speak; prefs.edit().putBoolean("chat_speak", speak).apply(); if (!speak) tts?.stop(); fillDrawer() }
        }
        drawer.addView(speakRow)
        drawer.addView(TextView(ctx).apply {
            text = "⚙   Phone settings and models"; textSize = 14f; setTextColor(Color.parseColor("#D4D4D8")); setPadding(dp(10), dp(12), dp(10), dp(12))
            setOnClickListener { closeDrawer(); openSettings() }
        })
        root.addView(drawer, FrameLayout.LayoutParams(width, FrameLayout.LayoutParams.MATCH_PARENT))
    }

    private fun openDrawer() {
        save(); search.setText(""); fillDrawer()
        scrim.visibility = View.VISIBLE; drawer.visibility = View.VISIBLE
        drawer.translationX = -drawer.width.toFloat().coerceAtLeast(dp(320).toFloat())
        drawer.animate().translationX(0f).setDuration(180).start()
    }
    private fun closeDrawer() {
        drawer.animate().translationX(-drawer.width.toFloat()).setDuration(160).withEndAction { drawer.visibility = View.GONE; scrim.visibility = View.GONE }.start()
    }
    /** True when the drawer or the assistant was open and has been closed (for the Back button). */
    fun back(): Boolean {
        if (assistant != null) { closeAssistant(); return true }
        if (::drawer.isInitialized && drawer.visibility == View.VISIBLE) { closeDrawer(); return true }
        return false
    }

    private fun fillDrawer() {
        speakRow.text = if (speak) "🔊   Read answers aloud: on" else "🔈   Read answers aloud: off"
        drawerList.removeAllViews()
        val q = search.text.toString().trim().lowercase()
        val shown = all().filter { it.getJSONArray("messages").length() > 0 }
            .filter { c -> q.isEmpty() || titleOf(c).lowercase().contains(q) || c.getJSONArray("messages").toString().lowercase().contains(q) }
            .sortedByDescending { it.optLong("updated") }
        if (shown.isEmpty()) drawerList.addView(TextView(ctx).apply {
            text = if (q.isEmpty()) "No chats yet. Each conversation is kept here." else "No chat matches \"$q\"."
            textSize = 13f; setTextColor(Color.parseColor("#71717A")); setPadding(dp(10), dp(16), dp(10), 0)
        })
        val dayStart = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        val day = 24 * 3600 * 1000L
        fun group(t: Long) = when { t >= dayStart -> "Today"; t >= dayStart - day -> "Yesterday"; t >= dayStart - 7 * day -> "Previous 7 days"; t >= dayStart - 30 * day -> "Previous 30 days"; else -> "Older" }
        var last = ""
        for (c in shown) {
            val g = group(c.optLong("updated"))
            if (g != last) { last = g; drawerList.addView(TextView(ctx).apply { text = g; textSize = 11f; setTextColor(Color.parseColor("#71717A")); setTypeface(typeface, Typeface.BOLD); setPadding(dp(10), dp(14), dp(10), dp(4)) }) }
            val on = c === current
            drawerList.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(10), dp(9), dp(10), dp(9))
                background = round(if (on) "#27272A" else "#141416", 10)
                addView(TextView(ctx).apply { text = titleOf(c); textSize = 14f; setTextColor(Color.parseColor("#F4F4F5")); isSingleLine = true; ellipsize = android.text.TextUtils.TruncateAt.END })
                c.optJSONObject("model")?.optString("name")?.takeIf { it.isNotEmpty() }?.let { n -> addView(TextView(ctx).apply { text = n; textSize = 11f; setTextColor(Color.parseColor("#71717A")); isSingleLine = true }) }
                setOnClickListener { openChat(c); closeDrawer() }
                setOnLongClickListener { chatMenu(c); true }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(2) })
        }
    }

    private fun chatMenu(c: JSONObject) {
        AlertDialog.Builder(ctx).setTitle(titleOf(c)).setItems(arrayOf("Rename", "Delete")) { _, i ->
            if (i == 0) {
                val name = EditText(ctx).apply { setText(titleOf(c)); setSelectAllOnFocus(true) }
                AlertDialog.Builder(ctx).setTitle("Rename chat").setView(name)
                    .setPositiveButton("Save") { _, _ -> c.put("title", name.text.toString().trim().take(80)); save(); fillDrawer() }
                    .setNegativeButton("Cancel", null).show()
            } else AlertDialog.Builder(ctx).setTitle("Delete this chat?").setMessage(titleOf(c))
                .setPositiveButton("Delete") { _, _ ->
                    for (k in chats.length() - 1 downTo 0) if (chats.getJSONObject(k) === c) chats.remove(k)
                    if (c === current) current = newChat()
                    save(); render(); fillDrawer()
                }.setNegativeButton("Cancel", null).show()
        }.show()
    }

    private fun openChat(c: JSONObject) {
        current = c
        c.optJSONObject("model")?.let { model = ChatModel(it.getString("id"), it.getString("name"), it.getBoolean("onPhone")) }
        pending.clear(); save(); render()
    }

    // ------------------------------------------------------------ attachments

    private fun nameOf(uri: Uri): String {
        var n = "file"
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) n = it.getString(0) ?: n }
        return n
    }

    private val textExt = Regex("\\.(txt|md|csv|json|xml|html?|css|js|jsx|ts|tsx|py|java|kt|c|cpp|h|cs|go|rs|sh|sql|ya?ml|log|ini|toml|srt)$", RegexOption.IGNORE_CASE)
    private val maxDoc = 20000

    /** Reads picked files into `pending`: photos as small JPEGs, documents as text (PDF and Word through the PC). */
    private fun attach(uris: List<Uri>) {
        if (uris.isEmpty()) return
        setStatus("Reading ${uris.size} file${if (uris.size == 1) "" else "s"}...")
        thread {
            val notes = mutableListOf<String>()
            for (u in uris) {
                val name = nameOf(u)
                val type = ctx.contentResolver.getType(u) ?: ""
                try {
                    if (type.startsWith("image/")) {
                        val bytes = ctx.contentResolver.openInputStream(u)!!.use { it.readBytes() }
                        val b = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(bytes, 0, bytes.size, b)
                        var s = 1; while (b.outWidth / s > 1280 || b.outHeight / s > 1280) s *= 2
                        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = s }) ?: throw Exception("not a picture the phone can read")
                        val out = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }
                        val data = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                        ui.post { pending.add(JSONObject().put("name", name).put("kind", "image").put("data", data)) }
                    } else {
                        val text = if (type.startsWith("text/") || textExt.containsMatchIn(name)) ctx.contentResolver.openInputStream(u)!!.use { it.readBytes().toString(Charsets.UTF_8) }
                        else {
                            if (pcBase() == null) throw Exception("reading PDF, Word and other documents needs the PC connection (text files work without it)")
                            val c = openPc("/api/attachments/extract?name=" + URLEncoder.encode(name, "UTF-8")).apply {
                                requestMethod = "POST"; doOutput = true; connectTimeout = 6000; readTimeout = 60000; setRequestProperty("Content-Type", "application/octet-stream")
                            }
                            ctx.contentResolver.openInputStream(u)!!.use { inp -> c.outputStream.use { inp.copyTo(it) } }
                            if (c.responseCode >= 400) throw Exception(c.errorStream?.bufferedReader()?.readText()?.let { runCatching { JSONObject(it).optString("error") }.getOrNull() } ?: "the PC could not read it")
                            JSONObject(c.inputStream.bufferedReader().readText()).getString("text")
                        }
                        if (text.isBlank()) throw Exception("no readable text in it")
                        if (text.length > maxDoc) notes.add("\"$name\" is long - only the first ${maxDoc / 1000}k characters are sent.")
                        ui.post { pending.add(JSONObject().put("name", name).put("kind", "doc").put("text", text.take(maxDoc))) }
                    }
                } catch (e: Exception) { notes.add("$name: ${e.message}") }
            }
            ui.post { setStatus(""); renderChips(); if (notes.isNotEmpty()) toast(notes.joinToString("\n")) }
        }
    }

    private fun renderChips() {
        chips.removeAllViews()
        chips.visibility = if (pending.isEmpty()) View.GONE else View.VISIBLE
        for (f in pending.toList()) chips.addView(TextView(ctx).apply {
            text = (if (f.optString("kind") == "image") "🖼 " else "📄 ") + f.optString("name").take(24) + "   ✕"
            textSize = 12f; setTextColor(Color.parseColor("#E4E4E7")); background = round("#27272A", 14); setPadding(dp(10), dp(6), dp(10), dp(6))
            setOnClickListener { pending.remove(f); renderChips() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(6) })
    }

    // ------------------------------------------------------------- models

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
                group("ON THIS PHONE", phone, "none yet - download one in Settings")
                AlertDialog.Builder(ctx).setTitle("Which model answers?")
                    .setItems(labels.toTypedArray()) { _, i -> items[i]?.let { model = it; save(); render() } }
                    .setNeutralButton("Download models...") { _, _ -> openSettings() }
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
        return (0 until avail.length()).map { val f = avail.getString(it).removeSuffix(".gguf"); ChatModel(f, PhoneCatalog.nameFor(f), true) }
    }

    /** The phone's engine takes a few seconds to start; try again for a while. */
    private fun <T> retry(times: Int = 12, f: () -> T): T {
        var last: Exception? = null
        repeat(times) { try { return f() } catch (e: Exception) { last = e; Thread.sleep(700) } }
        throw last!!
    }

    // ------------------------------------------------------------ sending

    private fun sendMessage(spoken: String? = null, done: ((String) -> Unit)? = null) {
        val text = (spoken ?: input.text.toString()).trim()
        val m = model
        if (text.isEmpty() && pending.isEmpty()) return
        if (m == null) { pickModel(); return }
        val files = pending.toList(); pending.clear()
        val images = files.filter { it.optString("kind") == "image" }
        if (images.isNotEmpty() && m.onPhone) toast("The phone's model reads text only; the picture is not sent. Pick a PC model that can see pictures (e.g. llava, gemma3, qwen-vl).")
        if (spoken == null) input.setText("")
        // What the model reads: the message plus the text of attached documents. Pictures are kept out of the saved chat.
        val docText = files.filter { it.optString("kind") == "doc" }.joinToString("") { "\n\n[Attached file: ${it.optString("name")}]\n${it.optString("text")}" }
        messages.put(JSONObject().put("role", "user").put("content", text).put("doc", docText)
            .put("files", JSONArray(files.map { JSONObject().put("name", it.optString("name")).put("kind", it.optString("kind")) })))
        current.put("updated", System.currentTimeMillis())
        val answer = JSONObject().put("role", "assistant").put("content", "")
        messages.put(answer)
        busy = true; save(); render()
        setStatus(if (m.onPhone) "Waiting for the phone's model (the first answer loads it)..." else "Waiting for the model on your PC...")
        val history = JSONArray((0 until messages.length() - 1).map { messages.getJSONObject(it) }.filter { !it.optBoolean("error") }
            .map { JSONObject().put("role", it.getString("role")).put("content", it.getString("content") + it.optString("doc")) })
        if (!m.onPhone && images.isNotEmpty()) history.getJSONObject(history.length() - 1).put("images", JSONArray(images.map { it.optString("data") }))
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
                        if (tok.isNotEmpty()) ui.post {
                            answer.put("content", answer.getString("content") + tok); showLast(answer.getString("content"))
                            if (assistant == null) setStatus("Replying...") else assistantReply(answer.getString("content"))
                        }
                    }
                }
            } catch (e: Exception) {
                if (busy) ui.post { if (answer.getString("content").isEmpty()) answer.put("content", e.message ?: "Something went wrong.").put("error", true) }
            } finally {
                ui.post {
                    if (answer.getString("content").isEmpty()) answer.put("content", "(stopped)")
                    busy = false; live = null; save(); render(); setStatus("")
                    if (done != null) done(answer.getString("content")) else if (!answer.optBoolean("error")) say(answer.getString("content"))
                }
            }
        }
    }

    private fun post(c: HttpURLConnection, body: JSONObject): HttpURLConnection = c.apply {
        requestMethod = "POST"; doOutput = true; connectTimeout = 5000; readTimeout = 0
        setRequestProperty("Content-Type", "application/json")
        // A fresh connection every time: reusing one the engine closed (after Stop, or a takeover) fails with
        // "unexpected end of stream".
        setRequestProperty("Connection", "close")
        outputStream.use { it.write(body.toString().toByteArray()) }
    }

    /** Closing the request stops the answer (both engines stop when the reader goes away). */
    private fun stop() {
        busy = false
        thread { live?.disconnect() }
        render()
    }

    // ------------------------------------------------------- voice

    private var recognizer: SpeechRecognizer? = null

    /** Listens once with the phone's recognizer, showing the words as they come; `heard` gets the result or null. */
    private fun hear(onPartial: (String) -> Unit, heard: (String?) -> Unit) {
        askMic { ok ->
            if (!ok) { toast("The microphone is needed to talk to the assistant."); heard(null); return@askMic }
            if (!SpeechRecognizer.isRecognitionAvailable(ctx)) { toast("This phone has no speech recognizer (install or turn on Google voice typing)."); heard(null); return@askMic }
            recognizer?.destroy()
            val r = SpeechRecognizer.createSpeechRecognizer(ctx); recognizer = r
            r.setRecognitionListener(object : RecognitionListener {
                override fun onResults(b: Bundle?) { heard(b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()) }
                override fun onPartialResults(b: Bundle?) { b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial) }
                override fun onError(error: Int) { heard(null) }
                override fun onReadyForSpeech(p: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(v: Float) { assistantLevel(v) }
                override fun onBufferReceived(b: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onEvent(t: Int, b: Bundle?) {}
            })
            r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true))
        }
    }

    /** 🎤 in the message box: dictate into the box (send it yourself). */
    private fun dictate() {
        tts?.stop(); setStatus("Listening... speak now")
        hear({ input.setText(it); input.setSelection(it.length) }) { heard -> setStatus(""); if (!heard.isNullOrBlank()) { input.setText(heard); input.setSelection(heard.length) } }
    }

    // --------------------------------------------------------- the assistant

    private var assistant: View? = null
    private var aState: TextView? = null
    private var aHeard: TextView? = null
    private var aReply: TextView? = null
    private var aOrb: View? = null

    /** Hands-free conversation: listen, answer with this chat's model, speak, listen again - until closed. */
    private fun openAssistant() {
        if (model == null) { pickModel(); return }
        val panel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setBackgroundColor(Color.parseColor("#0B0B0D")); isClickable = true
            setPadding(dp(24), dp(40), dp(24), dp(28))
        }
        panel.addView(TextView(ctx).apply { text = "Assistant  ·  ${model?.name}"; textSize = 13f; setTextColor(Color.parseColor("#A1A1AA")); gravity = Gravity.CENTER })
        val orb = View(ctx).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#7C3AED")) } }
        aOrb = orb
        panel.addView(FrameLayout(ctx).apply { addView(orb, FrameLayout.LayoutParams(dp(130), dp(130), Gravity.CENTER)) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(220)).apply { topMargin = dp(30) })
        aState = TextView(ctx).apply { textSize = 20f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setTypeface(typeface, Typeface.BOLD) }
        panel.addView(aState)
        aHeard = TextView(ctx).apply { textSize = 15f; setTextColor(Color.parseColor("#C4B5FD")); gravity = Gravity.CENTER; setPadding(0, dp(14), 0, 0) }
        panel.addView(aHeard)
        aReply = TextView(ctx).apply { textSize = 15f; setTextColor(Color.parseColor("#E4E4E7")); setPadding(0, dp(14), 0, 0); setLineSpacing(0f, 1.15f) }
        panel.addView(ScrollView(ctx).apply { addView(aReply) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        panel.addView(Button(ctx).apply {
            text = "End conversation"; isAllCaps = false; textSize = 15f; setTextColor(Color.WHITE); background = round("#DC2626", 26)
            setOnClickListener { closeAssistant() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)))
        assistant = panel
        root.addView(panel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        assistantTurn()
    }

    private fun assistantState(t: String) { aState?.text = t }
    private fun assistantReply(t: String) { aReply?.text = t; assistantState("Replying...") }
    private fun assistantLevel(rms: Float) { val s = 1f + (rms.coerceIn(0f, 10f) / 25f); aOrb?.scaleX = s; aOrb?.scaleY = s }

    private fun assistantTurn() {
        if (assistant == null) return
        assistantState("Listening..."); aOrb?.alpha = 1f
        hear({ aHeard?.text = it }) { heard ->
            if (assistant == null) return@hear
            if (heard.isNullOrBlank()) { assistantState("Listening..."); ui.postDelayed({ assistantTurn() }, 400); return@hear }
            aHeard?.text = "“$heard”"; aReply?.text = ""; assistantLevel(0f); aOrb?.alpha = 0.6f
            assistantState("Thinking...")
            sendMessage(spoken = heard) { reply ->
                if (assistant == null) return@sendMessage
                aReply?.text = reply
                say(reply, force = true) { if (assistant != null) assistantTurn() }
            }
        }
    }

    private fun closeAssistant() {
        val a = assistant ?: return
        assistant = null
        recognizer?.destroy(); recognizer = null
        tts?.stop()
        if (busy) stop()
        root.removeView(a)
        render()
    }
}
