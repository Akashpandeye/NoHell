import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Bricolage_Grotesque, JetBrains_Mono, Syne } from "next/font/google";

import { clerkAppearance } from "@/lib/clerk-appearance";

import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "NoHell — Focus past tutorial hell",
  description:
    "A focused learning layer for coding tutorials: live notes, revision beats, and recall prompts while you watch — so you learn instead of binge.",
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
    <ClerkProvider appearance={clerkAppearance} afterSignOutUrl="/">
      <html
        lang="en"
        className={`${syne.variable} ${bricolage.variable} ${jetbrainsMono.variable} h-full scroll-smooth antialiased`}
      >
        <body className="min-h-full flex flex-col font-sans">{children}</body>
      </html>
    </ClerkProvider>
  );
}
