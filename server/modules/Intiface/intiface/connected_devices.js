/**
 * Connected Devices Module
 * 
 * Handles device connection, disconnection, and management.
 * Self-contained - wires its own UI events.
 */

import { getState, setClient, setButtplug, setDevices, setConnected, loadSetting, saveSetting, updateExtensionPrompt, isClientConnected as sharedIsClientConnected, getButtplug as sharedGetButtplug } from './shared_state.js'
import { updateStatus, updateButtonStates } from './shared_ui.js'
import { runDeviceOutput, runDeviceOutputs, stopDeviceOutput } from './device_output.js'
import { executeCommand, initDeviceExecution } from './device_execution.js'
import { PlayModeLoader } from './_loader.js'

const NAME = 'intiface-connect'
const DEFAULT_TIMELINE_PATTERN_SETTINGS = { min: 0, max: 100, cycles: 3 }

// Device channels
let deviceChannels = new Map()
const deviceChangeListeners = new Set()
let timelinePlaybackTimers = new Set()
const manualMotorValues = new WeakMap()
let chatActionBridgeBound = false

function numberOption(value, fallback, min, max) {
  const parsed = Number(value)
  const next = Number.isFinite(parsed) ? parsed : fallback
  return Math.max(min, Math.min(max, Math.round(next)))
}

function boolOption(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true'
}

function commandFromChatAction(detail = {}) {
  const attrs = detail && typeof detail === 'object' ? detail.attrs || detail : {}
  const actionType = String(detail.type || attrs.type || '').trim().toLowerCase()
  const deviceIndex = numberOption(attrs.device ?? attrs.deviceIndex, 0, 0, 128)
  const duration = numberOption(attrs.duration ?? attrs.durationMs, 5000, 50, 300000)
  const command = String(attrs.command || attrs.kind || attrs.action || '').trim().toLowerCase()

  if (actionType === 'intiface.stop' || command === 'stop') return { type: 'stop', deviceIndex }

  const mode = String(attrs.mode || attrs.modeId || '').trim().toLowerCase()
  if (mode) {
    const sequences = PlayModeLoader?.getSequencesForMode?.(mode) || {}
    const sequence = String(attrs.sequence || attrs.modeName || Object.keys(sequences)[0] || '').trim().toLowerCase()
    return { type: mode, modeName: sequence, deviceIndex }
  }

  const pattern = String(attrs.pattern || attrs.preset || '').trim().toLowerCase()
  if (pattern) {
    return {
      type: attrs.preset ? 'preset' : 'waveform',
      presetName: pattern,
      pattern,
      min: numberOption(attrs.min, 20, 0, 100),
      max: numberOption(attrs.max, 80, 0, 100),
      duration,
      cycles: numberOption(attrs.cycles, 3, 1, 500),
      deviceIndex,
      _skipSyncStartLead: boolOption(attrs.skipLead),
    }
  }

  const intensity = numberOption(attrs.intensity ?? attrs.value, 0, 0, 100)
  if (command === 'oscillate') return { type: 'oscillate', intensity, duration, deviceIndex }
  if (command === 'linear') {
    return {
      type: 'linear',
      startPos: numberOption(attrs.start ?? attrs.startPos, 0, 0, 100),
      endPos: numberOption(attrs.end ?? attrs.endPos, 100, 0, 100),
      duration,
      deviceIndex,
    }
  }
  return { type: 'vibrate', intensity, duration, motorIndex: numberOption(attrs.motor ?? attrs.motorIndex, 0, 0, 128), deviceIndex }
}

function bindChatActionBridge() {
  if (chatActionBridgeBound || typeof window === 'undefined') return
  chatActionBridgeBound = true
  window.addEventListener('nitral-intiface-action', async (event) => {
    const state = getState()
    initDeviceExecution({
      NAME,
      client: state.client,
      devices: state.devices || [],
      getConnectedDevices,
      buttplug: state.buttplug,
      updateStatus,
      getSyncStartEventLeadMs: () => numberOption(localStorage.getItem('intifaceAiSyncStartLeadMs'), 1200, 0, 3000),
    })
    const cmd = commandFromChatAction(event?.detail || {})
    await executeCommand(cmd)
    if (cmd.duration > 0 && ['vibrate', 'oscillate'].includes(cmd.type)) {
      setTimeout(() => executeCommand({ type: 'stop', deviceIndex: cmd.deviceIndex }).catch(() => {}), cmd.duration)
    }
  })
}

function publishTimelineMotorCounts(devices = getConnectedDevices()) {
  const counts = { A: 1, B: 1, C: 1, D: 1 }
  devices.forEach((device, index) => {
    const channel = String(getDeviceChannel(index) || '').toUpperCase()
    if (!Object.prototype.hasOwnProperty.call(counts, channel)) return
    counts[channel] = Math.max(counts[channel], getDeviceMotorCount(device))
  })
  window.dispatchEvent(new CustomEvent('intiface-timeline-motor-counts', { detail: counts }))
}

async function hardStopDevice(device, buttplugLib = null, options = {}) {
  if (!device) return
  await stopDeviceOutput(device)
}

