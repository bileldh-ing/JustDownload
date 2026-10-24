/** JustDownload mark: rounded blue tile with a downward arrow landing on a tray. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="jd-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4d8dff" />
          <stop offset="0.55" stopColor="#2160e6" />
          <stop offset="1" stopColor="#1a4fd0" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="10" fill="url(#jd-g)" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="9.5" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" />
      <path d="M16 8.5v10.5M11.5 14.8 16 19.3l4.5-4.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 21.5v1.2a1.8 1.8 0 0 0 1.8 1.8h9.4a1.8 1.8 0 0 0 1.8-1.8v-1.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="24" cy="9" r="2" fill="#5ef0c8" stroke="#0b1f4d" strokeWidth="0.8" />
    </svg>
  );
}

export function Wordmark() {
  return <span className="text-[15.5px] font-bold tracking-tight">Just<span className="text-accent">Download</span></span>;
}
