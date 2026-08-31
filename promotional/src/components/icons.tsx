/** 常用 SVG 图标（自参考站与 Lucide 提取的内联路径，避免引入图标库依赖） */
export function AppleIcon(props: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`fill-current ${props.className}`}>
      <path d="M17.05 12.54c-.02-2.27 1.86-3.37 1.95-3.42a4.2 4.2 0 0 0-3.31-1.79c-1.39-.15-2.74.83-3.45.83-.72 0-1.81-.82-2.98-.8a4.38 4.38 0 0 0-3.69 2.25c-1.6 2.77-.41 6.84 1.12 9.08.76 1.09 1.64 2.31 2.81 2.27 1.14-.05 1.57-.73 2.95-.73 1.36 0 1.77.73 2.96.7 1.23-.02 2-1.1 2.73-2.2a9.08 9.08 0 0 0 1.25-2.55 3.93 3.93 0 0 1-2.34-3.64ZM14.78 5.85a4 4 0 0 0 .92-2.86 4.1 4.1 0 0 0-2.66 1.36 3.8 3.8 0 0 0-.95 2.75 3.39 3.39 0 0 0 2.69-1.25Z" />
    </svg>
  )
}

export function WindowsIcon(props: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`fill-current ${props.className}`}>
      <path d="M2 4.2 10.5 3v8.15H2V4.2Zm9.5-1.34L22 1.35v9.8H11.5V2.86ZM2 12.15h8.5V20.3L2 19.1v-6.95Zm9.5 0H22v9.8l-10.5-1.51v-8.29Z" />
    </svg>
  )
}

export function InfoIcon(props: { className: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}

export function ChevronDownIcon(props: { className: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function AppLogo(props: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`fill-current ${props.className}`}>
      <path d="M12.9 2.4c-.3-.9-1.5-.9-1.8 0L9.6 6.9c-.1.4-.5.7-.9.7H4.1c-1 0-1.4 1.2-.6 1.8l3.6 2.6c.3.2.5.7.4 1l-1.4 4.4c-.3.9.7 1.7 1.5 1.1l3.7-2.7c.3-.3.8-.3 1.1 0l3.7 2.7c.8.6 1.8-.2 1.5-1.1l-1.4-4.4c-.1-.3 0-.8.3-1l3.6-2.6c.8-.6.4-1.8-.6-1.8h-4.5c-.4 0-.8-.3-.9-.7l-1.6-4.5Z" />
    </svg>
  )
}