function saveChannelAssignments() {
  const assignments = Object.fromEntries(deviceChannels.entries())
  saveSetting('device-channels', JSON.stringify(assignments))
  try {
    localStorage.setItem('intiface-device-channels', JSON.stringify(assignments))
  } catch (_e) {}
}

function getDevicePersistentKey(device) {
  if (!device) return null
  const name = (device.displayName || device.name || 'unknown').trim().toLowerCase()
  const vibeCount = Array.isArray(device.vibrateAttributes) ? device.vibrateAttributes.length : 0
  const hasLinear = device?.messageAttributes?.LinearCmd !== undefined ? '1' : '0'
  const hasOscillate = device?.messageAttributes?.OscillateCmd !== undefined ? '1' : '0'
  return `${name}|v${vibeCount}|l${hasLinear}|o${hasOscillate}`
}

function getDeviceKeyByIndex(deviceIndex) {
  const device = getConnectedDevices()[deviceIndex]
  const stableKey = getDevicePersistentKey(device)
  if (stableKey) return stableKey
  return `idx:${deviceIndex}`
}

function loadChannelAssignments() {
  let saved = loadSetting('device-channels', null)
  if (!saved) {
    try {
      saved = localStorage.getItem('intiface-device-channels')
    } catch (_e) {
      saved = null
    }
  }

  if (!saved) {
    deviceChannels = new Map()
    return
  }

  try {
    const parsed = JSON.parse(saved)
    const entries = Object.entries(parsed || {}).filter(([, v]) => typeof v === 'string')
    deviceChannels = new Map(entries)
  } catch (_e) {
    deviceChannels = new Map()
  }
}

function notifyDeviceChange() {
  const payload = {
    devices: getConnectedDevices(),
    channels: new Map(deviceChannels)
  }
  deviceChangeListeners.forEach(listener => {
    try {
      listener(payload)
    } catch (e) {
      console.error(`${NAME}: Device change listener failed:`, e)
    }
  })
}

// Getters
export function getConnectedDevices() {
  return getState().devices
}

export function getDeviceChannel(deviceIndex) {
  const stableKey = getDeviceKeyByIndex(deviceIndex)
  if (deviceChannels.has(stableKey)) {
    return deviceChannels.get(stableKey)
  }

  const legacyNumericKey = String(deviceIndex)
  if (deviceChannels.has(legacyNumericKey)) {
    const migratedChannel = deviceChannels.get(legacyNumericKey)
    deviceChannels.set(stableKey, migratedChannel)
    deviceChannels.delete(legacyNumericKey)
    saveChannelAssignments()
    return migratedChannel
  }

  return 'A'
}

export function getDevicesOnChannel(channel) {
  const normalizedChannel = String(channel || '-').trim().toUpperCase()
  const devices = getState().devices || []

  if (normalizedChannel === '-') {
    // '-' means All devices in the UI.
    return devices
  }

  return devices.filter((_, index) => String(getDeviceChannel(index) || '-').trim().toUpperCase() === normalizedChannel)
}

export function getActiveChannels() {
  return [...new Set([...deviceChannels.values()])]
}

export function getDeviceMotorCount(device) {
  if (!device) return 1
  const featureCount = getOutputFeatures(device).length
  if (featureCount > 0) {
    return featureCount
  }

  if (Array.isArray(device.vibrateAttributes) && device.vibrateAttributes.length > 0) {
    return device.vibrateAttributes.length
  }

  const scalarCount = getScalarActuators(device).length
  if (scalarCount > 0) {
    return scalarCount
  }

  return 1
}

function getOutputTypes(buttplugLib, preferredActuator = 'Vibrate') {
  const outputType = buttplugLib?.OutputType || {}
  const ordered = [preferredActuator, 'Vibrate', 'Oscillate', 'Constrict', 'Inflate', 'Rotate', 'Position', 'HwPositionWithDuration']
  return ordered.map((type) => outputType[type] || type).filter((type, index, values) => type && values.indexOf(type) === index)
}

function getFeatureOutputMap(feature) {
  return feature?._feature?.Output || feature?.Output || null
}

function getFeatureIndex(feature) {
  const index = feature?._feature?.FeatureIndex ?? feature?.FeatureIndex
  return Number.isFinite(Number(index)) ? Number(index) : null
}

function getOutputFeatures(device, buttplugLib = null, preferredActuator = 'Vibrate') {
  if (!device?.features || typeof device.features.values !== 'function') return []
  const entries = []
  const types = getOutputTypes(buttplugLib, preferredActuator)
  for (const feature of device.features.values()) {
    const outputMap = getFeatureOutputMap(feature)
    if (!outputMap) continue
    for (const outputType of types) {
      const type = String(outputType)
      try {
        if (Object.prototype.hasOwnProperty.call(outputMap, type) || (typeof feature?.hasOutput === 'function' && feature.hasOutput(outputType))) {
          entries.push({ feature, outputType: type, outputAttributes: outputMap[type] })
          break
        }
      } catch (_e) {}
    }
  }
  return entries
}

