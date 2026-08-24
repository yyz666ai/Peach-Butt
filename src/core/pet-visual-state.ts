import type { ReminderKind } from './health-engine'

export type PetVisual = 'exploding' | 'deflated' | 'recovering' | 'stretch' | 'water-prompt' | 'toilet' | 'eye-rest' | 'reminder' | 'sleep' | 'rest' | 'pressure' | 'focus' | 'greeting' | 'idle'

export interface PetVisualInput {
  exploding?: boolean
  deflated?: boolean
  recovering?: boolean
  restCurrent?: ReminderKind | null
  restCompleted?: boolean
  longBreak?: boolean
  reminder?: ReminderKind | null
  breakActive?: boolean
  focusing?: boolean
  pressure?: number
  greeting?: boolean
}

export function selectPetVisual(input: PetVisualInput): PetVisual {
  if (input.exploding) return 'exploding'
  if (input.deflated) return 'deflated'
  if (input.recovering) return 'recovering'
  if (input.restCurrent === 'stand') return 'stretch'
  if (input.restCurrent === 'water') return 'water-prompt'
  if (input.restCurrent === 'toilet') return 'toilet'
  if (input.restCurrent === 'eyes') return 'eye-rest'
  if (input.breakActive && input.restCompleted) return input.longBreak ? 'sleep' : 'rest'
  if (input.reminder === 'toilet') return 'toilet'
  if (input.reminder) return 'reminder'
  if (input.breakActive && input.longBreak) return 'sleep'
  if ((input.pressure ?? 0) >= 55) return 'pressure'
  if (input.focusing) return 'focus'
  if (input.greeting) return 'greeting'
  return 'idle'
}
