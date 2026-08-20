import type { ReminderKind } from './health-engine'

export type PetVisual = 'exploding' | 'deflated' | 'toilet' | 'reminder' | 'sleep' | 'pressure' | 'focus' | 'greeting' | 'idle'

export interface PetVisualInput {
  exploding?: boolean
  deflated?: boolean
  reminder?: ReminderKind | null
  breakActive?: boolean
  focusing?: boolean
  pressure?: number
  greeting?: boolean
}

export function selectPetVisual(input: PetVisualInput): PetVisual {
  if (input.exploding) return 'exploding'
  if (input.deflated) return 'deflated'
  if (input.reminder === 'toilet') return 'toilet'
  if (input.reminder) return 'reminder'
  if (input.breakActive) return 'sleep'
  if ((input.pressure ?? 0) >= 55) return 'pressure'
  if (input.focusing) return 'focus'
  if (input.greeting) return 'greeting'
  return 'idle'
}
