package com.sunayna.runtime.inference

import com.sunayna.runtime.jni.LlamaNative
import android.util.Base64
import android.util.Log

object MultimodalManager {
    
    fun processVisionInput(modelHandler: Long, base64Image: String): String {
        try {
            val imageData = Base64.decode(base64Image, Base64.DEFAULT)
            Log.i("MultimodalManager", "Encoding image for vision reasoning...")
            return LlamaNative.processImage(modelHandler, imageData)
        } catch (e: Exception) {
            Log.e("MultimodalManager", "Vision processing failed: ${e.message}")
            return "{\"error\": \"${e.message}\"}"
        }
    }

    fun handleVoiceTranscription(modelHandler: Long, pcmData: ShortArray): String {
        return LlamaNative.transcribeAudio(modelHandler, pcmData)
    }
}