function describeOutputFeatures(device, buttplugLib = null) {
  return getOutputFeatures(device, buttplugLib).map((entry) => `${entry.outputType}#${getFeatureIndex(entry.feature) ?? '?'}`).join(', ') || 'none'
}

function logDeviceOutputs(device, buttplugLib) {
  const details = []
  if (device?.features && typeof device.features.entries === 'function') {
    for (const [index, feature] of device.features.entries()) {
      const outputMap = getFeatureOutputMap(feature) || {}
      details.push({ index, featureIndex: getFeatureIndex(feature), outputs: Object.keys(outputMap), raw: outputMap })
    }
  }
  const outputTypes = buttplugLib?.OutputType || {}
  console.log(`${NAME}: Device outputs for ${getDeviceDisplayName(device)}:`, details, 'resolved:', describeOutputFeatures(device, buttplugLib), 'api:', {
    hasRunOutput: typeof device?.runOutput === 'function',
    runOutputLength: typeof device?.runOutput === 'function' ? device.runOutput.length : null,
    hasStop: typeof device?.stop === 'function',
    deviceKeys: Object.keys(device || {}),
    outputTypes,
    hasVibrateOutput: typeof device?.hasOutput === 'function' ? device.hasOutput(outputTypes.Vibrate || 'Vibrate') : null,
    messageAttributes: device?.messageAttributes || null,
  })
}

function getPatternValue(patternName, progress, motorIndex = 0, motorCount = 1) {
  const base = Math.max(0, Math.min(1, Number(progress) || 0))
  const safeMotorCount = Math.max(1, Number(motorCount) || 1)
  const safeMotorIndex = Math.max(0, Number(motorIndex) || 0)
  const t = (base + (safeMotorCount > 1 ? safeMotorIndex / safeMotorCount : 0)) % 1
  const patternFunc = PlayModeLoader?.getPattern?.(String(patternName || 'sine').trim())
  if (typeof patternFunc === 'function') {
    const value = Number(patternFunc(base, 1, { motorIndex: safeMotorIndex, motorCount: safeMotorCount }))
    if (Number.isFinite(value)) return Math.max(0, Math.min(1, value))
  }

  const name = String(patternName || 'sine').toLowerCase()
  if (name.includes('square')) return t % 1 < 0.5 ? 1 : 0
  if (name.includes('triangle')) return t < 0.5 ? t * 2 : 2 - (t * 2)
  if (name.includes('saw') || name.includes('ramp_up')) return t
  if (name.includes('ramp_down')) return 1 - t
  if (name.includes('pulse')) return Math.sin(t * Math.PI * 8) > 0.35 ? 1 : 0
  if (name.includes('heartbeat')) return Math.max(0, Math.sin(t * Math.PI * 6)) ** 3
  return (Math.sin(t * Math.PI * 2) + 1) / 2
}

function getNumberInputValue(id, fallback) {
  const el = document.getElementById(id)
  const value = Number(el?.value)
  return Number.isFinite(value) ? value : fallback
}

function setTimelineScrubberValue(value, max) {
  const el = document.getElementById('intiface-timeline-scrubber')
  if (!(el instanceof HTMLInputElement)) return
  if (Number.isFinite(Number(max))) el.max = String(Math.max(0, Math.round(Number(max))))
  const bounded = Math.max(Number(el.min) || 0, Math.min(Number(el.max) || 0, Math.round(Number(value) || 0)))
  if (el.value !== String(bounded)) el.value = String(bounded)
}

function clearTimelinePlaybackTimers() {
  for (const timer of timelinePlaybackTimers) {
    clearTimeout(timer)
    clearInterval(timer)
  }
  timelinePlaybackTimers.clear()
}

async function stopTimelinePlayback() {
  clearTimelinePlaybackTimers()
  await stopAllDevices()
  updateStatus('Timeline stopped')
}

function getTimelineBlocksFromDom() {
  return Array.from(document.querySelectorAll('.intiface-timeline-block')).map((block) => {
    const lane = block.closest('.intiface-track-lane')
    const left = Number.parseFloat(String(block.style.left || '0')) || 0
    const width = Number.parseFloat(String(block.style.width || '18')) || 18
    return {
      channel: String(lane?.dataset?.channel || '-').toUpperCase(),
      left: Math.max(0, Math.min(100, left)),
      motor: Math.max(1, Number(block.dataset?.motor) || Number(lane?.dataset?.motor) || 1),
      pattern: String(block.dataset?.pattern || block.textContent || 'sine').trim() || 'sine',
      width: Math.max(1, Math.min(100, width))
    }
  })
}

function getTimelineDurationFromDom() {
  const blocks = getTimelineBlocksFromDom()
  const baseDuration = getNumberInputValue('intiface-pattern-duration', 5000)
  if (!blocks.length) return baseDuration
  return Math.max(baseDuration, ...blocks.map((block) => Math.round(((block.left + block.width) / Math.max(block.width, 1)) * baseDuration)))
}

