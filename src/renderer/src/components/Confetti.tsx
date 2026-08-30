import React, { useMemo } from 'react'

// 升级 / 陪伴里程碑时的小范围撒花（纯 CSS 粒子，无新素材）
const PIECE_COUNT = 48
const COLORS = ['#f17b62', '#ffb6c1', '#a8cc45', '#ffd166', '#7fc8f8', '#e39ff0']

// 判断某个视觉状态是否值得撒花：dance（里程碑）或 transform + 我长大啦（升级）
export function celebrationKey(visual: string, message: string): string {
  if (visual === 'dance') return `dance:${message}`
  if (visual === 'transform' && message.includes('我长大啦')) return `levelup:${message}`
  return ''
}

interface Piece {
  left: number
  delay: number
  duration: number
  size: number
  color: string
  rotate: number
  drift: number
  round: boolean
}

export function Confetti(): React.JSX.Element {
  const pieces = useMemo<Piece[]>(() => Array.from({ length: PIECE_COUNT }, (_, index) => ({
    left: 4 + ((index * 37) % 92),
    delay: (index % 12) * 0.08,
    duration: 2.2 + ((index * 13) % 10) / 10,
    size: 6 + ((index * 7) % 6),
    color: COLORS[index % COLORS.length],
    rotate: (index * 53) % 360,
    drift: ((index * 29) % 60) - 30,
    round: index % 3 === 0
  })), [])
  return <div className="confetti-layer" aria-hidden="true">
    {pieces.map((piece, index) => <i
      key={index}
      style={{
        left: `${piece.left}%`,
        width: piece.size,
        height: piece.round ? piece.size : piece.size * 0.55,
        background: piece.color,
        borderRadius: piece.round ? '50%' : 2,
        animationDelay: `${piece.delay}s`,
        animationDuration: `${piece.duration}s`,
        ['--drift' as string]: `${piece.drift}px`,
        ['--spin' as string]: `${piece.rotate + 360}deg`
      }}
    />)}
  </div>
}
