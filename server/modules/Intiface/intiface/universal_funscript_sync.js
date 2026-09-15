/**
 * Universal Funscript Sync Module
 * Handles funscript playback for ANY source (timeline, media, etc.)
 * Each source gets its own worker to prevent crosstalk
 */

import {
  getConnectedDevices,
  getDeviceChannel,
  getDevicesOnChannel,
  isClientConnected,
  getButtplug
} from './connected_devices.js'
import { runDeviceOutput } from './device_output.js'

// Active sync workers
let syncWorkers = new Map() // workerId -> { channelFunscripts, channelLastIndex, isPlaying, intervalId, getCurrentTime, dynamicIntervalMs }
let workerIdCounter = 0

// Polling rate
let pollingRate = 30 // Hz

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * Initialize sync system
 */
export function initSync(pollingRateHz = 30) {
  pollingRate = pollingRateHz
}

/**
 * Start a new sync worker
 * @param {Object} channelFunscripts - Map of channel -> funscript
 * @param {Function} getCurrentTime - Function returning current time in ms
 * @returns {string} workerId
 */
export function startSync(channelFunscripts, getCurrentTime) {
  const workerId = `sync_${++workerIdCounter}`
  
  // Initialize per-channel action indices
  const channelLastIndex = {}
  Object.keys(channelFunscripts).forEach(channel => {
    if (channelFunscripts[channel]?.actions?.length > 0) {
      channelLastIndex[channel] = 0
    }
  })
  
  const worker = {
    id: workerId,
    channelFunscripts,
    channelLastIndex,
    isPlaying: true,
    getCurrentTime,
    intervalId: null,
    dynamicIntervalMs: Math.round(1000 / pollingRate)
  }
  
  syncWorkers.set(workerId, worker)
  
  // Start the sync loop for this worker
  runSyncWorker(workerId)
  
  return workerId
}

/**
 * Pause a sync worker
 * @param {string} workerId 
 */
export function pauseSync(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker) return false
  
  worker.isPlaying = false
  if (worker.intervalId) {
    clearTimeout(worker.intervalId)
    worker.intervalId = null
  }
  
  return true
}

/**
 * Resume a sync worker
 * @param {string} workerId 
 */
export function resumeSync(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker || worker.isPlaying) return false
  
  worker.isPlaying = true
  runSyncWorker(workerId)
  
  return true
}

/**
 * Stop and remove a sync worker
 * @param {string} workerId 
 */
export function stopSync(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker) return false
  
  worker.isPlaying = false
  if (worker.intervalId) {
    clearTimeout(worker.intervalId)
    worker.intervalId = null
  }
  
  syncWorkers.delete(workerId)
  return true
}

/**
 * Stop all sync workers
 */
export function stopAllSync() {
  syncWorkers.forEach((worker, id) => {
    stopSync(id)
  })
}

/**
 * Get sync worker status
 * @param {string} workerId 
 * @returns {Object|null}
 */
export function getSyncStatus(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker) return null
  
  return {
    id: worker.id,
    isPlaying: worker.isPlaying,
    channels: Object.keys(worker.channelFunscripts),
    currentPosition: worker.getCurrentTime()
  }
}

/**
 * Seek to a time position in a sync worker
 * @param {string} workerId 
 * @param {number} timeMs 
 */
export function seekSync(workerId, timeMs) {
  const worker = syncWorkers.get(workerId)
  if (!worker) return false
  
  // Recalculate action indices for all channels
  Object.keys(worker.channelFunscripts).forEach(channel => {
    const funscript = worker.channelFunscripts[channel]
    if (!funscript?.actions?.length) return
    
    let newIndex = 0
    for (let i = 0; i < funscript.actions.length; i++) {
      if (funscript.actions[i].at <= timeMs) {
        newIndex = i + 1
      } else {
        break
      }
    }
    worker.channelLastIndex[channel] = newIndex
  })
  
  return true
}

/**
 * Get all active worker IDs
 */
export function getActiveWorkers() {
  return Array.from(syncWorkers.keys())
}

/**
 * Run the sync loop for a specific worker
 */