function formatTimelineTimeLabel(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function updateTimelineScaleLabels() {
  const scale = document.querySelector('.intiface-timeline-scale')
  if (!scale) return
  const labels = Array.from(scale.querySelectorAll('span'))
  if (labels.length < 5) return
  const duration = getTimelineDurationFromDom()
  setTimelineScrubberValue(getNumberInputValue('intiface-timeline-scrubber', 0), duration)
  const values = [0, 0.25, 0.5, 0.75, 1].map((part) => formatTimelineTimeLabel(duration * part))
  labels.slice(0, 5).forEach((label, index) => {
    if (label.textContent !== values[index]) label.textContent = values[index]
  })
}

async function playTimelineBlocks() {
  const state = getState()
  if (!state.client?.connected) {
    updateStatus('Not connected', true)
    return
  }

  const blocks = getTimelineBlocksFromDom()
  if (!blocks.length) {
    updateStatus('Add a timeline block before playback', true)
    return
  }

  clearTimelinePlaybackTimers()
  updateTimelineScaleLabels()
  const baseDuration = getNumberInputValue('intiface-pattern-duration', 5000)
  const { min, max, cycles } = DEFAULT_TIMELINE_PATTERN_SETTINGS
  const totalDuration = Math.max(baseDuration, ...blocks.map((block) => Math.round(((block.left + block.width) / Math.max(block.width, 1)) * baseDuration)))
  const startOffsetMs = Math.max(0, Math.min(totalDuration, getNumberInputValue('intiface-timeline-scrubber', 0)))
  const playbackStartedAt = performance.now()
  const motorValues = new WeakMap()
  let reportedNoTarget = false
  let reportedCommandFailure = false

  setTimelineScrubberValue(startOffsetMs, totalDuration)
  updateStatus('Timeline playing')

  const scrubberTimer = setInterval(() => {
    setTimelineScrubberValue(startOffsetMs + (performance.now() - playbackStartedAt), totalDuration)
  }, 50)
  timelinePlaybackTimers.add(scrubberTimer)

  for (const block of blocks) {
    const startMs = Math.round((block.left / 100) * totalDuration)
    const durationMs = Math.max(250, Math.round((block.width / 100) * totalDuration))
    const blockEndMs = startMs + durationMs
    if (blockEndMs <= startOffsetMs) continue
    const delayMs = Math.max(0, startMs - startOffsetMs)
    const startTimer = setTimeout(() => {
      const initialElapsed = Math.max(0, startOffsetMs - startMs)
      const startedAt = performance.now() - initialElapsed
      const interval = setInterval(async () => {
        const elapsed = performance.now() - startedAt
        if (elapsed >= durationMs) {
          clearInterval(interval)
          timelinePlaybackTimers.delete(interval)
          const devices = getDevicesOnChannel(block.channel)
          await Promise.all(devices.map((device) => applyTimelinePatternIntensity(state, device, block.pattern, 0, min, max, cycles, block.motor, motorValues, true).catch(() => false)))
          return
        }

        const devices = getDevicesOnChannel(block.channel)
        if (!devices.length) {
          if (!reportedNoTarget) {
            updateStatus(`Timeline channel ${block.channel} has no assigned devices`, true)
            reportedNoTarget = true
          }
          return
        }
        const scaledCycles = Math.max(0.001, Math.max(1, cycles) * (durationMs / Math.max(1, baseDuration)))
        const cycleProgress = ((elapsed / durationMs) * scaledCycles) % 1
        const results = await Promise.all(devices.map((device) => applyTimelinePatternIntensity(state, device, block.pattern, cycleProgress, min, max, cycles, block.motor, motorValues).catch(() => false)))
        if (!reportedCommandFailure && results.every((result) => result !== true)) {
          updateStatus(`Timeline output failed for channel ${block.channel}`, true)
          reportedCommandFailure = true
        }
      }, 50)
      timelinePlaybackTimers.add(interval)
    }, delayMs)
    timelinePlaybackTimers.add(startTimer)
  }

  const stopTimer = setTimeout(async () => {
    clearTimelinePlaybackTimers()
    setTimelineScrubberValue(totalDuration, totalDuration)
    await stopAllDevices()
    updateStatus('Timeline complete')
  }, (totalDuration - startOffsetMs) + 150)
  timelinePlaybackTimers.add(stopTimer)
}

function attachTimelinePlaybackHandlers() {
  if (document.documentElement.dataset.intifaceTimelinePlaybackBound) return
  document.documentElement.dataset.intifaceTimelinePlaybackBound = 'true'

  updateTimelineScaleLabels()
  const sequencer = document.getElementById('intiface-timeline-sequencer')
  if (sequencer) {
    const observer = new MutationObserver(() => updateTimelineScaleLabels())
    observer.observe(sequencer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  }

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    if (target.closest('.intiface-track-lane') || target.closest('.intiface-timeline-block')) {
      setTimeout(updateTimelineScaleLabels, 0)
    }

    if (target.closest('#intiface-timeline-play')) {
      playTimelineBlocks().catch((error) => {
        console.error(`${NAME}: Timeline playback failed:`, error)
        updateStatus('Timeline playback failed', true)
      })
      return
    }

    if (target.closest('#intiface-timeline-pause')) {
      stopTimelinePlayback().catch((error) => {
        console.error(`${NAME}: Timeline stop failed:`, error)
        updateStatus('Timeline stop failed', true)
      })
    }
  })

  document.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest('#intiface-timeline-scrubber')) return
    updateTimelineScaleLabels()
    if (!timelinePlaybackTimers.size) return
    playTimelineBlocks().catch((error) => {
      console.error(`${NAME}: Timeline seek failed:`, error)
      updateStatus('Timeline seek failed', true)
    })
  })
}

