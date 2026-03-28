type AimMarkProps = {
  className?: string;
};

/** Target / crosshair mark — matches favicon, for navbar and branding. */
export function AimMark({ className }: AimMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle
        cx="16"
        cy="16"
        r="10"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle
        cx="16"
        cy="16"
        r="5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M16 5v5M16 22v5M5 16h5M22 16h5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}
