package com.sunayna.runtime.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.os.BatteryManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.sunayna.runtime.api.ApiServer
import com.sunayna.runtime.inference.ModelManager

/**
 * The core background service that hosts the Sunayna Local AI Engine.
 * Enhanced in Phase 9/10 for foreground persistence, lifecycle management, and battery-aware scheduling.
 */
class SunaynaRuntimeService : Service() {
    private var apiServer: ApiServer? = null
    private val CHANNEL_ID = "SunaynaRuntimeChannel"
    private val NOTIFICATION_ID = 101

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val batteryPct = level * 100 / scale.toFloat()

            Log.d("SunaynaRuntime", "Battery check: $batteryPct%")

            if (batteryPct < 15.0f) {
                ModelManager.setPerformanceMode(ModelManager.PerformanceMode.BATTERY_SAVER)
                updateStatus("Battery Low: Saver Mode Active")
            } else if (batteryPct > 30.0f && ModelManager.currentPerformanceMode == ModelManager.PerformanceMode.BATTERY_SAVER) {
                ModelManager.setPerformanceMode(ModelManager.PerformanceMode.BALANCED)
                updateStatus("Engine Warm")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.i("SunaynaRuntime", "Initializing Local AI Service (Phase 10)...")

        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification("Engine Ready"))

        // Register battery monitor
        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))

        // Start the localhost API server
        ModelManager.configure(applicationContext)
        apiServer = ApiServer(context = this)
        apiServer?.start()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        Log.w("SunaynaRuntime", "System Memory Pressure: level $level")

        if (level >= TRIM_MEMORY_MODERATE) {
            // Background caching: we keep the model warm but shed vision/aux heads if needed
            Log.i("SunaynaRuntime", "Warm Retention: Compacting native cache...")
            // In a real app, we'd call a native compact() method
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Sunayna AI Engine",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }

    private fun createNotification(status: String): Notification {
        val notificationIntent = Intent(this, com.sunayna.runtime.MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Sunayna Local AI")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    fun updateStatus(status: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, createNotification(status))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == "STOP_ENGINE") {
            ModelManager.unloadModel()
            stopSelf()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        Log.i("SunaynaRuntime", "Shutting down Local AI Service...")
        unregisterReceiver(batteryReceiver)
        apiServer?.stop()
        ModelManager.unloadModel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