export function getDeviceDisplayName(device) {
  if (!device) return 'Unknown Device'
  return device.displayName || device.name || `Device ${device.index}`
}

export function getDeviceType(device) {
  const name = (device?.displayName || device?.name || '').toLowerCase()
  const hasLinearMotion = Array.isArray(device?.linearAttributes) && device.linearAttributes.length > 0
  if (
    hasLinearMotion ||
    name.includes('handy') ||
    name.includes('launch') ||
    name.includes('onahole') ||
    name.includes('masturbator') ||
    name.includes('stroker') ||
    name.includes('solace') ||
    name.includes('max 2') ||
    name.includes('gush') ||
    name.includes('thrust') ||
    name.includes('blowjob')
  ) {
    return 'stroker'
  } else if (name.includes('cellmate') || name.includes('adorime') || name.includes('cage')) {
    return 'vibrator'
  } else if (name.includes('plug') || name.includes('prostate') || name.includes('butt')) {
    return 'plug'
  }
  return 'general'
}

export function isClientConnected() {
  return sharedIsClientConnected()
}

export function getButtplug() {
  return sharedGetButtplug()
}

// Setters
export function setDeviceChannel(deviceIndex, channel) {
  const stableKey = getDeviceKeyByIndex(deviceIndex)
  deviceChannels.set(stableKey, channel)
  deviceChannels.delete(String(deviceIndex))
  saveChannelAssignments()
  publishTimelineMotorCounts()
  notifyDeviceChange()
}

export function resetChannelAssignments() {
  deviceChannels.clear()
  saveChannelAssignments()
  renderDeviceList(getConnectedDevices())
  notifyDeviceChange()
}

export function assignAllDevicesToChannel(channel = '-') {
  getConnectedDevices().forEach((device, index) => {
    const stableKey = getDevicePersistentKey(device) || `idx:${index}`
    deviceChannels.set(stableKey, channel)
    deviceChannels.delete(String(index))
  })
  saveChannelAssignments()
  renderDeviceList(getConnectedDevices())
  notifyDeviceChange()
}

export function onDeviceChange(callback) {
  if (typeof callback !== 'function') return () => {}
  deviceChangeListeners.add(callback)
  return () => deviceChangeListeners.delete(callback)
}

export function setConnectedDevices(newDevices) {
  setDevices(newDevices)
  updateExtensionPrompt(newDevices)
  notifyDeviceChange()
}

// Connection functions
export async function connect(isAutoConnect = false) {
  const state = getState()
  console.log(`${NAME}: connect() called${isAutoConnect ? ' (auto-connect mode)' : ''}`)

  if (state.client?.connected) {
    console.log(`${NAME}: connect() skipped - already connected`)
    updateButtonStates(true)
    if (!isAutoConnect) updateStatus('Already connected')
    return
  }
   
  try {
    if (!state.buttplug?.ButtplugBrowserWebsocketClientConnector) {
      throw new Error('Buttplug WebSocket connector not loaded')
    }

    const serverIpInput = document.getElementById('intiface-ip-input')
    const rawServerIp = serverIpInput ? String(serverIpInput.value || '').trim() : loadSetting('server-ip', '127.0.0.1:12345')
    const parsedHost = rawServerIp.replace(/^wss?:\/\//i, '').split(':')[0] || '127.0.0.1'
    const isLocalhost = parsedHost === '127.0.0.1' || parsedHost === '::1' || parsedHost === 'localhost'
    const defaultWsProtocol = !isLocalhost && typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const serverUrl = /^wss?:\/\//i.test(rawServerIp)
      ? rawServerIp
      : `${defaultWsProtocol}//${rawServerIp || '127.0.0.1:12345'}`
    const serverIp = serverUrl.replace(/^wss?:\/\//i, '')

    console.log(`${NAME}: Connecting to ${serverUrl}`)

    const connector = new state.buttplug.ButtplugBrowserWebsocketClientConnector(serverUrl)
    
    if (!isAutoConnect) {
      updateStatus("Connecting...")
    }
    
    await state.client.connect(connector)
    console.log(`${NAME}: Connected successfully`)
    
    setConnected(true)
    updateStatus("Connected")
    updateButtonStates(true)
    
    // Attach device event handlers
    attachDeviceEventHandlers()
    
    // Update devices list
    const internalDevices = state.client._devices || new Map()
    const deviceArray = Array.from(internalDevices.values())

    // Ensure newly connected devices start from a hard stop state, so no
    // residual motion continues from prior sessions/apps.
    await Promise.all(deviceArray.map((dev) => hardStopDevice(dev, state.buttplug, { includeLinearStop: false })))

    setConnectedDevices(deviceArray)
    renderDeviceList(deviceArray)
    
    // Try scanning if no devices
    if (deviceArray.length === 0) {
      setTimeout(async () => {
        try {
          await state.client.startScanning()
          setTimeout(() => {
            state.client.stopScanning().catch(() => {})
          }, 3000)
        } catch (e) {
          console.log(`${NAME}: Could not start scanning:`, e)
        }
      }, 500)
    }
    
    updateExtensionPrompt(deviceArray)
    
  } catch (e) {
    let errorMsg = e?.message || e?.toString?.() || String(e) || 'Unknown error'
    
    if (!errorMsg || errorMsg === 'undefined' || errorMsg === 'null') {
      errorMsg = 'Server not available'
    } else if (errorMsg.includes('WebSocket') && errorMsg.includes('failed')) {
      errorMsg = 'Intiface server not available'
    } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('refused')) {
      errorMsg = 'Connection refused - Intiface may be offline'
    } else if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('not found')) {
      errorMsg = 'Intiface server address not found'
    } else if (errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timeout')) {
      errorMsg = 'Connection timed out'
    }

    if (isAutoConnect) {
      console.log(`${NAME}: Auto-connect failed:`, errorMsg)
    } else {
      console.error(`${NAME}: Connect failed:`, errorMsg)
      updateStatus(errorMsg, true)
    }

    throw new Error(errorMsg)
  }
}

