import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  // אימות Google Search Console - יש להחליף את הקוד בקוד האמיתי מ-Search Console
  // ניתן לקבל אותו ב-https://search.google.com/search-console תחת "HTML tag"
  verification: {
    google: "REPLACE_WITH_GOOGLE_VERIFICATION_CODE",
  },
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFE000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
      <body>{children}</body>
    </html>
  );
}
