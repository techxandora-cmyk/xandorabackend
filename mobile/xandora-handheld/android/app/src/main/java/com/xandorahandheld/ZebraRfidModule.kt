package com.xandorahandheld

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.zebra.rfid.api3.Antennas
import com.zebra.rfid.api3.ENUM_TRANSPORT
import com.zebra.rfid.api3.ENUM_TRIGGER_MODE
import com.zebra.rfid.api3.HANDHELD_TRIGGER_EVENT_TYPE
import com.zebra.rfid.api3.INVENTORY_STATE
import com.zebra.rfid.api3.InvalidUsageException
import com.zebra.rfid.api3.OperationFailureException
import com.zebra.rfid.api3.RFIDReader
import com.zebra.rfid.api3.ReaderDevice
import com.zebra.rfid.api3.Readers
import com.zebra.rfid.api3.RfidEventsListener
import com.zebra.rfid.api3.RfidReadEvents
import com.zebra.rfid.api3.RfidStatusEvents
import com.zebra.rfid.api3.SESSION
import com.zebra.rfid.api3.SL_FLAG
import com.zebra.rfid.api3.START_TRIGGER_TYPE
import com.zebra.rfid.api3.STATUS_EVENT_TYPE
import com.zebra.rfid.api3.STOP_TRIGGER_TYPE
import com.zebra.rfid.api3.TagData
import com.zebra.rfid.api3.TriggerInfo
import java.lang.IllegalStateException
import java.lang.reflect.Array as ReflectArray
import java.lang.reflect.InvocationTargetException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class ZebraRfidModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), RfidEventsListener {

  private val executor = Executors.newSingleThreadExecutor()
  private val readPollExecutor = Executors.newSingleThreadScheduledExecutor()

  @Volatile private var readersManager: Readers? = null
  @Volatile private var currentReader: RFIDReader? = null
  @Volatile private var currentReaderDevice: ReaderDevice? = null
  @Volatile private var inventoryRunning = false
  @Volatile private var inventoryStartedAt = 0L
  @Volatile private var readPollFuture: ScheduledFuture<*>? = null
  @Volatile private var readNotifyFiredCount = 0
  @Volatile private var availableReadersCallCount = 0L
  @Volatile private var lastAvailableReadersCallAt = 0L
  private val recentNativeTagEmits = ConcurrentHashMap<String, Long>()

  override fun getName(): String = MODULE_NAME

  override fun invalidate() {
    try {
      disconnectInternal(emitStatus = false)
      readersManager?.let { manager ->
        runCatching { manager.Dispose() }
      }
    } finally {
      stopReadPolling()
      executor.shutdownNow()
      readPollExecutor.shutdownNow()
      super.invalidate()
    }
  }

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(isSdkPresent())
  }

  @ReactMethod
  fun getAvailableReaders(promise: Promise) {
    executor.execute {
      try {
        if (!isSdkPresent()) {
          promise.resolve(Arguments.createArray())
          return@execute
        }

        Log.d(TAG, "getAvailableReaders(): requested from JS")
        val devices = getAvailableReadersInternal()
        val out = Arguments.createArray()
        devices.forEach { device ->
          out.pushMap(mapReaderDevice(device, isReaderDeviceConnected(device)))
        }
        Log.d(TAG, "getAvailableReaders(): returning ${devices.size} devices")
        promise.resolve(out)
      } catch (error: Throwable) {
        promise.reject("ZEBRA_RFID_LIST_FAILED", unwrap(error).message, unwrap(error))
      }
    }
  }

  @ReactMethod
  fun connect(address: String?, promise: Promise) {
    executor.execute {
      try {
        if (!isSdkPresent()) {
          promise.reject(
            "ZEBRA_RFID_UNAVAILABLE",
            "Zebra RFID SDK is not bundled in this app build.",
          )
          return@execute
        }

        val normalizedAddress = (address ?: "").trim()
        if (normalizedAddress.isEmpty()) {
          promise.reject("ZEBRA_RFID_ADDRESS_REQUIRED", "Reader address is required.")
          return@execute
        }

        Log.d(TAG, "connect(): requested address=$normalizedAddress")
        // Dispose and recreate the Readers manager so each connect starts clean.
        // Reusing a manager across attempts accumulates stale BT state that causes
        // the first perform() to timeout even though connect() appears to succeed.
        readersManager?.let {
          Log.d(TAG, "connect(): disposing previous manager")
          runCatching { it.Dispose() }
          Thread.sleep(300)
        }
        readersManager = null

        val available = getAvailableReadersInternal()
        Log.d(
          TAG,
          "connect(): found ${available.size} readers: " +
            available.joinToString { "${it.name}@${readerAddress(it)}" },
        )
        val device = available.firstOrNull { d ->
          normalizedAddress.equals(readerAddress(d), ignoreCase = true)
        } ?: run {
          val addressToken = normalizedAddress.replace(Regex("[^A-Fa-f0-9]"), "").uppercase()
          if (addressToken.length >= 8) {
            available.firstOrNull { d ->
              val nameToken = (d.name ?: "").replace(Regex("[^A-Fa-f0-9]"), "").uppercase()
              val addrToken = readerAddress(d).replace(Regex("[^A-Fa-f0-9]"), "").uppercase()
              nameToken.contains(addressToken) || addrToken.contains(addressToken) ||
                addressToken.contains(addrToken.takeLast(8))
            }
          } else null
        } ?: throw IllegalStateException(
          "Zebra reader not found. Requested: $normalizedAddress. " +
          "Available: ${available.joinToString { "${it.name}@${readerAddress(it)}" }.ifBlank { "none" }}"
        )

        if (
          currentReaderDevice != null &&
          currentReaderDevice !== device &&
          !normalizedAddress.equals(readerAddress(currentReaderDevice), ignoreCase = true)
        ) {
          disconnectInternal(emitStatus = false)
        }

        val reader = device.rfidReader
          ?: throw IllegalStateException("RFID reader handle is not available.")

        Log.d(TAG, "connect(): selected ${device.name}@${readerAddress(device)}")
        connectReaderWithRecovery(reader)
        configureConnectedReader(reader)

        currentReaderDevice = device
        currentReader = reader
        inventoryRunning = false

        Log.d(TAG, "connect(): success ${device.name}@${readerAddress(device)}")
        emitStatus("connected", mapReaderDevice(device, connected = true))
        promise.resolve(mapReaderDevice(device, connected = true))
      } catch (error: Throwable) {
        val u = unwrap(error)
        val results = when (u) {
          is OperationFailureException -> " results=${u.results}"
          else -> ""
        }
        val msg = u.message?.ifBlank { null } ?: u.javaClass.simpleName
        Log.e(TAG, "connect(): failed ${u.javaClass.simpleName}$results msg=$msg")
        val failPayload = Arguments.createMap().apply {
          putString("status", "connect_failed")
          putString("error", msg)
          putBoolean("inventoryRunning", false)
          putDouble("emittedAt", System.currentTimeMillis().toDouble())
        }
        sendEvent(EVENT_STATUS, failPayload)
        promise.reject("ZEBRA_RFID_CONNECT_FAILED", msg, unwrap(error))
      }
    }
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    executor.execute {
      try {
        disconnectInternal(emitStatus = true)
        promise.resolve(true)
      } catch (error: Throwable) {
        promise.reject("ZEBRA_RFID_DISCONNECT_FAILED", unwrap(error).message, unwrap(error))
      }
    }
  }

  @ReactMethod
  fun startInventory(promise: Promise) {
    executor.execute {
      try {
        startInventoryInternal()
        promise.resolve(true)
      } catch (error: Throwable) {
        val u = unwrap(error)
        val msg = when (u) {
          is OperationFailureException ->
            "OperationFailure[${u.results}] ${u.message ?: ""} | ${u}".trim()
          is InvalidUsageException ->
            "InvalidUsage: ${u.message ?: u.toString()}"
          else ->
            "${u.javaClass.simpleName}: ${u.message ?: u.toString()}"
        }
        emitStatus("inventory_start_failed", connectedPayload())
        promise.reject("ZEBRA_RFID_START_FAILED", msg, u)
      }
    }
  }

  @ReactMethod
  fun stopInventory(promise: Promise) {
    executor.execute {
      try {
        stopInventoryInternal()
        promise.resolve(true)
      } catch (error: Throwable) {
        promise.reject("ZEBRA_RFID_STOP_FAILED", unwrap(error).message, unwrap(error))
      }
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

  override fun eventReadNotify(readEvents: RfidReadEvents?) {
    readNotifyFiredCount += 1
    // Use readPollExecutor so getReadTags(100) never blocks the main executor.
    // The main executor stays free to restart inventory immediately on INVENTORY_STOP_EVENT.
    readPollExecutor.execute { runCatching { handleReadEvent() } }
  }

  override fun eventStatusNotify(statusEvents: RfidStatusEvents?) {
    handleStatusEvent(statusEvents)
  }

  private fun getAvailableReadersInternal(): List<ReaderDevice> {
    val now = System.currentTimeMillis()
    val previous = lastAvailableReadersCallAt
    val delta = if (previous == 0L) -1L else now - previous
    lastAvailableReadersCallAt = now
    availableReadersCallCount += 1
    Log.d(
      TAG,
      "getAvailableReadersInternal() #$availableReadersCallCount dt=" +
        if (delta < 0) "first" else "${delta}ms",
    )
    val manager = ensureReadersManager()
    val devices = runCatching { manager.GetAvailableRFIDReaderList() }
      .getOrNull()
      ?.filter { readerAddress(it).isNotBlank() }
      ?: emptyList()
    Log.d(TAG, "getAvailableReadersInternal(): SDK returned ${devices.size} readers")
    return devices
  }

  private fun ensureReadersManager(): Readers {
    val existing = readersManager
    if (existing != null) {
      Log.d(TAG, "ensureReadersManager(): reusing existing manager")
      return existing
    }

    Log.d(TAG, "ensureReadersManager(): creating Readers manager with ${READER_TRANSPORT_ORDER.first()}")
    val instance = Readers(requireSdkContext(), READER_TRANSPORT_ORDER.first())
    readersManager = instance
    return instance
  }


  private fun connectReaderWithRecovery(reader: RFIDReader) {
    try {
      if (!reader.isConnected) {
        Log.d(TAG, "connectReaderWithRecovery(): calling reader.connect()")
        reader.connect()
        Log.d(TAG, "connectReaderWithRecovery(): reader.connect() returned")
      }
    } catch (error: Throwable) {
      val unwrapped = unwrap(error)
      if (isRegionNotConfigured(unwrapped)) {
        applyDefaultRegion(reader)
        if (!reader.isConnected) {
          reader.connect()
        }
      } else {
        throw unwrapped
      }
    }
    // Give the BT SPP link time to fully initialize before sending RFID commands.
    Log.d(TAG, "connectReaderWithRecovery(): sleeping 600ms for SPP stabilization")
    Thread.sleep(600)
  }

  private fun configureConnectedReader(reader: RFIDReader) {
    Log.d(TAG, "configureConnectedReader(): start")
    runCatching { reader.Events.removeEventsListener(this) }
    reader.Events.addEventsListener(this)
    reader.Events.setHandheldEvent(true)
    reader.Events.setTagReadEvent(true)
    reader.Events.setAttachTagDataWithReadEvent(false)
    applyImmediateTriggers(reader)
    reader.Config.setTriggerMode(ENUM_TRIGGER_MODE.RFID_MODE, true)
    applyInventoryDefaults(reader)
    Log.d(TAG, "configureConnectedReader(): complete")
  }

  private fun applyImmediateTriggers(reader: RFIDReader) {
    val triggerInfo = TriggerInfo()
    triggerInfo.StartTrigger.setTriggerType(START_TRIGGER_TYPE.START_TRIGGER_TYPE_IMMEDIATE)
    triggerInfo.StopTrigger.setTriggerType(STOP_TRIGGER_TYPE.STOP_TRIGGER_TYPE_IMMEDIATE)
    reader.Config.setStartTrigger(triggerInfo.StartTrigger)
    reader.Config.setStopTrigger(triggerInfo.StopTrigger)
  }

  private fun applyInventoryDefaults(reader: RFIDReader) {
    runCatching { reader.Actions.PreFilters.deleteAll() }
    runCatching { applyAntennaDefaults(reader) }
    runCatching { applySingulationDefaults(reader) }
  }

  private fun applyAntennaDefaults(reader: RFIDReader) {
    val antennaConfig = reader.Config.Antennas.getAntennaRfConfig(1)
    val powerLevels = reader.ReaderCapabilities.getTransmitPowerLevelValues()
    val maxPowerIndex = (ReflectArray.getLength(powerLevels) - 1).coerceAtLeast(0)

    antennaConfig.setTransmitPowerIndex(maxPowerIndex)
    antennaConfig.setrfModeTableIndex(0)
    antennaConfig.setTari(0)
    reader.Config.Antennas.setAntennaRfConfig(1, antennaConfig)
  }

  private fun applySingulationDefaults(reader: RFIDReader) {
    val singulation = reader.Config.Antennas.getSingulationControl(1)
    singulation.setSession(SESSION.SESSION_S0)
    singulation.Action.setInventoryState(INVENTORY_STATE.INVENTORY_STATE_A)
    singulation.Action.setSLFlag(SL_FLAG.SL_ALL)
    reader.Config.Antennas.setSingulationControl(1, singulation)
  }

  private fun startInventoryInternal(forceRestart: Boolean = false) {
    val reader = currentReader ?: throw IllegalStateException("Connect a Zebra reader first.")
    if (inventoryRunning && !forceRestart) {
      return
    }

    // Only stop if inventory is actually running — avoids an unnecessary BT round-trip
    // on the first call (and reduces press-to-scan latency on trigger presses).
    if (inventoryRunning) {
      runCatching { reader.Actions.Inventory.stop() }
      inventoryRunning = false
    }

    Log.d(TAG, "startInventory: calling perform()")
    try {
      reader.Actions.Inventory.perform()
    } catch (performError: Throwable) {
      val u = unwrap(performError)
      Log.e(TAG, "startInventory: perform() threw: $u")
      if (isRegionNotConfigured(u)) {
        applyDefaultRegion(reader)
        reader.Actions.Inventory.perform()
      } else {
        throw u
      }
    }
    Log.d(TAG, "startInventory: perform() returned OK, inventoryRunning=true")
    inventoryRunning = true
    inventoryStartedAt = System.currentTimeMillis()
    readNotifyFiredCount = 0
    recentNativeTagEmits.clear()
    startReadPolling()
    emitStatus("inventory_started", connectedPayload())
  }

  private fun stopInventoryInternal(force: Boolean = false) {
    if (!inventoryRunning) return

    // For trigger-release: enforce minimum scan window without blocking the executor.
    // Capture startedAt so the scheduled stop can verify it's still the same session —
    // if a new inventory started in the meantime, the old scheduled stop is a no-op.
    if (!force) {
      val startedAt = inventoryStartedAt
      val elapsed = System.currentTimeMillis() - startedAt
      val remaining = MIN_INVENTORY_DURATION_MS - elapsed
      if (remaining > 0) {
        readPollExecutor.schedule({
          executor.execute {
            runCatching {
              if (inventoryStartedAt == startedAt) stopInventoryInternal(force = true)
            }
          }
        }, remaining, TimeUnit.MILLISECONDS)
        return
      }
    }

    val reader = currentReader ?: return
    // Clear the flag BEFORE stop() so the INVENTORY_STOP_EVENT that fires in response
    // sees inventoryRunning=false and does not restart the inventory.
    inventoryRunning = false
    runCatching { reader.Actions.Inventory.stop() }
    stopReadPolling()
    emitStatus("inventory_stopped", connectedPayload())
  }

  private fun disconnectInternal(emitStatus: Boolean) {
    stopInventoryInternal(force = true)

    val reader = currentReader
    currentReader = null
    currentReaderDevice = null

    if (reader != null) {
      runCatching { reader.disconnect() }
    }

    if (emitStatus) {
      emitStatus("disconnected", null)
    }
  }

  private fun startReadPolling() {
    stopReadPolling()
    Log.d(TAG, "startReadPolling(): fallback interval=${READ_POLL_INTERVAL_MS}ms")
    readPollFuture = readPollExecutor.scheduleWithFixedDelay(
      {
        if (inventoryRunning) runCatching { handleReadEvent() }
      },
      READ_POLL_INTERVAL_MS,
      READ_POLL_INTERVAL_MS,
      TimeUnit.MILLISECONDS,
    )
  }

  private fun stopReadPolling() {
    Log.d(TAG, "stopReadPolling()")
    readPollFuture?.cancel(true)
    readPollFuture = null
  }

  private fun handleReadEvent() {
    val reader = currentReader ?: return
    val tags = try {
      reader.Actions.getReadTags(100)
    } catch (e: Throwable) {
      Log.e(TAG, "handleReadEvent: getReadTags threw ${e.javaClass.simpleName}: ${e.message}")
      return
    }
    if (tags.isNullOrEmpty()) return
    Log.d(TAG, "handleReadEvent: getReadTags returned ${tags.size} tags")
    emitReadEvents(tags)
  }

  private fun emitReadEvents(tags: Array<TagData>) {
    val payload = connectedPayload()
    val readerName = payload?.getString("name")
    val readerAddress = payload?.getString("address")
    val now = System.currentTimeMillis()

    tags.forEach { tag ->
      val tagId = tag.tagID?.trim().orEmpty()
      if (tagId.isBlank()) {
        return@forEach
      }

      val previousEmitAt = recentNativeTagEmits[tagId] ?: 0L
      if (now - previousEmitAt < NATIVE_TAG_DEDUPE_WINDOW_MS) {
        return@forEach
      }
      recentNativeTagEmits[tagId] = now

      val event = Arguments.createMap().apply {
        putString("data", tagId)
        putString("source", "zebra_rfid")
        putString("readerName", readerName)
        putString("readerAddress", readerAddress)
        putDouble("receivedAt", System.currentTimeMillis().toDouble())
      }

      Log.d(TAG, "emitReadEvents: emitting tag=$tagId")
      sendEvent(EVENT_SCAN, event)
    }

    if (recentNativeTagEmits.size > 500) {
      recentNativeTagEmits.entries.removeIf { now - it.value > NATIVE_TAG_DEDUPE_WINDOW_MS * 4 }
    }
  }

  private fun handleStatusEvent(statusEvents: RfidStatusEvents?) {
    val statusEventData = statusEvents?.StatusEventData ?: return
    Log.d(TAG, "eventStatusNotify: type=${statusEventData.getStatusEventType()}")

    when (statusEventData.getStatusEventType()) {
      STATUS_EVENT_TYPE.HANDHELD_TRIGGER_EVENT -> {
        when (statusEventData.HandheldTriggerEventData.getHandheldEvent()) {
          HANDHELD_TRIGGER_EVENT_TYPE.HANDHELD_TRIGGER_PRESSED -> {
            emitStatus("trigger_pressed", connectedPayload())
            // forceRestart=false: if inventory is still in the drain window from the last release,
            // this is a no-op (zero BT calls). Only a cold press after full stop costs one perform().
            executor.execute { runCatching { startInventoryInternal(forceRestart = false) } }
          }

          HANDHELD_TRIGGER_EVENT_TYPE.HANDHELD_TRIGGER_RELEASED -> {
            emitStatus("trigger_released", connectedPayload())
            executor.execute { runCatching { stopInventoryInternal() } }
          }

          else -> Unit
        }
      }

      STATUS_EVENT_TYPE.DISCONNECTION_EVENT -> {
        inventoryRunning = false
        stopReadPolling()
        emitStatus("reader_disconnected", connectedPayload())
      }

      STATUS_EVENT_TYPE.INVENTORY_START_EVENT -> {
        // State is managed by startInventoryInternal (software) or PRESSED handler (hardware).
        Log.d(TAG, "INVENTORY_START_EVENT received")
      }

      STATUS_EVENT_TYPE.INVENTORY_STOP_EVENT -> {
        // With IMMEDIATE triggers the reader stops after each inventory round.
        // If inventoryRunning is still true the trigger is still held — restart
        // immediately to create a continuous scan loop until RELEASED fires.
        Log.d(TAG, "INVENTORY_STOP_EVENT received inventoryRunning=$inventoryRunning")
        if (inventoryRunning) {
          executor.execute {
            runCatching {
              if (inventoryRunning) {
                currentReader?.Actions?.Inventory?.perform()
              }
            }
          }
        }
      }

      else -> Unit
    }
  }

  private fun mapReaderDevice(device: ReaderDevice, connected: Boolean) =
    Arguments.createMap().apply {
      val address = readerAddress(device)
      val name = device.name?.trim().orEmpty().ifBlank { "Zebra RFID Reader" }
      putString("id", zebraReaderId(address))
      putString("name", name)
      putString("address", address)
      putBoolean("bonded", true)
      putBoolean("connected", connected)
      putString("type", device.transport?.toString().orEmpty().ifBlank { "ZEBRA_RFID" })
      putString("backend", "zebra_rfid")
    }

  private fun isReaderDeviceConnected(device: ReaderDevice): Boolean {
    val currentAddress = readerAddress(currentReaderDevice)
    val targetAddress = readerAddress(device)
    return currentAddress.isNotBlank() && currentAddress.equals(targetAddress, ignoreCase = true)
  }

  private fun connectedPayload() = currentReaderDevice?.let { mapReaderDevice(it, connected = true) }

  private fun readerAddress(device: ReaderDevice?): String {
    if (device == null) return ""
    return device.address?.trim().orEmpty()
      .ifBlank { device.serialNumber?.trim().orEmpty() }
  }

  private fun emitStatus(status: String, device: com.facebook.react.bridge.WritableMap?) {
    val payload = Arguments.createMap().apply {
      putString("status", status)
      putMap("device", device)
      putBoolean("inventoryRunning", inventoryRunning)
      putDouble("emittedAt", System.currentTimeMillis().toDouble())
    }
    sendEvent(EVENT_STATUS, payload)
  }

  private fun sendEvent(eventName: String, params: com.facebook.react.bridge.WritableMap) {
    runCatching {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, params)
    }
  }

  private fun requireSdkContext(): Context {
    return reactContext.currentActivity ?: reactContext.applicationContext
  }

  private fun applyDefaultRegion(reader: RFIDReader) {
    val config = invokeMethod(reader.Config, "getRegulatoryConfig")
      ?: throw IllegalStateException("Regulatory configuration is unavailable.")
    val supportedRegions = reader.ReaderCapabilities.SupportedRegions
      ?: throw IllegalStateException("Supported regions are unavailable.")
    val regionInfo = invokeMethod(supportedRegions, "getRegionInfo", 1)
      ?: throw IllegalStateException("No supported region was returned by the reader.")

    val regionCode = invokeMethod(regionInfo, "getRegionCode")
    val hoppingConfigurable = invokeMethod(regionInfo, "isHoppingConfigurable")
    val supportedChannels = invokeMethod(regionInfo, "getSupportedChannels")

    invokeMethod(config, "setRegion", regionCode)
    invokeMethod(config, "setIsHoppingOn", hoppingConfigurable)
    invokeMethod(config, "setEnabledChannels", supportedChannels)
    invokeMethod(reader.Config, "setRegulatoryConfig", config)
  }

  /** Access a field or no-arg method by name, searching up the class hierarchy. */
  private fun invokeOrField(target: Any, name: String): Any? {
    val cls = target.javaClass
    // Try field first (public and declared)
    val field = generateSequence<Class<*>>(cls) { it.superclass }.firstNotNullOfOrNull { c ->
      runCatching { c.getDeclaredField(name).also { it.isAccessible = true } }.getOrNull()
    }
    if (field != null) return field.get(target)
    // Try no-arg method
    val method = generateSequence<Class<*>>(cls) { it.superclass }.firstNotNullOfOrNull { c ->
      runCatching { c.getDeclaredMethod(name).also { it.isAccessible = true } }.getOrNull()
    }
    return method?.invoke(target)
  }

  private fun invokeMethod(target: Any, name: String, vararg args: Any?): Any? {
    val method = target.javaClass.methods.firstOrNull { candidate ->
      candidate.name == name && candidate.parameterTypes.size == args.size
    } ?: target.javaClass.declaredMethods.firstOrNull { candidate ->
      candidate.name == name && candidate.parameterTypes.size == args.size
    } ?: throw NoSuchMethodException("Method $name not found on ${target.javaClass.name}")

    method.isAccessible = true
    return method.invoke(target, *args)
  }

  private fun unwrap(error: Throwable): Throwable {
    return if (error is InvocationTargetException && error.targetException != null) {
      unwrap(error.targetException)
    } else {
      error
    }
  }

  private fun isRegionNotConfigured(error: Throwable): Boolean {
    return when (error) {
      is OperationFailureException -> error.results.toString()
        .contains("RFID_READER_REGION_NOT_CONFIGURED", ignoreCase = true)

      else -> runCatching {
        invokeMethod(error, "getResults")?.toString().orEmpty()
          .contains("RFID_READER_REGION_NOT_CONFIGURED", ignoreCase = true)
      }.getOrDefault(false)
    }
  }

  private fun isSdkPresent(): Boolean {
    return runCatching { Readers::class.java.name }.isSuccess
  }

  companion object {
    private const val TAG = "ZebraRfidModule"
    const val MODULE_NAME = "XandoraZebraRfid"
    const val EVENT_SCAN = "xandora.zebra.scan"
    const val EVENT_STATUS = "xandora.zebra.status"
    private const val READ_POLL_INTERVAL_MS = 500L
    private const val NATIVE_TAG_DEDUPE_WINDOW_MS = 5000L
    private const val MIN_INVENTORY_DURATION_MS = 0L
    private val READER_TRANSPORT_ORDER = listOf(
      ENUM_TRANSPORT.BLUETOOTH,
      ENUM_TRANSPORT.SERVICE_SERIAL,
      ENUM_TRANSPORT.SERVICE_USB,
    )

    fun zebraReaderId(address: String) = "ZEBRA::$address"
  }
}