export async function disconnect() {
  const state = getState()
  console.log(`${NAME}: Disconnect called`)
  
  try {
    await state.client.disconnect()
    
    setConnected(false)
    updateStatus("Disconnected")
    updateButtonStates(false)
    
    // Clear devices display
    const devicesContainer = document.getElementById('intiface-devices')
    if (devicesContainer) {
      devicesContainer.innerHTML = ''
    }
    
    setDevices([])
    notifyDeviceChange()
    
    updateExtensionPrompt([])
    
  } catch (e) {
    console.error(`${NAME}: Disconnect error:`, e)
    updateStatus(`Error disconnecting: ${e?.message || 'Unknown error'}`, true)
    
    // Force clear state even on error
    setDevices([])
    notifyDeviceChange()
  }
}

export async function toggleConnection() {
  const state = getState()
  if (state.client?.connected) {
    await disconnect()
  } else {
    try {
      await connect()
    } catch (e) {
      console.log(`${NAME}: Connect failed in toggleConnection`)
    }
  }
}

// Device event handlers
function attachDeviceEventHandlers() {
  const state = getState()
  
  state.client.removeAllListeners("deviceadded")
  state.client.removeAllListeners("deviceremoved")
  
  state.client.on("deviceadded", async (newDevice) => {
    console.log(`${NAME}: Device added: ${newDevice.name}`)

    try {
      await state.client.stopScanning()
    } catch (_e) {}

    await hardStopDevice(newDevice, state.buttplug, { includeLinearStop: false })
    logDeviceOutputs(newDevice, state.buttplug)
    
    const currentDevices = getConnectedDevices()
    if (!currentDevices.find(d => d.index === newDevice.index)) {
      const updatedDevices = [...currentDevices, newDevice]
      setConnectedDevices(updatedDevices)
      renderDeviceList(updatedDevices)
    }
    
    updateStatus(`Device found: ${newDevice.name}`)
  })
  
  state.client.on("deviceremoved", (removedDevice) => {
    console.log(`${NAME}: Device removed: ${removedDevice.name}`)
    
    const currentDevices = getConnectedDevices()
    const updatedDevices = currentDevices.filter(d => d.index !== removedDevice.index)
    setConnectedDevices(updatedDevices)
    renderDeviceList(updatedDevices)
    
    updateStatus(`Device removed: ${removedDevice.name}`)
  })
}

// UI Rendering
function renderDeviceList(devices) {
  const container = document.getElementById('intiface-devices')
  if (!container) return
  
  if (devices.length === 0) {
    container.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No devices connected</div>'
    return
  }
  
  let html = '<div style="display: flex; flex-direction: column; gap: 10px;">'
  
  devices.forEach((dev, index) => {
    const deviceName = getDeviceDisplayName(dev)
    const motorCount = getDeviceMotorCount(dev)
    const deviceType = getDeviceType(dev)
    
    html += `
      <div class="device-card" data-device-index="${index}" style="padding: 10px; background: rgba(100,100,200,0.1); border-radius: 4px; border: 1px solid rgba(100,100,200,0.2);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-weight: bold;">${deviceName}</span>
          <span style="font-size: 0.75em; color: #888;">${deviceType}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="font-size: 0.75em; min-width: 60px; color: #aaa;">Channel</span>
          <select class="device-channel-select" data-device-index="${index}" style="flex: 1; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.15); border-radius: 3px; color: #fff; font-size: 0.75em; padding: 2px 4px;">
            ${renderChannelOptions(getDeviceChannel(index))}
          </select>
        </div>
        ${renderMotorControls(dev, index, motorCount)}
      </div>
    `
  })
  
  html += '</div>'
  container.innerHTML = html
  publishTimelineMotorCounts(devices)
  
  // Attach motor control handlers
  attachMotorControlHandlers(devices)
  attachChannelControlHandlers()
}

