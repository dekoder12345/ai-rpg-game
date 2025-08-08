import { useEffect, useRef } from 'react'

export function useAudio(src: string, volume = 1) {
  const ref = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const audio = new Audio(src)
    audio.preload = 'auto'
    audio.volume = volume
    ref.current = audio
    return () => {
      audio.pause()
      // @ts-expect-error - release if possible
      audio.src = ''
    }
  }, [src, volume])

  return {
    play: () => {
      if (ref.current) {
        try { ref.current.currentTime = 0 } catch {}
        ref.current.play().catch(() => {})
      }
    },
    stop: () => {
      if (ref.current) {
        ref.current.pause()
        ref.current.currentTime = 0
      }
    },
  }
}
