package com.cursed.runtime

import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.widget.EditText
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URLEncoder
import kotlin.concurrent.thread

/**
 * Pictures (and videos) shared to the app from the gallery, the camera or any other app. They go to the connected PC:
 * into a series as reference photos (which series, episode, what the picture is and - for a person - who), or into
 * the PC's reference folder, where the Image and Video studios pick them up.
 *
 * `openPc` opens a request to the PC (with the access code and its pinned certificate).
 */
class ShareIn(private val ctx: Context, private val openPc: (String) -> HttpURLConnection) {
    private val ui = Handler(Looper.getMainLooper())

    private data class Kind(val id: String, val label: String, val style: Boolean = false)
    private val kinds = listOf(
        Kind("person", "Person / face"), Kind("outfit", "Outfit / costume"), Kind("product", "Product"), Kind("location", "Location / background"),
        Kind("pose", "Pose / composition"), Kind("prop", "Prop / object"), Kind("palette", "Colour palette", true), Kind("style", "Style / look", true), Kind("other", "Other"),
    )

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun toast(t: String) = ui.post { Toast.makeText(ctx, t, Toast.LENGTH_LONG).show() }
    private fun get(path: String): String = openPc(path).run { connectTimeout = 6000; readTimeout = 15000; inputStream.bufferedReader().use { it.readText() }.also { disconnect() } }

    private fun nameOf(uri: Uri): String {
        var n = "shared.jpg"
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) n = it.getString(0) ?: n }
        if (!n.contains('.')) n += when (ctx.contentResolver.getType(uri)) { "image/png" -> ".png"; "image/webp" -> ".webp"; "video/mp4" -> ".mp4"; else -> ".jpg" }
        return n
    }
    private fun isImage(uri: Uri) = ctx.contentResolver.getType(uri)?.startsWith("image/") ?: Regex("\\.(png|jpe?g|webp)$", RegexOption.IGNORE_CASE).containsMatchIn(nameOf(uri))

    private fun upload(path: String, uri: Uri): String {
        val c = openPc(path).apply {
            requestMethod = "POST"; doOutput = true; connectTimeout = 6000; readTimeout = 120000; setChunkedStreamingMode(1 shl 16)
            setRequestProperty("Content-Type", ctx.contentResolver.getType(uri) ?: "application/octet-stream")
        }
        ctx.contentResolver.openInputStream(uri)!!.use { inp -> c.outputStream.use { inp.copyTo(it) } }
        if (c.responseCode >= 400) throw Exception(c.errorStream?.bufferedReader()?.readText()?.let { runCatching { JSONObject(it).optString("error") }.getOrNull() ?: it } ?: "Error ${c.responseCode}")
        return c.inputStream.bufferedReader().use { it.readText() }.also { c.disconnect() }
    }

    fun handle(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val pics = uris.filter { isImage(it) }
        val what = if (uris.size == 1) "1 file" else "${uris.size} files"
        val options = mutableListOf<Pair<String, () -> Unit>>()
        if (pics.isNotEmpty()) options.add("Add to a series (reference photo)" to { toSeries(pics) })
        options.add("Save to the PC's studio references" to { toStudio(uris) })
        AlertDialog.Builder(ctx).setTitle("Send $what to your PC")
            .setItems(options.map { it.first }.toTypedArray()) { _, i -> options[i].second() }
            .setNegativeButton("Cancel", null).show()
    }

    private fun toStudio(uris: List<Uri>) = thread {
        try {
            var folder = ""
            for (u in uris) folder = JSONObject(upload("/api/tool/ref-upload?name=" + enc(nameOf(u)), u)).optString("folder")
            toast("Saved ${uris.size} to the PC ($folder). Pick them under References in the Image or Video studio.")
        } catch (e: Exception) { toast("Could not send: ${e.message}") }
    }

    private fun toSeries(pics: List<Uri>) = thread {
        val list = try { JSONObject(get("/api/series/projects")).getJSONArray("projects") } catch (e: Exception) { toast("Could not read the series: ${e.message}"); return@thread }
        if (list.length() == 0) { toast("There is no series on the PC yet."); return@thread }
        val titles = (0 until list.length()).map { list.getJSONObject(it).getString("title") }
        ui.post {
            AlertDialog.Builder(ctx).setTitle("Which series?").setItems(titles.toTypedArray()) { _, i -> pickEpisode(list.getJSONObject(i).getString("id"), titles[i], pics) }
                .setNegativeButton("Cancel", null).show()
        }
    }

    private fun pickEpisode(id: String, title: String, pics: List<Uri>) = thread {
        val eps = try { JSONObject(get("/api/series/projects/$id")).getJSONArray("episodes") } catch (e: Exception) { toast("Could not open the series: ${e.message}"); return@thread }
        if (eps.length() == 0) { toast("\"$title\" has no episodes yet. Make its plan first."); return@thread }
        ui.post {
            if (eps.length() == 1) pickKind(id, title, eps.getJSONObject(0).getString("id"), pics)
            else AlertDialog.Builder(ctx).setTitle("Which episode?")
                .setItems((0 until eps.length()).map { val e = eps.getJSONObject(it); "Episode ${e.optInt("number")}: ${e.optString("title")}" }.toTypedArray()) { _, i -> pickKind(id, title, eps.getJSONObject(i).getString("id"), pics) }
                .setNegativeButton("Cancel", null).show()
        }
    }

    private fun pickKind(id: String, title: String, ep: String, pics: List<Uri>) {
        AlertDialog.Builder(ctx).setTitle("What is in the picture?").setItems(kinds.map { it.label }.toTypedArray()) { _, i ->
            val k = kinds[i]
            if (k.id != "person") send(id, title, ep, pics, k, "")
            else {
                val who = EditText(ctx).apply { hint = "Name, e.g. Richie"; setTextColor(Color.BLACK) }
                AlertDialog.Builder(ctx).setTitle("Who is it?").setView(who)
                    .setPositiveButton("Add") { _, _ -> send(id, title, ep, pics, k, who.text.toString().trim()) }
                    .setNegativeButton("Cancel", null).show()
            }
        }.setNegativeButton("Cancel", null).show()
    }

    private fun send(id: String, title: String, ep: String, pics: List<Uri>, k: Kind, person: String) = thread {
        try {
            for (u in pics) {
                val name = nameOf(u)
                val label = person.ifEmpty { name.substringBeforeLast('.').replace(Regex("[_-]+"), " ") }.take(60)
                upload("/api/series/projects/$id/episodes/$ep/upload?name=${enc(name)}&label=${enc(label)}&role=${if (k.style) "style" else "character"}&kind=${k.id}" + (if (person.isNotEmpty()) "&person=${enc(person)}" else ""), u)
            }
            toast("Added ${pics.size} to \"$title\" as ${k.label.lowercase()}.")
        } catch (e: Exception) { toast("Could not add: ${e.message}") }
    }

    companion object {
        /** The files in a share intent (one or several). */
        @Suppress("DEPRECATION")
        fun urisOf(intent: android.content.Intent?): List<Uri> = when (intent?.action) {
            android.content.Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra(android.content.Intent.EXTRA_STREAM) as? Uri)
            android.content.Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(android.content.Intent.EXTRA_STREAM) ?: emptyList()
            else -> emptyList()
        }
    }
}
