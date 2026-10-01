import type { SVGProps } from 'react'

/** Minimal inline icon set (stroke = currentColor). Decorative by default (aria-hidden). */
type IconProps = SVGProps<SVGSVGElement>

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconMinus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12.5l5 5L19.5 7" />
  </Svg>
)
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)
export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </Svg>
)
export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5v14M16 5v14" />
  </Svg>
)
export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
  </Svg>
)
export const IconReset = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" />
  </Svg>
)
export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />
  </Svg>
)
export const IconVideo = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10.5l5-3v9l-5-3z" />
  </Svg>
)
export const IconPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
  </Svg>
)
export const IconTimer = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2.5M9 2h6" />
  </Svg>
)
export const IconToday = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <circle cx="12" cy="15" r="1.6" fill="currentColor" />
  </Svg>
)
export const IconList = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" />
  </Svg>
)
export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3" />
  </Svg>
)
export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
)
export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Svg>
)
export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
)
export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />
  </Svg>
)
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
)
export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
)
export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
)
export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l9.5 17h-19zM12 10v4M12 17.5v.01" />
  </Svg>
)
export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
)
export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />
  </Svg>
)
export const IconPaste = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5V3h6v1.5M9 11h6M9 15h4" />
  </Svg>
)
export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </Svg>
)
export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
)
