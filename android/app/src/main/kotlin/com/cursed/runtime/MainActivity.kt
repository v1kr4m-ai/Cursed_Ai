package com.cursed.runtime

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.Log
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.cursed.runtime.services.CursedRuntimeService
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.concurrent.thread

/**
 * Two ways to use Cursed_Ai on a phone:
 *  - "Connect to my PC": the studio you already use on the PC, shown in this app. The PC does the work (models, ComfyUI,
 *    series); the phone is the screen. Needs the PC's address and the access code from Settings > Phone & other devices.
 *  - "Use on this phone": the small model engine that runs on the phone itself, as before.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var root: LinearLayout
    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("cursed", Context.MODE_PRIVATE) }
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var showingWeb = false
    private var pcMode = false

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        val uris: Array<Uri>? = when {
            result.resultCode != RESULT_OK || data == null -> null
            data.clipData != null -> Array(data.clipData!!.itemCount) { i -> data.clipData!!.getItemAt(i).uri }
            data.data != null -> arrayOf(data.data!!)
            else -> null
        }
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = buildWebView()
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#0E0E10")) }
        setContentView(root)

        // The last choice is reopened straight away; back returns here to change it.
        when (prefs.getString("mode", "")) {
            "pc" -> prefs.getString("pc_address", "")?.takeIf { it.isNotBlank() }?.let { connect(it, prefs.getString("pc_code", "") ?: "", auto = true) } ?: showChooser()
            "phone" -> openOnPhone()
            else -> showChooser()
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView(): WebView = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

        webChromeClient = object : WebChromeClient() {
            // Attaching photos in Series (or anywhere else a page asks for a file).
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, params?.acceptTypes?.filter { it.isNotBlank() }?.toTypedArray()?.takeIf { it.isNotEmpty() } ?: arrayOf("*/*"))
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                return try { pickFiles.launch(intent); true } catch (e: Exception) { fileCallback = null; false }
            }
        }

        webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame != true) return
                Log.e("Cursed", "WebView error ${error?.errorCode}: ${error?.description}")
                if (pcMode) {
                    // The PC went away (asleep, off the Wi-Fi): say so and offer the connect screen.
                    handler.post { showChooser("Lost the connection to your PC (${error?.description}). Check that the PC is on and on the same Wi-Fi.") }
                } else if (request.url?.host == "127.0.0.1") {
                    handler.postDelayed({ view?.loadUrl(request.url.toString()) }, 2000) // the local engine is still starting
                }
            }
        }
    }

    /** The first screen: connect to the PC, or use the phone's own engine. */
    private fun showChooser(message: String? = null) {
        showingWeb = false
        root.removeAllViews()
        val scroll = ScrollView(this)
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(40), dp(24), dp(24))
        }
        col.addView(ImageView(this).apply { setImageResource(R.mipmap.ic_launcher); layoutParams = LinearLayout.LayoutParams(dp(96), dp(96)) })
        col.addView(text("Cursed_Ai", 26f, "#FFFFFF", bold = true, topDp = 12))
        col.addView(text("Use it on your phone", 13f, "#A1A1AA", topDp = 2))

        col.addView(text("Connect to my PC", 16f, "#FFFFFF", bold = true, topDp = 28))
        col.addView(text("The studio you use on the PC, with its models, ComfyUI and series. On the PC open Settings > General > Phone & other devices to see the address and code.", 12f, "#A1A1AA", topDp = 4))
        val address = field("PC address, e.g. 192.168.1.5:3000", prefs.getString("pc_address", "") ?: "", InputType.TYPE_TEXT_VARIATION_URI)
        val code = field("Access code (6 digits)", prefs.getString("pc_code", "") ?: "", InputType.TYPE_CLASS_NUMBER)
        col.addView(address); col.addView(code)
        val status = text(message ?: "", 12f, if (message != null) "#FCA5A5" else "#A1A1AA", topDp = 6)
        col.addView(status)
        col.addView(primary("Connect to my PC") {
            val a = address.text.toString().trim()
            val c = code.text.toString().trim()
            if (a.isEmpty()) { status.setTextColor(Color.parseColor("#FCA5A5")); status.text = "Type the PC's address first."; return@primary }
            status.setTextColor(Color.parseColor("#A1A1AA")); status.text = "Connecting..."
            connect(a, c, auto = false, onFail = { msg -> status.setTextColor(Color.parseColor("#FCA5A5")); status.text = msg })
        })

        col.addView(text("or", 12f, "#71717A", topDp = 20))
        col.addView(secondary("Use on this phone (small offline engine)") { openOnPhone() })
        scroll.addView(col)
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT))
    }

    private fun text(t: String, size: Float, color: String, bold: Boolean = false, topDp: Int = 0) = TextView(this).apply {
        text = t; textSize = size; setTextColor(Color.parseColor(color)); gravity = Gravity.CENTER_HORIZONTAL
        if (bold) setTypeface(typeface, Typeface.BOLD)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(topDp) }
    }

    private fun field(hint: String, value: String, type: Int) = EditText(this).apply {
        this.hint = hint; setText(value); inputType = type; setSingleLine()
        setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#71717A")); setBackgroundColor(Color.parseColor("#18181B"))
        setPadding(dp(14), dp(12), dp(14), dp(12))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) }
    }

    private fun primary(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; setTextColor(Color.WHITE); setBackgroundColor(Color.parseColor("#7C3AED"))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(14) }
        setOnClickListener { onClick() }
    }

    private fun secondary(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; setTextColor(Color.parseColor("#D4D4D8")); setBackgroundColor(Color.parseColor("#27272A"))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply { topMargin = dp(8) }
        setOnClickListener { onClick() }
    }

    /** "192.168.1.5" -> http://192.168.1.5:3000 ; a full address is kept. */
    private fun baseUrl(input: String): String {
        var a = input.trim().trimEnd('/')
        if (!a.startsWith("http://") && !a.startsWith("https://")) a = "http://$a"
        val hostPart = a.substringAfter("://").substringBefore("/")
        if (!hostPart.contains(":") && a.startsWith("http://")) a += ":3000"
        return a
    }

    /** Checks the PC answers and accepts the code, then opens the studio in the WebView (the login sets the cookie). */
    private fun connect(address: String, code: String, auto: Boolean, onFail: (String) -> Unit = { showChooser(it) }) {
        val base = baseUrl(address)
        if (auto) {
            // Reopening the last PC: say what is happening while it answers.
            root.removeAllViews()
            root.addView(text("Connecting to your PC...", 15f, "#D4D4D8", topDp = 200))
        }
        thread {
            val result: Pair<Boolean, String> = try {
                val url = URL("$base/__phone-login?code=" + URLEncoder.encode(code, "UTF-8"))
                val c = (url.openConnection() as HttpURLConnection).apply { connectTimeout = 5000; readTimeout = 6000; instanceFollowRedirects = false }
                val status = c.responseCode
                c.disconnect()
                when (status) {
                    302, 200 -> if (status == 302) true to "" else false to "The PC answered, but it wants an access code. Type the 6-digit code from Settings > General > Phone & other devices."
                    401 -> false to "That code is not right. Check Settings > General > Phone & other devices on the PC (a new code replaces the old one)."
                    403 -> false to "Phone access is switched off on the PC. Turn it on in Settings > General > Phone & other devices."
                    429 -> false to "Too many wrong codes. Wait a minute and try again."
                    else -> false to "The PC answered with an unexpected error ($status)."
                }
            } catch (e: Exception) {
                false to "Could not reach $base. Check that the PC app is running, the phone is on the same Wi-Fi, and Windows allows the port (the command is shown in Settings > Phone & other devices)."
            }
            handler.post {
                if (result.first) {
                    prefs.edit().putString("mode", "pc").putString("pc_address", address).putString("pc_code", code).apply()
                    pcMode = true
                    openWeb("$base/__phone-login?code=" + URLEncoder.encode(code, "UTF-8"))
                } else if (auto) {
                    showChooser(result.second)
                } else onFail(result.second)
            }
        }
    }

    private fun openOnPhone() {
        prefs.edit().putString("mode", "phone").apply()
        pcMode = false
        startForegroundService(Intent(this, CursedRuntimeService::class.java))
        openWeb("http://127.0.0.1:11434/index.html")
    }

    private fun openWeb(url: String) {
        showingWeb = true
        root.removeAllViews()
        (webView.parent as? LinearLayout)?.removeView(webView)
        root.addView(webView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT))
        webView.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            showingWeb && webView.canGoBack() -> webView.goBack()
            // At the start of the studio, back returns to the connect screen (to change the PC or the mode).
            showingWeb -> { prefs.edit().remove("mode").apply(); pcMode = false; showChooser() }
            else -> super.onBackPressed()
        }
    }
}
