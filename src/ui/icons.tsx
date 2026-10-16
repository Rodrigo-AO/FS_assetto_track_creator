import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function icon(paths: ReactElement) {
  return function Icon({ size = 20, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
        {paths}
      </svg>
    );
  };
}

export const AreaIcon = icon(
  <>
    <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3" />
    <path d="M9 4h2M13 4h2M20 9v2M20 13v2M9 20h2M13 20h2M4 9v2M4 13v2" />
  </>,
);
export const ConeIcon = icon(
  <>
    <path d="M10.5 4h3l4.5 14h-12z" />
    <path d="M8.3 11h7.4" />
    <path d="M4 20h16" />
  </>,
);
export const FlagIcon = icon(
  <>
    <path d="M5 21V4" />
    <path d="M5 4h14v10H5" />
    <path d="M5 9h14M12 4v10M8.5 4v5M15.5 9v5" />
  </>,
);
export const SectorIcon = icon(
  <>
    <path d="M3 17c4-8 8-8 12-4s5 2 6-2" />
    <path d="M9 6v6M15 9v6" strokeDasharray="2 2" />
  </>,
);
export const SurfaceIcon = icon(
  <>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </>,
);
export const TrackIcon = icon(
  <>
    <path d="M4 18c0-6 4-6 6-10s6-4 8-1" />
    <circle cx="4" cy="18" r="1.6" />
    <circle cx="18" cy="7" r="1.6" />
    <path d="M18 7l3-3" />
  </>,
);
export const ExportIcon = icon(
  <>
    <path d="M12 4v11" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 20h14" />
  </>,
);
export const UndoIcon = icon(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />);
export const RedoIcon = icon(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />);
export const ChevronLeftIcon = icon(<path d="M15 6l-6 6 6 6" />);
export const ChevronDownIcon = icon(<path d="M6 9l6 6 6-6" />);
export const MapPinIcon = icon(
  <>
    <path d="M12 21s-6-5.6-6-11a6 6 0 0112 0c0 5.4-6 11-6 11z" />
    <circle cx="12" cy="10" r="2.2" />
  </>,
);
export const ChevronRightIcon = icon(<path d="M9 6l6 6-6 6" />);
export const BackIcon = icon(<path d="M19 12H5M11 6l-6 6 6 6" />);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </>,
);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const EditIcon = icon(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const TrashIcon = icon(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />);