function renderChannelOptions(selectedChannel) {
  const channels = ['-', 'A', 'B', 'C', 'D']
  return channels.map(channel => `<option value="${channel}" ${selectedChannel === channel ? 'selected' : ''}>${channel === '-' ? 'All (-)' : channel}</option>`).join('')
}

function renderMotorControls(device, deviceIndex, motorCount) {
  let html = '<div style="display: flex; flex-direction: column; gap: 5px;">'
  
  for (let i = 0; i < motorCount; i++) {
    html += `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 0.75em; min-width: 60px;">Motor ${i + 1}</span>
        <input type="range" class="motor-slider" data-device="${deviceIndex}" data-motor="${i}" 
          min="0" max="100" value="0" style="flex: 1;">
        <span class="motor-value" style="font-size: 0.75em; min-width: 35px;">0%</span>
      </div>
    `
  }
  
  html += '</div>'
  return html
}

function getScalarActuators(device) {
  const attrs = device?.messageAttributes || {}
  const sources = [
    attrs?.ScalarCmd,
    attrs?.VibrateCmd,
    attrs?.OscillateCmd,
    attrs?.RotateCmd,
    attrs?.ConstrictCmd,
    attrs?.InflateCmd,
  ]

  const entries = []
  for (const list of sources) {
    if (!Array.isArray(list)) continue
    for (let i = 0; i < list.length; i++) {
      const item = list[i] || {}
      const actuatorType = String(item?.ActuatorType || 'Vibrate')
      const index = Number.isFinite(item?.Index) ? Number(item.Index) : i
      entries.push({ index, actuatorType })
    }
  }

  const deduped = []
  const seen = new Set()
  for (const entry of entries) {
    const key = `${entry.index}:${entry.actuatorType}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

async function applySliderIntensity(state, device, intensity, motorIndex = 0) {
  const intensityValue = Math.max(0, Math.min(100, Number(intensity) || 0)) / 100
  const motorCount = getDeviceMotorCount(device)
  if (motorCount <= 1) return await runDeviceOutput(device, state.buttplug, 'Vibrate', intensityValue)
  const values = manualMotorValues.get(device) || Array.from({ length: motorCount }, () => 0)
  while (values.length < motorCount) values.push(0)
  values[Math.max(0, Math.min(motorCount - 1, motorIndex))] = intensityValue
  manualMotorValues.set(device, values)
  return await runDeviceOutputs(device, state.buttplug, 'Vibrate', values)
}

async function applyTimelinePatternIntensity(state, device, patternName, cycleProgress, min, max, cycles, targetMotor, motorValues, forceZero = false) {
  const motorCount = getDeviceMotorCount(device)
  const safeMin = Math.max(0, Math.min(100, Number(min) || 0))
  const safeMax = Math.max(0, Math.min(100, Number(max) || 100))
  if (motorCount <= 1) {
    const value = forceZero ? 0 : safeMin + ((safeMax - safeMin) * getPatternValue(patternName, cycleProgress, 0, 1))
    return await runDeviceOutput(device, state.buttplug, 'Vibrate', Math.max(0, Math.min(100, value)) / 100)
  }

  const existing = motorValues?.get(device) || Array.from({ length: motorCount }, () => 0)
  const values = existing.slice(0, motorCount)
  while (values.length < motorCount) values.push(0)
  const targetIndex = Number.isFinite(Number(targetMotor)) ? Math.max(0, Math.min(motorCount - 1, Number(targetMotor) - 1)) : null

  for (let motorIndex = 0; motorIndex < motorCount; motorIndex++) {
    if (targetIndex !== null && motorIndex !== targetIndex) continue
    if (forceZero) {
      values[motorIndex] = 0
      continue
    }
    const value = safeMin + ((safeMax - safeMin) * getPatternValue(patternName, cycleProgress, motorIndex, motorCount))
    values[motorIndex] = Math.max(0, Math.min(100, value)) / 100
  }
  motorValues?.set(device, values)
  return await runDeviceOutputs(device, state.buttplug, 'Vibrate', values)
}

function attachMotorControlHandlers(devices) {
  const state = getState()
  
  document.querySelectorAll('.motor-slider').forEach(slider => {
    slider.addEventListener('input', async (e) => {
      const deviceIndex = parseInt(e.target.dataset.device)
      const motorIndex = parseInt(e.target.dataset.motor)
      const intensity = parseInt(e.target.value)
      
      const device = devices[deviceIndex]
      if (!device || !state.client?.connected) return

      // Keep UI responsive even if command path fails.
      const valueDisplay = e.target.nextElementSibling
      if (valueDisplay) {
        valueDisplay.textContent = `${intensity}%`
      }
      
      try {
        console.debug(`${NAME}: Slider input device=${getDeviceDisplayName(device)} motor=${motorIndex} intensity=${intensity} outputs=${describeOutputFeatures(device, state.buttplug)}`)
        const ok = await applySliderIntensity(state, device, intensity, motorIndex)
        if (!ok) {
          updateStatus(`Device ${getDeviceDisplayName(device)} outputs: ${describeOutputFeatures(device, state.buttplug)}`, true)
        }
      } catch (e) {
        console.error(`${NAME}: Motor control failed for ${getDeviceDisplayName(device)} outputs ${describeOutputFeatures(device, state.buttplug)}:`, e)
        updateStatus(`Motor control failed: ${e?.message || 'Unknown output error'}`, true)
      }
    })
  })
}

function attachChannelControlHandlers() {
  document.querySelectorAll('.device-channel-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const deviceIndex = parseInt(e.target.dataset.deviceIndex, 10)
      const channel = e.target.value || '-'
      setDeviceChannel(deviceIndex, channel)
    })
  })
}

// Stop all devices
export async function stopAllDevices() {
  const state = getState()
  const devices = getConnectedDevices()
  
  if (devices.length === 0) return
  
  const stopPromises = devices.map(async (dev) => {
    try {
      await hardStopDevice(dev, state.buttplug, { includeLinearStop: true })
    } catch (e) {
      // Ignore errors
    }
  })
  
  await Promise.all(stopPromises)
  
  // Reset sliders
  document.querySelectorAll('.motor-slider').forEach(slider => {
    slider.value = 0
    const valueDisplay = slider.nextElementSibling
    if (valueDisplay) {
      valueDisplay.textContent = '0%'
    }
  })
}

// Rescan
export async function rescan() {
  const state = getState()
  if (!state.client?.connected) {
    updateStatus("Not connected")
    return
  }

  const rescanBtn = document.getElementById('intiface-rescan-button')
  if (rescanBtn) {
    rescanBtn.disabled = true
  }
  
  updateStatus("Scanning for devices...")
  console.log(`${NAME}: Starting device scan...`)
  
  try {
    await state.client.startScanning()

    setTimeout(async () => {
      try {
        await state.client.stopScanning()
      } catch (_e) {}

      const internalDevices = state.client._devices || new Map()
      const deviceArray = Array.from(internalDevices.values())
      setConnectedDevices(deviceArray)
      renderDeviceList(deviceArray)

      updateStatus(`Scan complete (${deviceArray.length} device${deviceArray.length === 1 ? '' : 's'})`)
      console.log(`${NAME}: Scan complete, found ${deviceArray.length} device(s)`)

      if (rescanBtn) {
        rescanBtn.disabled = false
      }
    }, 5000)
  } catch (e) {
    console.error(`${NAME}: Rescan failed:`, e)
    updateStatus("Rescan failed", true)
    if (rescanBtn) {
      rescanBtn.disabled = false
    }
  }
}

// Initialization
export async function initConnectedDevices(buttplugLib = null) {
  console.log(`${NAME}: Initializing connected devices module...`)

  // Initialize play modes and patterns before anything else
  try {
    await PlayModeLoader.init()
  } catch (e) {
    console.warn(`${NAME}: PlayModeLoader init failed, patterns may be unavailable:`, e)
  }

  const state = getState()

  loadChannelAssignments()

  if (!state.buttplug) {
    if (buttplugLib) {
      setButtplug(buttplugLib)
    }
  }

  if (!state.buttplug) {
    throw new Error(`${NAME}: Buttplug library not loaded`)
  }
  
  // Initialize client (once)
  if (!state.client) {
    setClient(new state.buttplug.ButtplugClient("ErisHub Intiface Client"))
  }

  // Wire UI events on each init (DOM elements recreated by React on remount)
  // removeEventListener first to prevent duplicate listeners
  const connectBtn = document.getElementById('intiface-connect-action-button')
  if (connectBtn) {
    connectBtn.removeEventListener('click', toggleConnection)
    connectBtn.addEventListener('click', toggleConnection)
  }
  
  const rescanBtn = document.getElementById('intiface-rescan-button')
  if (rescanBtn) {
    rescanBtn.removeEventListener('click', rescan)
    rescanBtn.addEventListener('click', rescan)
  }

  const savedIp =
    loadSetting('server-ip', null) ||
    (() => {
      try {
        return localStorage.getItem('intiface-server-ip') || localStorage.getItem('server-ip')
      } catch (_e) {
        return null
      }
    })() ||
    '127.0.0.1:12345'
  const ipInput = document.getElementById('intiface-ip-input')
  if (ipInput) {
    ipInput.value = savedIp
    ipInput.addEventListener('input', (e) => {
      saveSetting('server-ip', e.target.value)
      try {
        localStorage.setItem('intiface-server-ip', e.target.value)
      } catch (_e) {}
    })
  }

  attachTimelinePlaybackHandlers()
  bindChatActionBridge()
  
  console.log(`${NAME}: Connected devices module initialized`)
  
  return {
    connect,
    disconnect,
    toggleConnection,
    rescan,
    getConnectedDevices,
    getDeviceChannel,
    setDeviceChannel,
    getDevicesOnChannel,
    getActiveChannels,
    getDeviceMotorCount,
    getDeviceDisplayName,
    getDeviceType,
    setConnectedDevices,
    stopAllDevices,
    resetChannelAssignments,
    assignAllDevicesToChannel,
    onDeviceChange,
    isClientConnected,
    updateButtonStates,
    renderDeviceList
  }
}
