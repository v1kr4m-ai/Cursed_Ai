package com.cursed.runtime

import android.app.AlertDialog
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
import java.io.File
import kotlin.concurrent.thread

/**
 * Settings that exist only in the phone app: the GGUF models the phone's own engine can use. A model downloaded on
 * the phone (in Downloads, a file manager, a cloud drive) is picked here and copied into the engine's model folder -
 * the engine reads models from a real file path, which files elsewhere on the phone do not offer. The original can be
 * deleted after copying, so the space is not used twice. Also shows the connected PC, with a way to forget it.
 *
 * `pickFile` opens the phone's file picker and hands back the chosen file; `onBack` returns to the chat.
 */
class PhoneSettings(
    private val ctx: Context,
    private val prefs: SharedPreferences,
    private val pickFile: ((Uri?) -> Unit) -> Unit,
    private val onBack: () -> Unit,
    private val onForgetPc: () -> Unit,
) {
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
    fun refresh() { if (::body.isInitialized && !copying) render() }

    private fun render() {
        body.removeAllViews()
        body.addView(text("Models on this phone", 15f, "#FFFFFF", bold = true, top = 8))
        body.addView(text("The engine on this phone answers with these (Chat > model > On this phone). Small models (1-4 GB, e.g. Q4) run best.", 12f, "#A1A1AA", top = 4))
        val files = dir.listFiles { f -> f.extension.equals("gguf", true) }?.sortedBy { it.name.lowercase() } ?: emptyList()
        if (files.isEmpty()) body.addView(text("No model yet. Add one below.", 13f, "#71717A", top = 12))
        for (f in files) {
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = round("#18181B", 12); setPadding(dp(12), dp(8), dp(8), dp(8)) }
            row.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                addView(text(f.nameWithoutExtension, 14f, "#F4F4F5"))
                addView(text(gb(f.length()), 11f, "#71717A"))
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(button("Delete", "#7F1D1D") {
                AlertDialog.Builder(ctx).setTitle("Delete ${f.nameWithoutExtension}?").setMessage("The file (${gb(f.length())}) is removed from the phone.")
                    .setPositiveButton("Delete") { _, _ -> f.delete(); render() }.setNegativeButton("Cancel", null).show()
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)))
            body.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        }
        val free = StatFs(dir.absolutePath).availableBytes
        body.addView(text("Free space on the phone: ${gb(free)}", 12f, "#A1A1AA", top = 10))

        body.addView(text("Add a model", 15f, "#FFFFFF", bold = true, top = 22))
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
