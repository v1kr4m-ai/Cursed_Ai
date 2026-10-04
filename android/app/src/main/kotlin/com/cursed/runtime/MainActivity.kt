package com.cursed.runtime

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.util.Log
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import com.cursed.runtime.services.CursedRuntimeService

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val handler = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.databaseEnabled = true
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                    Log.e("Cursed", "WebView Error ($errorCode): $description")
                    if (failingUrl?.contains("127.0.0.1") == true) {
                        // Retry after 2 seconds if local server not ready
                        handler.postDelayed({ view?.loadUrl(failingUrl) }, 2000)
                    }
                }
            }
        }

        setContentView(webView)

        // Start background engine service
        startForegroundService(Intent(this, CursedRuntimeService::class.java))

        // Point to the local Ktor server
        webView.loadUrl("http://127.0.0.1:11434/index.html")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
