import type { Metadata } from "next";
import { Geist, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Threshold — Where agents work, and you decide where it stops",
  description:
    "An agent-driven ops game built on TrueForge. Walk districts run by live AI agents. Approve or deny real actions. Where the agent stops is up to you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Browser extensions (e.g. crxlauncher) add attributes to <html>/<body> before hydration.
      suppressHydrationWarning
      className={cn(
        "h-full antialiased font-sans",
        geist.variable,
        bricolage.variable
      )}
    >
      <body className="min-h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
