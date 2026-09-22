/**
 * Inline icons.
 *
 * Hand-drawn on a 24-grid with a 2px stroke so they stay legible when scaled
 * up for the driving layout, where nothing smaller than 28px is any use.
 */

export interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

export const IconClose = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconChevronLeft = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const IconChevronRight = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const IconMegaphone = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M4 10v4a1 1 0 0 0 1 1h3l6 4V5L8 9H5a1 1 0 0 0-1 1Z" />
    <path d="M18 9a4 4 0 0 1 0 6" />
  </svg>
);

export const IconFit = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

export const IconLocate = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export const IconShare = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
  </svg>
);

export const IconFlag = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M6 21V4M6 4h11l-2 3.5L17 11H6" />
  </svg>
);

export const IconCar = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <path d="M4 16v2.5M20 16v2.5" />
    <path d="M3 16v-3.2a2 2 0 0 1 .4-1.2L5.8 8A2 2 0 0 1 7.4 7h9.2a2 2 0 0 1 1.6.8l2.4 3.6a2 2 0 0 1 .4 1.2V16Z" />
    <path d="M7 12.5h.01M17 12.5h.01" />
  </svg>
);

export const IconParked = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M9.5 16.5v-9h3a2.75 2.75 0 0 1 0 5.5h-3" />
  </svg>
);

export const IconSteering = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
    <path d="M3.2 10.5h17.6M12 15v6" />
  </svg>
);

export const IconPeople = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.5a3 3 0 0 1 0 5M17.5 19a5.6 5.6 0 0 0-2-4.3" />
  </svg>
);

export const IconSearch = ({ size = 24, className }: IconProps): JSX.Element => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);
