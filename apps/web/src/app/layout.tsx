import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const jakarta = localFont({ src: "./fonts/PlusJakartaSans-Variable.woff2", variable: "--font-jakarta", weight: "300 800", display: "swap" });
const jbmono = localFont({ src: "./fonts/JetBrainsMono-Variable.woff2", variable: "--font-jbmono", weight: "400 700", display: "swap" });

export const metadata: Metadata = {
  title: { default: "JustDownload — inspect, download and convert media you're allowed to", template: "%s · JustDownload" },
  description: "Paste a media link or drop a file. JustDownload inspects the real streams, offers only the formats that exist, and converts with FFmpeg. Policy-aware: restricted platforms are never scraped.",
  applicationName: "JustDownload",
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0b0c0f" }, { media: "(prefers-color-scheme: light)", color: "#e9eef5" }],
  width: "device-width",
  initialScale: 1,
};

// Runs before paint so the saved theme (light | dark | system) never flashes.
const bootScript = `(function(){try{var d=document.documentElement,t=localStorage.getItem('jd-theme');if(t==='system'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';d.dataset.themePref='system';}if(t==='light'||t==='dark'){d.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${jakarta.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body className="jd-ambient min-h-dvh bg-bg text-fg antialiased">
        <a href="#main" className="jd-accent-fill sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:px-4 focus:py-2">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
