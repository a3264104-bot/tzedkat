import type { Metadata, Viewport } from "next";
import InstallPrompt from "@/components/InstallPrompt";
import { Footer } from "@/components/Footer";
import { AccessibilityWidget } from "@/components/AccessibilityWidget";
import "./globals.css";
// §62: באנר "מחובר כ-X" - חייב לשבת כאן כדי להופיע בכל עמוד,
// כולל /account ו-/order שאליהם המנהל מגיע בזמן כניסה בשם משתמש.
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
// §68: כפתור חזרה גלובלי (סעיף 6) - מופיע בכל דף אוטומטית,
// למעט מסכים שבהם הוא מיותר. ראה HIDE_EXACT בקומפוננטה.
import { FloatingBackButton } from "@/components/FloatingBackButton";

const SITE_URL = "https://tzidkat.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "צדקת רבותינו — עופות, בשר ודגים",
    template: "%s | צדקת רבותינו",
  },
  description:
    "צדקת רבותינו — הזמנת עופות טריים, בשר בקר ודגים לכבוד שבת ויום טוב. מכירות תקופתיות עם חלוקה בנקודות איסוף. הזמנה נוחה ומאובטחת.",
  keywords: [
    "צדקת רבותינו",
    "עופות טריים",
    "בשר בקר",
    "דגים",
    "הזמנת בשר",
    "עופות לשבת",
    "בשר כשר",
    "מכירת עופות",
  ],
  authors: [{ name: "צדקת רבותינו" }],
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: "website",
    locale: "he_IL",
    url: SITE_URL,
    siteName: "צדקת רבותינו",
    title: "צדקת רבותינו — עופות, בשר ודגים",
    description:
      "הזמנת עופות טריים, בשר בקר ודגים לכבוד שבת ויום טוב. מכירות תקופתיות עם חלוקה בנקודות איסוף.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  // ═══ §18 PWA ═══
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "צדקת רבותינו",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFE000",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* §62: באנר כניסה בשם משתמש - הרכיב הראשון בכוונה, נעול
            לראש המסך ולא ניתן לסגירה. מרונדר רק כשההתחזות פעילה. */}
        <ImpersonationBanner />
        {/* קישור דילוג לתוכן - נגישות: מאפשר למשתמשי מקלדת/קורא מסך לדלג לתוכן */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-[100] focus:bg-brand-rust focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:font-bold"
        >
          דלג לתוכן הראשי
        </a>
        <div id="main-content" className="min-h-screen flex flex-col">
          {children}
          <Footer />
        </div>
        <FloatingBackButton />
        <InstallPrompt />
        <AccessibilityWidget />
      </body>
    </html>
  );
}
