package com.cursed.runtime

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
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
import android.widget.FrameLayout
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.cursed.runtime.services.CursedRuntimeService
import android.net.http.SslCertificate
import android.net.http.SslError
import android.webkit.SslErrorHandler
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import kotlin.concurrent.thread

/**
 * The app is a native shell around the studio: a bottom bar with a native Chat screen (answers from a model on the PC
 * or on this phone) and the studio's own pages (Image, Video, Series, More) shown in a WebView.
 *
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
    /** The PC address that answered (secure, or the plain one for an older PC app), for the native chat's requests. */
    private var pcUsed: String? = null
    /** The tab shown in the bottom bar's shell, or null when the connect screen is shown. */
    private var tab: String? = null
    private var shellContent: FrameLayout? = null
    private var chatView: View? = null
    private var settings: PhoneSettings? = null
    /** Files shared to the app before it was connected to the PC; sent on once it is. */
    private var pendingShare: List<Uri> = emptyList()
    private var settingsView: View? = null

    /** The phone's own file picker, for Phone settings > Add a model. */
    private var onPicked: ((Uri?) -> Unit)? = null
    /** The phone's speech recognizer for the chat's 🎤 (it shows its own listening screen; offline where the phone has the language). */
    private var onHeard: ((String?) -> Unit)? = null
    private val recognize = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val heard = r.data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        onHeard?.invoke(if (r.resultCode == RESULT_OK) heard else null); onHeard = null
    }
    private fun listen(cb: (String?) -> Unit) {
        onHeard = cb
        val i = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(android.speech.RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Speak to Cursed_Ai")
        try { recognize.launch(i) } catch (e: Exception) { onHeard = null; cb(null); android.widget.Toast.makeText(this, "This phone has no speech recognizer (install or enable Google voice typing).", android.widget.Toast.LENGTH_LONG).show() }
    }

    private val pickDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> onPicked?.invoke(uri); onPicked = null }
    private var tabBar: LinearLayout? = null

    /** The voice assistant asks the page for the microphone; the phone asks you once, then the page may listen. */
    private var micRequest: PermissionRequest? = null
    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        micRequest?.let { if (ok) it.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else it.deny() }
        micRequest = null
    }
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    /** Lets the studio page raise a real Android notification (a finished render, an error) while the app is in the background. */
    inner class Bridge {
        @JavascriptInterface
        fun notify(title: String, body: String) = notifyRich(title, body, "", "")

        /**
         * A notification for a finished job: with the picture when there is one (`thumbPath` on the PC, fetched over
         * the same pinned connection), and opening the app on `tab` when tapped.
         */
        @JavascriptInterface
        fun notifyRich(title: String, body: String, tab: String, thumbPath: String) {
            thread {
                val picture = if (thumbPath.isNotEmpty() && pcUsed != null) try {
                    val bytes = openPc(thumbPath).run { connectTimeout = 5000; readTimeout = 15000; inputStream.use { it.readBytes() }.also { disconnect() } }
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    var scale = 1
                    while (bounds.outWidth / scale > 1024 || bounds.outHeight / scale > 1024) scale *= 2
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = scale })
                } catch (e: Exception) { null } else null
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("cursed_jobs", "Renders and jobs", NotificationManager.IMPORTANCE_DEFAULT))
                val id = (System.currentTimeMillis() % 100000).toInt()
                val launch = Intent(this@MainActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("open_tab", tab)
                val open = PendingIntent.getActivity(this@MainActivity, id, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                val b = Notification.Builder(this@MainActivity, "cursed_jobs").setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(body).setContentIntent(open).setAutoCancel(true)
                if (picture != null) b.setLargeIcon(picture).setStyle(Notification.BigPictureStyle().bigPicture(picture).setSummaryText(body))
                else b.setStyle(Notification.BigTextStyle().bigText(body))
                if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) nm.notify(id, b.build())
            }
        }
    }

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
        // Android reuses idle connections; one the phone's engine (or the PC) has already closed then fails with
        // "unexpected end of stream". Every request opens its own connection instead.
        System.setProperty("http.keepAlive", "false")
        webView = buildWebView()
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
        pendingShare = ShareIn.urisOf(intent)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#0E0E10")) }
        setContentView(root)

        // The last choice is reopened straight away; back returns here to change it.
        when (prefs.getString("mode", "")) {
            "pc" -> prefs.getString("pc_address", "")?.takeIf { it.isNotBlank() }?.let { connect(it, prefs.getString("pc_code", "") ?: "", auto = true) } ?: showChooser()
            "phone" -> openOnPhone()
            else -> showChooser()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("open_tab")?.takeIf { it.isNotEmpty() && tab != null }?.let { openTab(it) }
        val shared = ShareIn.urisOf(intent)
        if (shared.isEmpty()) return
        pendingShare = shared
        takeShare()
    }

    /** Sends shared files on to the PC, or says a PC is needed first. */
    private fun takeShare() {
        if (pendingShare.isEmpty()) return
        if (pcUsed == null) {
            if (tab != null && !pcMode) { android.widget.Toast.makeText(this, "Sharing sends pictures to your PC. Connect to your PC first.", android.widget.Toast.LENGTH_LONG).show(); pendingShare = emptyList() }
            return // still connecting, or on the connect screen: sent once connected
        }
        val files = pendingShare
        pendingShare = emptyList()
        ShareIn(this) { openPc(it) }.handle(files)
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

        addJavascriptInterface(Bridge(), "CursedAndroid")
        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                val r = request ?: return
                if (!r.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { r.deny(); return }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) r.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                else { micRequest = r; askMic.launch(Manifest.permission.RECORD_AUDIO) }
            }
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
            // The PC's secure address uses a certificate the PC made itself. It is trusted only if it is the one
            // remembered when this phone first connected (trust on first use); anything else is refused.
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                val pin = prefs.getString("pc_cert", null)
                val der = error?.certificate?.let { SslCertificate.saveState(it).getByteArray("x509-certificate") }
                if (pcMode && pin != null && der != null && fingerprint(der) == pin) handler?.proceed() else handler?.cancel()
            }
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
        tab = null
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
        val address = field("PC address, e.g. 192.168.1.5", prefs.getString("pc_address", "") ?: "", InputType.TYPE_TEXT_VARIATION_URI)
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

    /** "192.168.1.5" -> https://192.168.1.5:3443 (the PC's secure address, needed for the microphone); a full address is kept. */
    private fun baseUrl(input: String): String {
        var a = input.trim().trimEnd('/')
        if (!a.startsWith("http://") && !a.startsWith("https://")) a = "https://" + a.removeSuffix(":3000") // an address saved before the secure one existed
        val hostPart = a.substringAfter("://").substringBefore("/")
        if (!hostPart.contains(":")) a += if (a.startsWith("https://")) ":3443" else ":3000"
        return a
    }

    /** The plain address of the same PC, for a PC app that has no secure address yet. */
    private fun plainUrl(base: String): String? =
        if (base.startsWith("https://") && base.endsWith(":3443")) "http://" + base.removePrefix("https://").removeSuffix(":3443") + ":3000" else null

    private fun fingerprint(der: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }

    /**
     * Opens a connection; for https, accepts the PC's own certificate if it is the remembered one, or - when none is
     * remembered yet - any, reporting what it saw in `seen` so it can be remembered after the code is accepted.
     */
    private fun open(url: URL, seen: Array<String?>): HttpURLConnection {
        val c = url.openConnection() as HttpURLConnection
        if (c is HttpsURLConnection) {
            val pin = prefs.getString("pc_cert", null)
            val trust = object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
                override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                    val fp = fingerprint(chain[0].encoded)
                    if (pin != null && fp != pin) throw java.security.cert.CertificateException("This is not the PC this phone connected to before.")
                    seen[0] = fp
                }
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            }
            c.sslSocketFactory = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }.socketFactory
            c.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true } // the certificate itself is pinned above
        }
        return c
    }

    /** Checks the PC answers and accepts the code, then opens the studio in the WebView (the login sets the cookie). */
    private fun connect(address: String, code: String, auto: Boolean, onFail: (String) -> Unit = { showChooser(it) }) {
        val base = baseUrl(address)
        // Typing the address in by hand starts afresh: the PC's certificate is learned again on this connect.
        if (!auto) prefs.edit().remove("pc_cert").apply()
        if (auto) {
            // Reopening the last PC: say what is happening while it answers.
            root.removeAllViews()
            root.addView(text("Connecting to your PC...", 15f, "#D4D4D8", topDp = 200))
        }
        thread {
            val seen = arrayOfNulls<String>(1)
            var used = base
            val result: Pair<Boolean, String> = try {
                val status = try {
                    ask(base, code, seen)
                } catch (e: java.io.IOException) {
                    // An older PC app has no secure address: use the plain one (no microphone on the phone then).
                    val plain = plainUrl(base) ?: throw e
                    if (e is javax.net.ssl.SSLException && e.cause is java.security.cert.CertificateException) throw e
                    used = plain
                    ask(plain, code, seen)
                }
                when (status) {
                    302, 200 -> if (status == 302) true to "" else false to "The PC answered, but it wants an access code. Type the 6-digit code from Settings > General > Phone & other devices."
                    401 -> false to "That code is not right. Check Settings > General > Phone & other devices on the PC (a new code replaces the old one)."
                    403 -> false to "Phone access is switched off on the PC. Turn it on in Settings > General > Phone & other devices."
                    429 -> false to "Too many wrong codes. Wait a minute and try again."
                    else -> false to "The PC answered with an unexpected error ($status)."
                }
            } catch (e: javax.net.ssl.SSLException) {
                false to "The PC's certificate changed, so this may not be your PC. If you reinstalled the app or moved the studio to another PC, type the address and code again and tap Connect."
            } catch (e: Exception) {
                false to "Could not reach $base. Check that the PC app is running, the phone is on the same Wi-Fi, and Windows allows the port (the command is shown in Settings > Phone & other devices)."
            }
            handler.post {
                if (result.first) {
                    val e = prefs.edit().putString("mode", "pc").putString("pc_address", address).putString("pc_code", code)
                    if (seen[0] != null && prefs.getString("pc_cert", null) == null) e.putString("pc_cert", seen[0])
                    e.apply()
                    pcMode = true
                    pcUsed = used
                    showShell("$used/__phone-login?code=" + URLEncoder.encode(code, "UTF-8"))
                } else if (auto) {
                    showChooser(result.second)
                } else onFail(result.second)
            }
        }
    }

    private fun ask(base: String, code: String, seen: Array<String?>): Int {
        val c = open(URL("$base/__phone-login?code=" + URLEncoder.encode(code, "UTF-8")), seen).apply { connectTimeout = 5000; readTimeout = 6000; instanceFollowRedirects = false }
        val status = c.responseCode
        c.disconnect()
        return status
    }

    private fun openOnPhone() {
        prefs.edit().putString("mode", "phone").apply()
        pcMode = false
        pcUsed = null
        startForegroundService(Intent(this, CursedRuntimeService::class.java))
        showShell(null) // the studio pages need the PC; on the phone alone there is Chat and Settings
    }

    /** Requests to the connected PC carry the access code and use its pinned certificate. */
    private fun openPc(path: String): HttpURLConnection =
        open(URL((pcUsed ?: throw IllegalStateException("Not connected to a PC.")) + path), arrayOfNulls(1)).apply {
            setRequestProperty("x-cursed-code", prefs.getString("pc_code", "") ?: "")
        }

    private fun phoneEngine() { startForegroundService(Intent(this, CursedRuntimeService::class.java)) }

    /** The studio pages behind each web tab (the page listens for this event to switch). */
    private val webTabs = mapOf("image" to "image", "video" to "video", "series" to "series")

    /** The bottom bar: native Chat plus the studio's pages. Connected to a PC: Chat, Image, Video, Series, More; on the phone alone: Chat and Settings. */
    private fun showShell(webUrl: String?) {
        root.removeAllViews()
        val content = FrameLayout(this)
        shellContent = content
        root.addView(content, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        content.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        if (webUrl != null) webView.loadUrl(webUrl)
        val chat = NativeChat(this, prefs, { pcUsed }, { openPc(it) }, { phoneEngine() }, { selectTab("settings") }, { listen(it) }).view()
        chatView = chat
        content.addView(chat, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val ps = PhoneSettings(this, prefs, { cb -> onPicked = cb; pickDocument.launch(arrayOf("*/*")) }, { selectTab("chat") }, { pcMode = false; showChooser() })
        settings = ps
        settingsView = ps.view().also { content.addView(it, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)) }

        val tabs = if (pcMode) listOf("chat" to "Chat", "image" to "Image", "video" to "Video", "series" to "Series", "more" to "More") else listOf("chat" to "Chat", "settings" to "Settings")
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(Color.parseColor("#141416")) }
        tabBar = bar
        for ((id, label) in tabs) bar.addView(TextView(this).apply {
            text = label; tag = id; textSize = 13f; gravity = Gravity.CENTER; setPadding(0, dp(14), 0, dp(14))
            setOnClickListener { selectTab(id) }
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(bar)
        selectTab("chat")
        takeShare()
    }

    /** Opens the studio page a notification is about: one of the bar's tabs, or any other page under More. */
    private fun openTab(page: String) {
        if (page == "chat") return selectTab("chat")
        if (page in webTabs) return selectTab(page)
        selectTab("more")
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('cursed:goto',{detail:{tab:'${page.replace("'", "")}'}}))", null)
    }

    private fun selectTab(id: String) {
        tab = id
        val onChat = id == "chat"
        val onSettings = id == "settings"
        chatView?.visibility = if (onChat) View.VISIBLE else View.GONE
        settingsView?.visibility = if (onSettings) View.VISIBLE else View.GONE
        if (onSettings) settings?.refresh()
        webView.visibility = if (onChat || onSettings) View.GONE else View.VISIBLE
        showingWeb = !onChat && !onSettings
        webTabs[id]?.let { webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('cursed:goto',{detail:{tab:'$it'}}))", null) }
        tabBar?.let { bar ->
            for (i in 0 until bar.childCount) (bar.getChildAt(i) as TextView).apply {
                val hasSettingsTab = (0 until bar.childCount).any { bar.getChildAt(it).tag == "settings" }
                val on = tag == id || (id == "settings" && !hasSettingsTab && tag == "chat")
                setTextColor(Color.parseColor(if (on) "#FFFFFF" else "#71717A"))
                setTypeface(null, if (on) Typeface.BOLD else Typeface.NORMAL)
                setBackgroundColor(Color.parseColor(if (on) "#27272A" else "#141416"))
            }
        }
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
            tab == "settings" -> selectTab("chat")
            tab != null && tab != "chat" && webView.canGoBack() -> webView.goBack()
            tab != null && tab != "chat" -> selectTab("chat")
            // From the chat, back returns to the connect screen (to change the PC or the mode).
            tab == "chat" -> { prefs.edit().remove("mode").apply(); pcMode = false; showChooser() }
            else -> super.onBackPressed()
        }
    }
}
