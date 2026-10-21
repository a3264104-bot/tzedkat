// ═══════════════════════════════════════════════════════════════
// Cloudflare Email Worker — קליטת מיילים ל-orders@tzidkat.com
// ═══════════════════════════════════════════════════════════════
// לא חלק מה-build של Vercel. הקוד הזה מודבק ב-Cloudflare:
//   Workers & Pages → Create → Worker (שם: tzidkat-inbound) → Edit code
//   Email → Email Routing → Routing rules: orders@tzidkat.com → Send to a Worker
//
// משתנים (Worker → Settings → Variables and Secrets):
//   INBOUND_URL     = https://tzidkat.com/api/inbound/email
//   INBOUND_SECRET  = אותו ערך כמו INBOUND_EMAIL_SECRET ב-Vercel (Secret)
//   FORWARD_TO      = מייל המנהל (חייב להיות מאומת ב-Email Routing → Destination addresses)
//
// מה הוא עושה עם כל מייל:
//   1. שולח את המייל המלא לאתר — שם, אם יש קובץ אקסל, נוצרת הזמנה ונשלחת תשובה.
//   2. מעביר עותק למנהל, כדי ששום מייל (שאלה, תלונה) לא ילך לאיבוד.

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();

    try {
      const res = await fetch(env.INBOUND_URL, {
        method: "POST",
        headers: {
          "content-type": "message/rfc822",
          "x-inbound-secret": env.INBOUND_SECRET,
          "x-envelope-from": message.from,
        },
        body: raw,
      });
      if (!res.ok) console.log("inbound failed", res.status, await res.text());
    } catch (e) {
      console.log("inbound error", String(e));
    }

    // ⚠️ תמיד מעבירים — גם אם האתר נכשל. המנהל רואה את המייל ויכול
    // להעלות את הקובץ ידנית במסך "הזמנה דרך אקסל".
    if (env.FORWARD_TO) {
      try {
        await message.forward(env.FORWARD_TO);
      } catch (e) {
        console.log("forward failed", String(e));
      }
    }
  },
};
