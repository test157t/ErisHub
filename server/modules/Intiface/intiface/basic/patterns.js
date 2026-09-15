/**
 * Basic Waveform Patterns
 * Core patterns available to all modes
 */

const TAU = Math.PI * 2
const fract = (v) => v - Math.floor(v)
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const motorPhase = (phase, context) => {
  const motorCount = Math.max(1, Number(context?.motorCount) || 1)
  const motorIndex = Math.max(0, Number(context?.motorIndex) || 0)
  return fract(phase + (motorCount > 1 ? motorIndex / motorCount : 0))
}

const BasicPatterns = {
  sine: (phase, intensity, context) => ((Math.sin(motorPhase(phase, context) * TAU - Math.PI / 2) + 1) * 0.5) * intensity,
  triangle: (phase, intensity, context) => (1 - Math.abs(motorPhase(phase, context) * 2 - 1)) * intensity,
  square: (phase, intensity, context) => (motorPhase(phase, context) < 0.5 ? 1 : 0) * intensity,
  sawtooth: (phase, intensity, context) => motorPhase(phase, context) * intensity,
  pulse: (phase, intensity, context) => {
    const p = motorPhase(phase, context)
    if (p < 0.08) return (p / 0.08) * intensity
    if (p < 0.2) return (1 - (p - 0.08) / 0.12) * intensity
    return 0
  },
  ramp_up: (phase, intensity, context) => clamp01(motorPhase(phase, context)) * intensity,
  ramp_down: (phase, intensity, context) => (1 - clamp01(motorPhase(phase, context))) * intensity,
  wave: (phase, intensity, context) => ((Math.sin(motorPhase(phase, context) * TAU * 1.5 - Math.PI / 2) + 1) * 0.5) * intensity,
  gentle: (phase, intensity, context) => ((Math.sin(motorPhase(phase, context) * TAU - Math.PI / 2) + 1) * 0.5) * intensity * 0.45,
  heartbeat: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 2)
    const first = p < 0.14 ? (1 - (p / 0.14)) : 0
    const second = p > 0.25 && p < 0.38 ? (1 - ((p - 0.25) / 0.13)) * 0.6 : 0
    return (first + second) * intensity
  },
  double_pulse: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 2)
    if (p < 0.06) return (p / 0.06) * intensity
    if (p < 0.16) return (1 - ((p - 0.06) / 0.1)) * intensity
    return 0
  },
  stairs: (phase, intensity, context) => {
    const p = motorPhase(phase, context)
    const levels = 6
    return (Math.floor(p * levels) / (levels - 1)) * intensity
  },
  knock: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 6)
    return (p < 0.06 ? 1 : p < 0.14 ? 0.35 : 0) * intensity
  },
  rumble: (phase, intensity, context) => (((Math.sin(motorPhase(phase, context) * TAU * 0.7 - Math.PI / 2) + 1) * 0.5) * intensity),
  purr: (phase, intensity, context) => {
    const p = motorPhase(phase, context)
    return ((((Math.sin(p * TAU * 8 - Math.PI / 2) + 1) * 0.5) * 0.65) + (((Math.sin(p * TAU * 14 - Math.PI / 2) + 1) * 0.5) * 0.35)) * intensity * 0.7
  },
  throb: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 2.5)
    return (p < 0.64 ? Math.sin((p / 0.64) * Math.PI * 0.5) : 0.18) * intensity
  },
  chop: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 10)
    return (p < 0.09 ? 1 : p < 0.2 ? 0.42 : 0.08) * intensity
  },
  triplet: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 3)
    return (p < 0.08 ? 1 : p < 0.16 ? 0.55 : p < 0.24 ? 0.25 : 0) * intensity
  },
  hf_buzz: (phase, intensity, context) => (((Math.sin(motorPhase(phase, context) * TAU * 24 - Math.PI / 2) + 1) * 0.5) * intensity),
  lf_swell: (phase, intensity, context) => (((Math.sin(motorPhase(phase, context) * TAU * 0.45 - Math.PI / 2) + 1) * 0.5) * intensity),
  sweep_up: (phase, intensity, context) => Math.pow(motorPhase(phase, context), 1.3) * intensity,
  sweep_down: (phase, intensity, context) => (1 - Math.pow(motorPhase(phase, context), 1.3)) * intensity,
  gate_hold: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 2)
    return (p < 0.45 ? Math.pow(p / 0.45, 0.95) : p < 0.85 ? 0.88 : 0.08) * intensity
  },
  bounce: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 2.2)
    const tri = p < 0.5 ? p * 2 : 1 - ((p - 0.5) * 2)
    return Math.pow(tri, 0.8) * intensity
  },
  notch: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 8)
    return (p < 0.08 ? 0.95 : p < 0.18 ? 0.5 : p < 0.32 ? 0.2 : 0.06) * intensity
  },
  teasing: (phase, intensity, context) => ((Math.sin(motorPhase(phase, context) * TAU * 1.3 - Math.PI / 2) + 1) * 0.5) * intensity,
  tickle: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 10)
    return (p < 0.1 ? 0.8 : p < 0.22 ? 0.35 : 0.05) * intensity
  },
  micro_tease: (phase, intensity, context) => (((Math.sin(motorPhase(phase, context) * TAU * 6 - Math.PI / 2) + 1) * 0.5) * 0.35) * intensity,
  abrupt_edge: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 2.2)
    return (p < 0.7 ? Math.pow(p / 0.7, 1.25) : 0.08) * intensity
  },
  crescendo: (phase, intensity, context) => {
    const p = motorPhase(phase, context)
    return (Math.pow(p, 1.35) * (0.7 + ((Math.sin(p * TAU * 3 - Math.PI / 2) + 1) * 0.5) * 0.3)) * intensity
  },
  rapid_fire: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 11)
    return (p < 0.08 ? 1 : p < 0.18 ? 0.45 : p < 0.32 ? 0.2 : 0.08) * intensity
  },
  intense_waves: (phase, intensity, context) => (((Math.sin(motorPhase(phase, context) * TAU * 3.2 - Math.PI / 2) + 1) * 0.5) * intensity),
  build_and_ruin: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 2.4)
    return (p < 0.74 ? Math.pow(p / 0.74, 1.2) : p < 0.88 ? 0.95 : 0.1) * intensity
  },
  held_edge: (phase, intensity, context) => {
    const p = fract(motorPhase(phase, context) * 1.9)
    return (p < 0.56 ? Math.pow(p / 0.56, 0.9) : p < 0.9 ? 0.88 : 0.06) * intensity
  },
}

// Export for module system
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BasicPatterns
}

// Register on window for dynamic loading
if (typeof window !== 'undefined') {
  window.BasicPatterns = BasicPatterns
}
