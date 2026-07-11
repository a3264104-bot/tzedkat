import Image from "next/image";

// רכיב הלוגו של האתר. API זהה לגרסה הקודמת ({size}) כדי לא לשבור עמודים
// אחרים שמשתמשים בו. הגיע כתמונה במקום SVG כדי לתמוך בלוגו הרשמי המצולם.
export function Logo({ size = 170 }: { size?: number }) {
  return (
    <Image
      src="/logo.png"
      alt="צדקת רבותינו — עופות, בשר ודגים"
      width={size}
      height={size}
      priority
      className="rounded-2xl shadow-md"
    />
  );
}
