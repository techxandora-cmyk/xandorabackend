package com.xandorahandheld

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class DataWedgeModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private var receiverRegistered = false

  private val scanReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action != SCAN_ACTION) {
          return
        }

        val payload = Arguments.createMap().apply {
          putString("data", intent.getStringExtra(EXTRA_DATA_STRING))
          putString("source", intent.getStringExtra(EXTRA_SOURCE))
          putString("labelType", intent.getStringExtra(EXTRA_LABEL_TYPE))
          putString("decodedMode", intent.getStringExtra(EXTRA_DECODED_MODE))
          putString("deviceId", intent.getStringExtra(EXTRA_DEVICE_ID))
          putString("deviceName", intent.getStringExtra(EXTRA_DEVICE_NAME))
          putDouble("receivedAt", System.currentTimeMillis().toDouble())
        }

        sendEvent(EVENT_SCAN, payload)
      }
    }

  override fun getName(): String = MODULE_NAME

  override fun initialize() {
    super.initialize()
    registerReceiverIfNeeded()
  }

  override fun invalidate() {
    unregisterReceiverIfNeeded()
    super.invalidate()
  }

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(isDataWedgeInstalled())
  }

  @ReactMethod
  fun configureProfile(promise: Promise) {
    if (!isDataWedgeInstalled()) {
      promise.reject(
        "DATAWEDGE_UNAVAILABLE",
        "Zebra DataWedge is not installed on this Android device.",
      )
      return
    }

    try {
      registerReceiverIfNeeded()

      val appAssociation = Bundle().apply {
        putString("PACKAGE_NAME", reactContext.packageName)
        putStringArrayList("ACTIVITY_LIST", arrayListOf("*"))
      }

      val barcodeConfig = Bundle().apply {
        putString("PLUGIN_NAME", "BARCODE")
        putString("RESET_CONFIG", "false")
        putBundle(
          "PARAM_LIST",
          Bundle().apply {
            putString("scanner_input_enabled", "true")
          },
        )
      }

      val rfidConfig = Bundle().apply {
        putString("PLUGIN_NAME", "RFID")
        putString("RESET_CONFIG", "true")
        putBundle(
          "PARAM_LIST",
          Bundle().apply {
            putString("rfid_input_enabled", "true")
            putString("rfid_beeper_enable", "true")
            putString("rfid_led_enable", "true")
            putString("rfid_memory_bank", "4")
            putString("rfid_filter_duplicate_tags", "true")
            putString("rfid_hardware_trigger_enabled", "true")
            putString("rfid_trigger_mode", "0")
            putString("rfid_tag_read_duration", "250")
          },
        )
      }

      val intentConfig = Bundle().apply {
        putString("PLUGIN_NAME", "INTENT")
        putString("RESET_CONFIG", "true")
        putBundle(
          "PARAM_LIST",
          Bundle().apply {
            putString("intent_output_enabled", "true")
            putString("intent_action", SCAN_ACTION)
            putString("intent_category", Intent.CATEGORY_DEFAULT)
            putString("intent_delivery", "2")
          },
        )
      }

      val keystrokeConfig = Bundle().apply {
        putString("PLUGIN_NAME", "KEYSTROKE")
        putString("RESET_CONFIG", "true")
        putBundle(
          "PARAM_LIST",
          Bundle().apply {
            putString("keystroke_output_enabled", "false")
          },
        )
      }

      val profileConfig = Bundle().apply {
        putString("PROFILE_NAME", PROFILE_NAME)
        putString("PROFILE_ENABLED", "true")
        putString("CONFIG_MODE", "OVERWRITE")
        putParcelableArray("PLUGIN_CONFIG", arrayOf(barcodeConfig, rfidConfig, intentConfig, keystrokeConfig))
        putParcelableArray("APP_LIST", arrayOf(appAssociation))
      }

      val intent = Intent(DATAWEDGE_API_ACTION).apply {
        putExtra(DATAWEDGE_SET_CONFIG, profileConfig)
      }

      reactContext.sendBroadcast(intent)

      val response = Arguments.createMap().apply {
        putBoolean("ok", true)
        putString("profileName", PROFILE_NAME)
        putString("intentAction", SCAN_ACTION)
      }

      promise.resolve(response)
    } catch (error: Exception) {
      promise.reject(
        "DATAWEDGE_CONFIG_FAILED",
        error.message ?: "Failed to configure Zebra DataWedge profile.",
        error,
      )
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for React Native event emitter support.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for React Native event emitter support.
  }

  private fun registerReceiverIfNeeded() {
    if (receiverRegistered) {
      return
    }

    val filter = IntentFilter(SCAN_ACTION).apply {
      addCategory(Intent.CATEGORY_DEFAULT)
    }

    ContextCompat.registerReceiver(
      reactContext,
      scanReceiver,
      filter,
      ContextCompat.RECEIVER_EXPORTED,
    )

    receiverRegistered = true
  }

  private fun unregisterReceiverIfNeeded() {
    if (!receiverRegistered) {
      return
    }

    reactContext.unregisterReceiver(scanReceiver)
    receiverRegistered = false
  }

  private fun sendEvent(eventName: String, params: com.facebook.react.bridge.WritableMap) {
    if (!reactContext.hasActiveCatalystInstance()) {
      return
    }

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, params)
  }

  @Suppress("DEPRECATION")
  private fun isDataWedgeInstalled(): Boolean {
    return try {
      reactContext.packageManager.getPackageInfo(DATAWEDGE_PACKAGE, 0)
      true
    } catch (_: Exception) {
      false
    }
  }

  companion object {
    const val MODULE_NAME = "XandoraDataWedge"
    const val EVENT_SCAN = "xandora.datawedge.scan"
    const val PROFILE_NAME = "XandoraRFID"
    const val SCAN_ACTION = "com.xandorahandheld.ACTION_DATAWEDGE_SCAN"

    private const val DATAWEDGE_PACKAGE = "com.symbol.datawedge"
    private const val DATAWEDGE_API_ACTION = "com.symbol.datawedge.api.ACTION"
    private const val DATAWEDGE_SET_CONFIG = "com.symbol.datawedge.api.SET_CONFIG"

    private const val EXTRA_DATA_STRING = "com.symbol.datawedge.data_string"
    private const val EXTRA_SOURCE = "com.symbol.datawedge.source"
    private const val EXTRA_LABEL_TYPE = "com.symbol.datawedge.label_type"
    private const val EXTRA_DECODED_MODE = "com.symbol.datawedge.decoded_mode"
    private const val EXTRA_DEVICE_ID = "com.symbol.datawedge.device_id"
    private const val EXTRA_DEVICE_NAME = "com.symbol.datawedge.device_name"
  }
}
