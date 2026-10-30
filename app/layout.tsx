import type { Metadata } from "next";
import { Poppins, Unbounded } from "next/font/google";
import { SiteFooter } from "@/components/site/SiteFooter";
import "./globals.css";
import { Providers } from "./providers";

const display = Unbounded({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-display-face", display: "swap" });
const body = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body-face", display: "swap" });

/** The product's name (renamed from Likeness, 2026-10-30) and tagline. */
const PRODUCT = "Assent";
const TAGLINE = "Your face. Your terms. Your yes.";
const DESCRIPTION = `${TAGLINE} Creators license their likeness for AI image ads, priced by their audience; brands generate consented ads in minutes and pay per render; anyone can verify a file.`;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { default: `${PRODUCT}: ${TAGLINE}`, template: `%s · ${PRODUCT}` },
  description: DESCRIPTION,
  openGraph: { type: "website", siteName: PRODUCT, title: `${PRODUCT}: ${TAGLINE}`, description: DESCRIPTION },
  twitter: { card: "summary", title: `${PRODUCT}: ${TAGLINE}`, description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen bg-ink font-sans text-ink">
        {/* For screen recordings on localhost: NEXT_PUBLIC_HIDE_DEV_OVERLAY=1 hides Next's dev overlay
            (its badge and issue toasts, including errors thrown by browser extensions). Dev only. */}
        {process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_HIDE_DEV_OVERLAY === "1" && <style>{"nextjs-portal{display:none!important}"}</style>}
        <a href="#main" className="sr-only z-50 rounded-full bg-lime px-5 py-3 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to content
        </a>
        <Providers>
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