async function runSyncWorker(workerId) {
  const worker = syncWorkers.get(workerId)
  if (!worker || !worker.isPlaying) return
  
  if (!isClientConnected()) {
    stopSync(workerId)
    return
  }
  
  const tickStartedAt = nowMs()
  const currentTime = worker.getCurrentTime()
  const dispatches = []
  
  // Process actions from each channel
  Object.keys(worker.channelFunscripts).forEach(channel => {
    const funscript = worker.channelFunscripts[channel]
    if (!funscript?.actions?.length) return
    
    const actions = funscript.actions
    const lastIndex = worker.channelLastIndex[channel] || 0

    let newestDueIndex = -1
    for (let i = lastIndex; i < actions.length; i++) {
      if (actions[i].at <= currentTime) {
        newestDueIndex = i
      } else {
        break
      }
    }

    if (newestDueIndex >= lastIndex) {
      const newestAction = actions[newestDueIndex]
      worker.channelLastIndex[channel] = newestDueIndex + 1
      const nextAction = actions[newestDueIndex + 1]
      const moveDuration = nextAction
        ? Math.max(50, Math.min(1000, Math.round(Number(nextAction.at) - Number(newestAction.at))))
        : 120
      dispatches.push(
        executeFunscriptAction(newestAction, channel, moveDuration).catch(() => false)
      )
    }
  })

  if (dispatches.length > 0) {
    await Promise.allSettled(dispatches)
  }
  
  // Schedule next iteration
  if (worker.isPlaying) {
    const baseInterval = Math.round(1000 / pollingRate)
    const tickElapsed = nowMs() - tickStartedAt

    if (!Number.isFinite(worker.dynamicIntervalMs)) {
      worker.dynamicIntervalMs = baseInterval
    }

    if (tickElapsed > baseInterval * 1.2) {
      worker.dynamicIntervalMs = Math.min(100, Math.round(worker.dynamicIntervalMs * 1.25))
    } else {
      worker.dynamicIntervalMs = Math.max(baseInterval, Math.round(worker.dynamicIntervalMs * 0.9))
    }

    const interval = Math.max(baseInterval, worker.dynamicIntervalMs)
    const waitMs = Math.max(1, Math.round(interval - tickElapsed))
    worker.intervalId = setTimeout(() => {
      runSyncWorker(workerId).catch(() => {
        stopSync(workerId)
      })
    }, waitMs)
  }
}

function getFeatureOutputMap(feature) {
  return feature?._feature?.Output || feature?.Output || null
}

function hasDeviceOutput(device, buttplug, names) {
  const outputTypes = names.map((name) => buttplug?.OutputType?.[name] || name)

  if (device?.messageAttributes?.LinearCmd !== undefined && names.some((name) => name === 'PositionWithDuration' || name === 'HwPositionWithDuration' || name === 'Position')) {
    return true
  }
  if (Array.isArray(device?.linearAttributes) && device.linearAttributes.length > 0 && names.some((name) => name === 'PositionWithDuration' || name === 'HwPositionWithDuration' || name === 'Position')) {
    return true
  }
  if (Array.isArray(device?.vibrateAttributes) && device.vibrateAttributes.length > 0 && names.includes('Vibrate')) {
    return true
  }

  if (typeof device?.hasOutput === 'function') {
    for (const outputType of outputTypes) {
      try {
        if (device.hasOutput(outputType)) return true
      } catch (_e) {}
    }
  }

  if (device?.features && typeof device.features.values === 'function') {
    for (const feature of device.features.values()) {
      const outputMap = getFeatureOutputMap(feature)
      for (const outputType of outputTypes) {
        const type = String(outputType)
        try {
          if (outputMap && Object.prototype.hasOwnProperty.call(outputMap, type)) return true
          if (typeof feature?.hasOutput === 'function' && feature.hasOutput(outputType)) return true
        } catch (_e) {}
      }
    }
  }

  return false
}

function isLinearDevice(device, buttplug) {
  return hasDeviceOutput(device, buttplug, ['PositionWithDuration', 'HwPositionWithDuration', 'Position'])
}

async function applyActionToDevice(device, action, buttplug, duration = 120) {
  const normalizeActionPosToUnit = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0

    // Support common position encodings: 0..100, 0..1, and legacy -1..1.
    if (numeric >= 0 && numeric <= 1) {
      return numeric
    }
    if (numeric >= -1 && numeric <= 1) {
      return (numeric + 1) / 2
    }
    if (numeric >= 0 && numeric <= 100) {
      return numeric / 100
    }
    return Math.max(0, Math.min(1, numeric))
  }

  const positions = Array.isArray(action.pos) ? action.pos : [action.pos]
  const firstPos = normalizeActionPosToUnit(positions[0])
  if (isLinearDevice(device, buttplug)) {
    return await runDeviceOutput(device, buttplug, 'PositionWithDuration', firstPos, duration)
  }
  return await runDeviceOutput(device, buttplug, 'Vibrate', firstPos)
}

/**
 * Execute a funscript action to devices on a specific channel
 * @param {Object} action - Funscript action { at, pos }
 * @param {string} channel - Channel letter (A, B, C, D)
 */
async function executeFunscriptAction(action, channel, duration = 120) {
  const devices = getDevicesOnChannel(channel)
  const buttplug = getButtplug()

  if (devices.length === 0 || !buttplug) return
  
  const promises = []

  for (const device of devices) {
    promises.push(
      applyActionToDevice(device, action, buttplug, duration).catch((e) => {
        console.error('[UniversalSync]: Error executing action:', e)
        return false
      })
    )
  }

  if (promises.length > 0) {
    await Promise.all(promises)
  }
}

/**
 * Update polling rate
 * @param {number} rateHz 
 */
export function setPollingRate(rateHz) {
  pollingRate = Math.max(10, Math.min(120, rateHz))
}

/**
 * Get current polling rate
 */
export function getPollingRate() {
  return pollingRate
}

// Default export
export default {
  initSync,
  startSync,
  pauseSync,
  resumeSync,
  stopSync,
  stopAllSync,
  seekSync,
  getSyncStatus,
  getActiveWorkers,
  setPollingRate,
  getPollingRate
}
