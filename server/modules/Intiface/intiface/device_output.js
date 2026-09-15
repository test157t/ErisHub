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

function createOutput(buttplug, outputName, normalized, duration) {
  if (outputName === 'PositionWithDuration') {
    return buttplug.DeviceOutput.PositionWithDuration?.percent?.(normalized, duration)
      || buttplug.DeviceOutput.HwPositionWithDuration?.percent?.(normalized, duration)
      || buttplug.DeviceOutput.Position?.percent?.(normalized)
  }
  return buttplug.DeviceOutput[outputName]?.percent?.(normalized)
}

export async function runDeviceOutput(device, buttplug, outputName, value, duration = 120) {
  if (typeof device?.runOutput !== 'function') {
    throw new Error('Device does not expose runOutput')
  }
  if (!buttplug?.DeviceOutput) {
    throw new Error('Buttplug DeviceOutput API is unavailable')
  }

  const normalized = Math.max(0, Math.min(1, Number(value) || 0))
  const resolvedOutputName = outputName === 'Vibrate' && isLinearDevice(device, buttplug) ? 'PositionWithDuration' : outputName
  const output = createOutput(buttplug, resolvedOutputName, normalized, duration)

  if (!output) {
    throw new Error(`Unsupported output type: ${resolvedOutputName}`)
  }

  await device.runOutput(output)
  return true
}

export async function runDeviceOutputs(device, buttplug, outputName, values, duration = 120) {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => Math.max(0, Math.min(1, Number(value) || 0)))
    : [Math.max(0, Math.min(1, Number(values) || 0))]

  if (normalizedValues.length <= 1) {
    return await runDeviceOutput(device, buttplug, outputName, normalizedValues[0] || 0, duration)
  }

  if (outputName === 'Vibrate' && isLinearDevice(device, buttplug)) {
    return await runDeviceOutput(device, buttplug, 'PositionWithDuration', normalizedValues[0] || 0, duration)
  }

  if (!buttplug?.DeviceOutput) {
    throw new Error('Buttplug DeviceOutput API is unavailable')
  }

  const outputType = buttplug.OutputType?.[outputName] || outputName
  const features = device?.features && typeof device.features.values === 'function'
    ? Array.from(device.features.values()).filter((feature) => {
      try {
        return typeof feature?.hasOutput === 'function' && feature.hasOutput(outputType)
      } catch (_error) {
        return false
      }
    })
    : []

  if (!features.length) {
    return await runDeviceOutput(device, buttplug, outputName, Math.max(...normalizedValues), duration)
  }

  await Promise.all(features.map((feature, index) => {
    const value = normalizedValues[Math.min(index, normalizedValues.length - 1)] || 0
    const output = createOutput(buttplug, outputName, value, duration)
    if (!output || typeof feature?.runOutput !== 'function') return Promise.resolve(false)
    return feature.runOutput(output)
  }))
  return true
}

export async function stopDeviceOutput(device) {
  if (typeof device?.stop !== 'function') {
    throw new Error('Device does not expose stop')
  }

  await device.stop()
  return true
}
