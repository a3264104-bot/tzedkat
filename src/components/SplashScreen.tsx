"use client";

import { useEffect, useState } from "react";

// כמה זמן להציג את מסך הפתיחה (במילישניות) לפני שהוא נעלם
const SPLASH_DURATION = 1800;
// כמה זמן לוקח לו להיעלם בהדרגה (fade out)
const FADE_DURATION = 400;

export default function SplashScreen() {
  const [visible, setVisible] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    // מציגים רק כשהאתר נפתח כאפליקציה מותקנת (מסך הבית), לא בגלישה רגילה בדפדפן
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (!isStandalone) return;

    // מציגים פעם אחת לכל פתיחה של האפליקציה (session), לא בכל ניווט בין דפים
    const alreadyShown = sessionStorage.getItem("splashShown");
    if (alreadyShown) return;

    setVisible(true);
    sessionStorage.setItem("splashShown", "1");

    const fadeTimer = setTimeout(() => setFadingOut(true), SPLASH_DURATION);
    const hideTimer = setTimeout(
      () => setVisible(false),
      SPLASH_DURATION + FADE_DURATION
    );

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "#FFE000",
        opacity: fadingOut ? 0 : 1,
        transition: `opacity ${FADE_DURATION}ms ease-out`,
        pointerEvents: fadingOut ? "none" : "auto",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/splash-full.png"
        alt=""
        style={{
          width: "100vw",
          height: "100vh",
          objectFit: "cover",
          display: "block",
        }}
      />
    </div>
  );
}
