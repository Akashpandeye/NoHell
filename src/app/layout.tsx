import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { IBM_Plex_Mono } from "next/font/google";

import { clerkAppearance } from "@/lib/clerk-appearance";
import { OnboardingGate } from "@/components/auth/OnboardingGate";

import "./globals.css";

/**
 * Web-loaded fallback. Berkeley Mono (preferred) is resolved via local install
 * or files in /public/fonts — see globals.css @font-face.
 */
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "NoHell — Focus past tutorial hell",
  description:
    "A focused learning layer for coding tutorials: live notes, revision beats, and recall prompts while you watch — so you learn instead of binge.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "NoHell — Focus past tutorial hell",
    description:
      "Skip tutorial hell. Paste a YouTube lesson and stay in flow with structured notes and recall.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexMono.variable} h-full scroll-smooth antialiased`}
    >
      {/* Inline fallback colors so first paint isn’t white if CSS is late (reload / sign-out). */}
      <body
        className="min-h-full flex flex-col bg-[#040807] font-mono text-[#ecfdf5] antialiased"
        style={{
          backgroundColor: "#040807",
          color: "#ecfdf5",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ClerkProvider appearance={clerkAppearance} afterSignOutUrl="/">
          <OnboardingGate>{children}</OnboardingGate>
        </ClerkProvider>
      </body>
    </html>
  );
}
