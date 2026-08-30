import { describe, expect, it } from 'vitest'
import { celebrationKey } from './Confetti'

describe('celebrationKey', () => {
  it('celebrates the companion milestone dance', () => {
    expect(celebrationKey('dance', '我们互相陪伴 7 天啦！')).toBe('dance:我们互相陪伴 7 天啦！')
  })

  it('celebrates growth level-ups but not ordinary transforms', () => {
    expect(celebrationKey('transform', '我长大啦！现在是圆桃了！')).toBe('levelup:我长大啦！现在是圆桃了！')
    expect(celebrationKey('transform', '休息够啦，恢复活力！')).toBe('')
  })

  it('does not celebrate other visuals', () => {
    expect(celebrationKey('idle', '我会安静陪你')).toBe('')
    expect(celebrationKey('greeting', '早上好呀')).toBe('')
  })
})
