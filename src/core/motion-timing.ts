import type { ReminderKind } from '../shared/contracts'

/**
 * Runtime-owned durations of the authored clips. Keep these in milliseconds so
 * the rest carousel and its transient states use the same fixed-camera span.
 */
export const REST_CLIP_DURATION_MS: Record<ReminderKind, number> = {
  stand: 4_000,
  water: 8_350,
  toilet: 5_800,
  eyes: 5_000
}

export const WATER_PROMPT_DURATION_MS = REST_CLIP_DURATION_MS.water
export const RECOVERY_REST_REQUIRED_SECONDS = 5 * 60
