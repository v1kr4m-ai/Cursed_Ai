package com.cursed.runtime

import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File
import kotlin.concurrent.thread

/**
 * Settings that exist only in the phone app: the GGUF models the phone's own engine can use. A model downloaded on
 * the phone (in Downloads, a file manager, a cloud drive) is picked here and copied into the engine's model folder -
 * the engine reads models from a real file path, which files elsewhere on the phone do not offer. The original can be
 * deleted after copying, so the space is not used twice. Also shows the connected PC, with a way to forget it.
 *
 * **Download models** lists small models that run well on a phone, tagged like the desktop's list; Download saves one
 * straight into the engine's folder (with progress, also in the notification bar), and Use in chat makes the chat
 * answer with it - nothing else to set up.
 *
 * `pickFile` opens the phone's file picker and hands back the chosen file; `onBack` returns to the chat; `onUse`
 * switches the chat to a phone model.
 */
class PhoneSettings(
    private val ctx: Context,
    private val prefs: SharedPreferences,
    private val pickFile: ((Uri?) -> Unit) -> Unit,
    private val onBack: () -> Unit,
    private val onForgetPc: () -> Unit,
    private val onUse: (ChatModel) -> Unit,
) {
    private val dm get() = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    /** Views of the catalog entries being downloaded, updated in place while the screen is open. */
    private val live = mutableMapOf<String, Pair<ProgressBar, TextView>>()
    private val ticker = object : Runnable {
        override fun run() { if (tick()) ui.postDelayed(this, 1000) }
    }
    private val ui = Handler(Looper.getMainLooper())
    private val dir: File get() = (ctx.getExternalFilesDir("models") ?: File(ctx.filesDir, "models")).apply { mkdirs() }
    private lateinit var body: LinearLayout
    private var copying = false

    private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()
    private fun round(color: String, r: Int) = GradientDrawable().apply { setColor(Color.parseColor(color)); cornerRadius = dp(r).toFloat() }
    private fun gb(b: Long) = if (b >= 1L shl 30) "%.1f GB".format(b / (1L shl 30).toDouble()) else "${b / (1L shl 20)} MB"
    private fun text(t: String, size: Float, color: String, bold: Boolean = false, top: Int = 0) = TextView(ctx).apply {
        text = t; textSize = size; setTextColor(Color.parseColor(color)); if (bold) setTypeface(typeface, Typeface.BOLD)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
    }
    private fun button(label: String, color: String, onClick: () -> Unit) = Button(ctx).apply {
        text = label; isAllCaps = false; textSize = 13f; setTextColor(Color.WHITE); background = round(color, 14); setOnClickListener { onClick() }
    }

    fun view(): View {
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#0E0E10")) }
        val bar = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10)) }
        bar.addView(button("‹ Chat", "#27272A") { onBack() }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(38)))
        bar.addView(text("Phone settings", 17f, "#FFFFFF", bold = true).apply { setPadding(dp(14), 0, 0, 0) })
        col.addView(bar)
        body = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(4), dp(16), dp(24)) }
        col.addView(ScrollView(ctx).apply { addView(body) }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        render()
        return col
    }

    /** Called when the screen is shown again, so a model added by cable shows up. */
    fun refresh() { if (::body.isInitialized && !copying) { tick(); render() } }

    private fun render() {
        body.removeAllViews()
        live.clear()
        body.addView(text("Models on this phone", 15f, "#FFFFFF", bold = true, top = 8))
        body.addView(text("The engine on this phone answers with these (Chat > model > On this phone). Small models (1-4 GB, e.g. Q4) run best.", 12f, "#A1A1AA", top = 4))
        val files = dir.listFiles { f -> f.extension.equals("gguf", true) }?.sortedBy { it.name.lowercase() } ?: emptyList()
        if (files.isEmpty()) body.addView(text("No model yet. Add one below.", 13f, "#71717A", top = 12))
        for (f in files) {
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = round("#18181B", 12); setPadding(dp(12), dp(8), dp(8), dp(8)) }
            row.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(PhoneCatalog.nameFor(f.nameWithoutExtension), 14f, "#F4F4F5"))
                addView(text(gb(f.length()), 11f, "#71717A"))
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(button("Use", "#5B21B6") { onUse(ChatModel(f.nameWithoutExtension, PhoneCatalog.nameFor(f.nameWithoutExtension), true)) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)).apply { rightMargin = dp(6) })
            row.addView(button("Delete", "#7F1D1D") {
                AlertDialog.Builder(ctx).setTitle("Delete ${f.nameWithoutExtension}?").setMessage("The file (${gb(f.length())}) is removed from the phone.")
                    .setPositiveButton("Delete") { _, _ -> f.delete(); render() }.setNegativeButton("Cancel", null).show()
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)))
            body.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        }
        val free = StatFs(dir.absolutePath).availableBytes
        body.addView(text("Free space on the phone: ${gb(free)}", 12f, "#A1A1AA", top = 10))

        catalog()

        body.addView(text("Add a model you already have", 15f, "#FFFFFF", bold = true, top = 22))
        body.addView(text("Pick a .gguf file you downloaded on the phone (Downloads, a file manager or a cloud drive). It is copied into the engine's folder.", 12f, "#A1A1AA", top = 4))
        val removeOriginal = CheckBox(ctx).apply {
            text = "Delete the original after copying (saves the space)"; setTextColor(Color.parseColor("#D4D4D8")); textSize = 13f
            isChecked = prefs.getBoolean("gguf_delete_original", false)
            setOnCheckedChangeListener { _, on -> prefs.edit().putBoolean("gguf_delete_original", on).apply() }
        }
        body.addView(removeOriginal)
        val status = text("", 12f, "#A1A1AA", top = 6)
        val progress = ProgressBar(ctx, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000; visibility = View.GONE }
        body.addView(button("Choose a GGUF file...", "#7C3AED") { if (!copying) pickFile { uri -> uri?.let { add(it, removeOriginal.isChecked, status, progress) } } },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(6) })
        body.addView(progress); body.addView(status)
        body.addView(text("By cable instead: adb push model.gguf ${dir.absolutePath}/", 11f, "#71717A", top = 8).apply { setTextIsSelectable(true) })

        val pc = prefs.getString("pc_address", "") ?: ""
        if (pc.isNotEmpty()) {
            body.addView(text("Your PC", 15f, "#FFFFFF", bold = true, top = 22))
            body.addView(text("Connected to $pc. Forgetting it signs this phone out and asks for the address and code again (and learns the PC's certificate afresh).", 12f, "#A1A1AA", top = 4))
            body.addView(button("Forget this PC", "#27272A") {
                AlertDialog.Builder(ctx).setTitle("Forget this PC?").setPositiveButton("Forget") { _, _ ->
                    prefs.edit().remove("pc_address").remove("pc_code").remove("pc_cert").remove("mode").apply(); onForgetPc()
                }.setNegativeButton("Cancel", null).show()
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply { topMargin = dp(6) })
        }
    }

    // ------------------------------------------------------------ downloads

    private fun partOf(e: PhoneCatalog.Entry) = File(dir, e.file + ".gguf.part")
    private fun fileOf(e: PhoneCatalog.Entry) = File(dir, e.file + ".gguf")

    /** Small models for phones with their tags; Download, then Use in chat. */
    private fun catalog() {
        body.addView(text("Download models", 15f, "#FFFFFF", bold = true, top = 22))
        body.addView(text("Small models made for phones. They download straight into the engine and are ready to use. Wi-Fi recommended.", 12f, "#A1A1AA", top = 4))
        for (e in PhoneCatalog.models) {
            val card = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; background = round("#18181B", 12); setPadding(dp(12), dp(10), dp(12), dp(10)) }
            val head = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            head.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(e.name, 14f, "#F4F4F5", bold = true))
                addView(text("${gb(e.bytes)}  ·  ${e.about}", 11f, "#A1A1AA"))
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            val have = fileOf(e).exists()
            val running = prefs.getLong("dl_" + e.file, -1L) >= 0
            head.addView(when {
                have -> button("Use in chat", "#16A34A") { onUse(ChatModel(e.file, e.name, true)) }
                running -> button("Cancel", "#3F3F46") { cancel(e) }
                else -> button("Download", "#7C3AED") { download(e) }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)).apply { leftMargin = dp(8) })
            card.addView(head)
            // Tags, like the desktop's model list.
            val tags = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(6), 0, 0) }
            for (t in e.tags) tags.addView(TextView(ctx).apply {
                text = t; textSize = 10f; setTypeface(typeface, Typeface.BOLD)
                val c = when (t) { "Recommended" -> "#16A34A"; "Fast", "Tiny" -> "#0EA5E9"; "Reasoning" -> "#F59E0B"; "Coding" -> "#EC4899"; "Smarter" -> "#8B5CF6"; else -> "#52525B" }
                setTextColor(Color.WHITE); background = round(c, 8); setPadding(dp(7), dp(2), dp(7), dp(2))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(5) })
            card.addView(tags)
            if (running) {
                val bar = ProgressBar(ctx, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000 }
                val note = text("Starting...", 11f, "#A1A1AA")
                card.addView(bar); card.addView(note)
                live[e.file] = bar to note
            }
            body.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        }
        if (live.isNotEmpty()) { ui.removeCallbacks(ticker); ui.post(ticker) }
    }

    private fun download(e: PhoneCatalog.Entry) {
        if (e.bytes > StatFs(dir.absolutePath).availableBytes - (300L shl 20)) { showResult("Not enough free space for ${e.name} (${gb(e.bytes)}). Delete a model or other files first."); return }
        partOf(e).delete()
        val id = dm.enqueue(DownloadManager.Request(Uri.parse(e.url))
            .setTitle("${e.name} for Cursed_Ai").setDescription("Model for the phone's chat")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationUri(Uri.fromFile(partOf(e))))
        prefs.edit().putLong("dl_" + e.file, id).apply()
        render()
    }

    private fun cancel(e: PhoneCatalog.Entry) {
        val id = prefs.getLong("dl_" + e.file, -1L)
        if (id >= 0) dm.remove(id)
        prefs.edit().remove("dl_" + e.file).apply()
        partOf(e).delete(); render()
    }

    /**
     * Checks the downloads: shows progress, and a finished one is renamed to .gguf (so the engine lists it only once
     * it is complete). Also runs when the screen opens, for downloads that finished while it was closed.
     * Returns true while any is still running.
     */
    private fun tick(): Boolean {
        var running = false; var changed = false
        for (e in PhoneCatalog.models) {
            val id = prefs.getLong("dl_" + e.file, -1L)
            if (id < 0) continue
            dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
                if (!c.moveToFirst()) { prefs.edit().remove("dl_" + e.file).apply(); changed = true; return@use }
                val st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val got = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).takeIf { it > 0 } ?: e.bytes
                when (st) {
                    DownloadManager.STATUS_SUCCESSFUL -> {
                        partOf(e).renameTo(fileOf(e)); prefs.edit().remove("dl_" + e.file).apply(); changed = true
                        if (::body.isInitialized) Toast.makeText(ctx, "${e.name} is ready. Tap Use in chat.", Toast.LENGTH_LONG).show()
                    }
                    DownloadManager.STATUS_FAILED -> {
                        prefs.edit().remove("dl_" + e.file).apply(); partOf(e).delete(); changed = true
                        Toast.makeText(ctx, "${e.name} could not be downloaded (check the connection and free space).", Toast.LENGTH_LONG).show()
                    }
                    else -> {
                        running = true
                        live[e.file]?.let { (bar, note) ->
                            bar.progress = (got * 1000 / total).toInt()
                            note.text = if (st == DownloadManager.STATUS_PAUSED) "Paused (waiting for a connection)... ${gb(got)} of ${gb(total)}" else "Downloading... ${gb(got)} of ${gb(total)}"
                        }
                    }
                }
            }
        }
        if (changed && ::body.isInitialized && !copying) render()
        return running
    }

    /** Copies the picked file into the model folder, showing progress; a half-copied file never stays behind. */
    private fun add(uri: Uri, deleteOriginal: Boolean, status: TextView, progress: ProgressBar) {
        val cr = ctx.contentResolver
        var name = "model.gguf"; var size = -1L
        cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) { name = c.getString(0) ?: name; if (!c.isNull(1)) size = c.getLong(1) }
        }
        if (!name.endsWith(".gguf", true)) { status.setTextColor(Color.parseColor("#FCA5A5")); status.text = "\"$name\" is not a GGUF model file."; return }
        val safe = name.replace(Regex("[^A-Za-z0-9._()-]+"), "_")
        val dest = File(dir, safe)
        if (size > 0 && size > StatFs(dir.absolutePath).availableBytes - (200L shl 20)) { status.setTextColor(Color.parseColor("#FCA5A5")); status.text = "Not enough free space for ${gb(size)}."; return }
        copying = true
        status.setTextColor(Color.parseColor("#A1A1AA")); status.text = "Copying $name..."; progress.visibility = View.VISIBLE; progress.progress = 0
        thread {
            val part = File(dir, "$safe.part")
            val msg = try {
                var done = 0L; var shown = 0L
                cr.openInputStream(uri)!!.use { inp -> part.outputStream().use { out ->
                    val buf = ByteArray(1 shl 20)
                    while (true) {
                        val n = inp.read(buf); if (n < 0) break
                        out.write(buf, 0, n); done += n
                        if (done - shown > (16L shl 20)) { shown = done; val d = done; ui.post { progress.progress = if (size > 0) (d * 1000 / size).toInt() else 0; status.text = "Copying $name... ${gb(d)}${if (size > 0) " of ${gb(size)}" else ""}" } }
                    }
                } }
                if (dest.exists()) dest.delete()
                if (!part.renameTo(dest)) throw Exception("Could not save the file.")
                val removed = deleteOriginal && runCatching { DocumentsContract.deleteDocument(cr, uri) }.getOrDefault(false)
                "Added ${dest.nameWithoutExtension} (${gb(dest.length())}).${if (deleteOriginal && !removed) " The original could not be deleted from where it is; delete it in your file manager." else if (removed) " The original was deleted." else ""}"
            } catch (e: Exception) {
                part.delete(); "Copy failed: ${e.message}"
            }
            ui.post { copying = false; render(); showResult(msg) }
        }
    }

    private fun showResult(msg: String) { AlertDialog.Builder(ctx).setMessage(msg).setPositiveButton("OK", null).show() }
}
