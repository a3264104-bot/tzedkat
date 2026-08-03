import type { Metadata, Viewport } from "next";
import InstallPrompt from "@/components/InstallPrompt";
import SplashScreen from "@/components/SplashScreen";
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

// מסכי פתיחה (splash screens) ל-iOS — תמונה מלאה לפי גודל מסך כל מכשיר
const appleSplashScreens = [
  { size: "1290x2796", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" }, // iPhone 15/14 Pro Max, 15 Plus
  { size: "1179x2556", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" }, // iPhone 15/14 Pro, 15
  { size: "1170x2532", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" }, // iPhone 12/13/14, 13 mini
  { size: "1284x2778", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" }, // iPhone 12/13 Pro Max, 14 Plus
  { size: "1125x2436", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" }, // iPhone X/XS/11 Pro
  { size: "1242x2688", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" }, // iPhone XS Max/11 Pro Max
  { size: "828x1792",  media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" }, // iPhone XR/11
  { size: "750x1334",  media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" }, // iPhone 6/7/8/SE2/SE3
  { size: "640x1136",  media: "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)" }, // iPhone 5/SE1
];

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
        {appleSplashScreens.map(({ size, media }) => (
          <link
            key={size}
            rel="apple-touch-startup-image"
            media={media}
            href={`/splash/apple-splash-${size}.png`}
          />
        ))}
      </head>
      <body>
        <SplashScreen />
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}
