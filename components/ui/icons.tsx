import type { SVGProps } from "react";

/**
 * A small, hand-drawn icon set.
 *
 * Drawn rather than imported for two reasons. Icon packs have a house style,
 * and a finance terminal wearing the same rounded 2px-stroke set as every
 * other product on the internet is instantly placeable. And the whole set here
 * costs about a kilobyte, against a dependency that ships thousands of glyphs
 * to deliver twenty.
 *
 * Common geometry: a 16-unit box, 1.4 stroke, square-ish joins. The weight is
 * deliberately lighter than the usual 2px so icons sit level with 10px caps
 * rather than shouting over them.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconPulse = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1 8h3l2-5 3 10 2-5h4" />
  </Icon>
);

export const IconGlobe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.4" />
    <path d="M1.6 8h12.8M8 1.6c1.7 1.8 2.6 4 2.6 6.4S9.7 12.6 8 14.4C6.3 12.6 5.4 10.4 5.4 8S6.3 3.4 8 1.6Z" />
  </Icon>
);

export const IconChart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 13.5V2.5M2 13.5h12" />
    <path d="M4.8 11V7.4M7.6 11V4.2M10.4 11V8.8M13.2 11V5.6" />
  </Icon>
);

export const IconLayers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.8 14.4 5 8 8.2 1.6 5 8 1.8Z" />
    <path d="m1.6 8.4 6.4 3.2 6.4-3.2M1.6 11.4l6.4 3.2 6.4-3.2" />
  </Icon>
);

export const IconFilter = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.8 2.6h12.4L9.4 8.2v4.6l-2.8 1.6V8.2L1.8 2.6Z" />
  </Icon>
);

export const IconBriefcase = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.6" y="4.6" width="12.8" height="9" rx="1.2" />
    <path d="M5.6 4.6V3.4a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v1.2M1.6 8.2h12.8" />
  </Icon>
);

export const IconBell = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.8a4 4 0 0 0-4 4v2.6L2.6 11h10.8L12 8.4V5.8a4 4 0 0 0-4-4Z" />
    <path d="M6.4 11a1.6 1.6 0 0 0 3.2 0" />
  </Icon>
);

export const IconStar = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 1.8 1.9 4 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8Z" />
  </Icon>
);

export const IconStarFilled = (p: IconProps) => (
  <Icon fill="currentColor" {...p}>
    <path d="m8 1.8 1.9 4 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8Z" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.6" />
    <path d="m10.4 10.4 3.2 3.2" />
  </Icon>
);

export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.6 8h10.8M9.4 4l4 4-4 4" />
  </Icon>
);

export const IconArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.4 11.6 11.6 4.4M5.6 4.4h6v6" />
  </Icon>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3.6 6 4.4 4.4L12.4 6" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.8v10.4M2.8 8h10.4" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3.6 3.6 8.8 8.8M12.4 3.6l-8.8 8.8" />
  </Icon>
);

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.6 4.2h10.8M5.4 4.2V2.9a.9.9 0 0 1 .9-.9h3.4a.9.9 0 0 1 .9.9v1.3" />
    <path d="M4 4.2 4.7 13a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4.2" />
  </Icon>
);

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M12.9 9.8a1.1 1.1 0 0 0 .2 1.2l.1.1a1.3 1.3 0 1 1-1.9 1.9l-.1-.1a1.1 1.1 0 0 0-1.2-.2 1.1 1.1 0 0 0-.7 1v.2a1.3 1.3 0 1 1-2.6 0v-.1a1.1 1.1 0 0 0-.7-1 1.1 1.1 0 0 0-1.2.2l-.1.1a1.3 1.3 0 1 1-1.9-1.9l.1-.1a1.1 1.1 0 0 0 .2-1.2 1.1 1.1 0 0 0-1-.7h-.2a1.3 1.3 0 1 1 0-2.6h.1a1.1 1.1 0 0 0 1-.7 1.1 1.1 0 0 0-.2-1.2l-.1-.1a1.3 1.3 0 1 1 1.9-1.9l.1.1a1.1 1.1 0 0 0 1.2.2h.1a1.1 1.1 0 0 0 .7-1v-.2a1.3 1.3 0 1 1 2.6 0v.1a1.1 1.1 0 0 0 .7 1 1.1 1.1 0 0 0 1.2-.2l.1-.1a1.3 1.3 0 1 1 1.9 1.9l-.1.1a1.1 1.1 0 0 0-.2 1.2v.1a1.1 1.1 0 0 0 1 .7h.2a1.3 1.3 0 1 1 0 2.6h-.1a1.1 1.1 0 0 0-1 .7Z" />
  </Icon>
);

export const IconLogout = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 14H3.4A1.4 1.4 0 0 1 2 12.6V3.4A1.4 1.4 0 0 1 3.4 2H6" />
    <path d="m10.2 11.2 3.2-3.2-3.2-3.2M13.4 8H6" />
  </Icon>
);

export const IconUser = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="5.4" r="2.8" />
    <path d="M2.6 14a5.4 5.4 0 0 1 10.8 0" />
  </Icon>
);

export const IconLock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="7" width="10" height="7" rx="1.2" />
    <path d="M5.4 7V5a2.6 2.6 0 0 1 5.2 0v2" />
  </Icon>
);

export const IconMail = (p: IconProps) => (
  <Icon {...p}>
    <rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.2" />
    <path d="m1.8 4.6 6.2 4 6.2-4" />
  </Icon>
);

export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1 8s2.6-4.4 7-4.4S15 8 15 8s-2.6 4.4-7 4.4S1 8 1 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </Icon>
);

export const IconEyeOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.3 4A6.9 6.9 0 0 1 8 3.6c4.4 0 7 4.4 7 4.4a12 12 0 0 1-2.1 2.7M4.1 5.3A12 12 0 0 0 1 8s2.6 4.4 7 4.4a6.6 6.6 0 0 0 2.2-.4" />
    <path d="M2.4 2.4 13.6 13.6M6.7 6.8a1.9 1.9 0 0 0 2.6 2.6" />
  </Icon>
);

export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.6 8a5.6 5.6 0 1 1-1.7-4" />
    <path d="M13.8 2.4v3.4h-3.4" />
  </Icon>
);

export const IconExternal = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 2.6h4.4V7M13.4 2.6 7.8 8.2" />
    <path d="M12 9.6v2.8a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2.8" />
  </Icon>
);

export const IconScale = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2v12M3 5.2h10M3 5.2 1.4 9.4a2.2 2.2 0 0 0 3.2 0L3 5.2ZM13 5.2l-1.6 4.2a2.2 2.2 0 0 0 3.2 0L13 5.2Z" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.4V8l2.4 1.4" />
  </Icon>
);

export const IconCommand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.6 2.4a1.8 1.8 0 1 0 0 3.6h4.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0-1.8 1.8v7.6a1.8 1.8 0 1 0 1.8-1.8H5.6a1.8 1.8 0 1 0 1.8 1.8V4.2a1.8 1.8 0 0 0-1.8-1.8Z" />
  </Icon>
);

export const IconSpark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.4 9.4 6l4.6 1.4L9.4 8.8 8 13.4 6.6 8.8 2 7.4 6.6 6 8 1.4Z" />
  </Icon>
);

export const IconGoogle = (p: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden {...p}>
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
    />
  </svg>
);
