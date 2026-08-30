import type { PipeachApi } from '../../shared/contracts'

declare global {
  interface Window { pipeach: PipeachApi }
}

export {}
