import { useEffect, useState } from 'react'

/**
 * 响应式断点探测：用于在 JS 层控制 3D 背景的挂载——
 * 不能只靠 CSS hidden，否则移动端仍会加载 three.js chunk 并运行 Canvas。
 */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches)
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [query])

  return matches
}
