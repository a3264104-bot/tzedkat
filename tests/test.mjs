import { createDb } from "./db.mjs";
import * as XLSX from "xlsx";

// ---- test framework (tiny) ----
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? "  → " + extra : ""}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

// ---- seed helper: build a fresh DB with a configurable active pricelist ----
function seed(opts = {}) {
  const { prisma, T } = createDb();

  // categories
  const cats = {
    poultry: { id: "cat_poultry", name: "עופות טריים", sortOrder: 1 },
    meat: { id: "cat_meat", name: "בשר", sortOrder: 2 },
    fish: { id: "cat_fish", name: "דגים", sortOrder: 3 },
    frozen: { id: "cat_frozen", name: "מוצרים קפואים / מארזים", sortOrder: 4 },
  };
  Object.values(cats).forEach((c) => T.category.push(c));

  // products — one of each type
  const P = {
    // regular per-unit poultry (WEIGHT/ק"ג in real data, treated as regular)
    chicken: mkProd("p_chicken", "עוף שלם", cats.poultry.id, 28.9, { unit: 'ק"ג', saleType: "WEIGHT" }),
    // per-kg meat with singles
    entrecote: mkProd("p_entre", "עין אנטריקוט", cats.meat.id, 123.9, { allowSingles: true, unit: 'ק"ג', saleType: "WEIGHT" }),
    // fish with singles
    salmon: mkProd("p_salmon", "סלומון - נורבגי", cats.fish.id, 59.9, { allowSingles: true, unit: 'ק"ג', saleType: "WEIGHT" }),
    // package / מארז frozen
    pkg: mkProd("p_pkg", "בקר טחון – 500ג' - קפוא", cats.frozen.id, 37.5, { saleType: "PACKAGE", unit: "מארז", packageWeight: "500 גרם", isFrozen: true }),
    // limited-qty package
    liver: mkProd("p_liver", "כבד צלוי - טרי 200 גרם", cats.poultry.id, 32.5, { saleType: "PACKAGE", unit: "מארז", packageWeight: "200 גרם", limitedQty: true, limitedQtyAmount: 10 }),
    // an INACTIVE product (should be unorderable)
    inactive: mkProd("p_off", "מוצר כבוי", cats.poultry.id, 10, { isActive: false }),
  };
  function mkProd(id, name, categoryId, price, extra = {}) {
    return {
      id, name, categoryId, cartonPrice: price,
      allowSingles: extra.allowSingles ?? false,
      singleSurcharge: extra.singleSurcharge ?? null,
      unit: extra.unit ?? 'ק"ג',
      saleType: extra.saleType ?? "WEIGHT",
      packageWeight: extra.packageWeight ?? null,
      isFrozen: extra.isFrozen ?? false,
      limitedQty: extra.limitedQty ?? false,
      limitedQtyAmount: extra.limitedQtyAmount ?? null,
      isActive: extra.isActive ?? true,
      sortOrder: 0,
    };
  }
  Object.values(P).forEach((p) => T.product.push(p));

  // delivery points
  const pts = {
    modiin: { id: "pt_modiin", name: "מודיעין", city: "מודיעין", address: "רחוב הדקל 1", contactName: "ישראל", phone: "050-1111111", email: "a@x.com", deliveryHours: "18:00-20:00", notes: null, isActive: true, sortOrder: 1 },
    bnei: { id: "pt_bnei", name: "בני ברק", city: "בני ברק", address: "רחוב רבי עקיבא 5", contactName: "משה", phone: "050-2222222", email: "b@x.com", deliveryHours: "17:00-19:00", notes: null, isActive: true, sortOrder: 2 },
    // a point that is NOT part of the active sale
    outsider: { id: "pt_out", name: "טבריה", city: "טבריה", address: "רחוב הגליל 3", contactName: "דוד", phone: "050-3333333", email: "c@x.com", deliveryHours: null, notes: null, isActive: true, sortOrder: 3 },
  };
  Object.values(pts).forEach((d) => T.deliveryPoint.push(d));

  // active pricelist
  const now = Date.now();
  const pl = {
    id: "pl_active",
    name: "מחירון תמוז תשפ\"ו",
    openDate: opts.openDate ?? null,
    closeDate: opts.closeDate ?? null,
    deliveryDate: null,
    deliveryDateText: "יום חמישי כ\"ה תמוז, 17:00-20:00",
    notes: "מחירון לדוגמה",
    status: opts.status ?? "ACTIVE",
    singleSurcharge: opts.singleSurcharge ?? 3,
    createdAt: new Date(),
  };
  T.pricelist.push(pl);

  // members: include all products EXCEPT we still register inactive (to prove isActive gate, not membership)
  const memberProducts = opts.memberProducts ?? [P.chicken, P.entrecote, P.salmon, P.pkg, P.liver, P.inactive];
  memberProducts.forEach((p) =>
    T.pricelistProduct.push({ id: "plp_" + p.id, pricelistId: pl.id, productId: p.id, price: null })
  );
  // points in the sale: modiin + bnei (NOT outsider)
  const memberPoints = opts.memberPoints ?? [pts.modiin, pts.bnei];
  memberPoints.forEach((d) =>
    T.pricelistPoint.push({ id: "plpt_" + d.id, pricelistId: pl.id, pointId: d.id })
  );

  return { prisma, T, P, pts, pl, cats };
}

// ---- load the REAL compiled route ----
async function loadRoute(prisma, session = null) {
  global.__PRISMA__ = prisma;
  global.__SESSION__ = session;
  // bust module cache so each test gets fresh globals binding (module reads globals at call time anyway)
  const mod = await import("./build/orders_route.mjs");
  return mod;
}

function makeReq(body) {
  return { json: async () => body };
}

async function run() {
  // =========================================================
  section("1. נקודת חלוקה פעילה + 2. רואה תאריך/שעה + 3. אישור תאריך");
  {
    const { prisma, P, pts, pl } = seed();
    // The customer-facing data comes from order/page.tsx loader; here we assert the data layer
    // exposes active points & delivery text. (Server gate is tested via POST below.)
    const loaded = await prisma.pricelist.findFirst({
      where: { status: "ACTIVE" },
      include: { points: { include: { point: true } }, products: { include: { product: true } } },
    });
    ok("מכירה פעילה נטענת", loaded && loaded.status === "ACTIVE");
    const activePoints = loaded.points.map((pp) => pp.point).filter((p) => p.isActive);
    ok("נקודות חלוקה פעילות מוצגות", activePoints.length === 2 && activePoints.some((p) => p.name === "מודיעין"));
    ok("תאריך/שעת חלוקה זמין להצגה", typeof loaded.deliveryDateText === "string" && loaded.deliveryDateText.includes("17:00"));
    // rule #3 (date-confirm checkbox) is enforced in OrderFlow UI: button disabled={!dateConfirmed}
    ok("אישור-תאריך נאכף ב-UI (disabled={!dateConfirmed})", routeUiGate("dateConfirmed"));
  }

  // =========================================================
  section("4. בחירת כל סוגי המוצרים + 5. חישוב סכום נכון בשרת");
  {
    const { prisma, P, pts } = seed();
    const { POST } = await loadRoute(prisma);
    const res = await POST(makeReq({
      pricelistId: "pl_active",
      pointId: pts.modiin.id,
      customerName: "אברהם כהן",
      phone: "050-0000000",
      items: [
        { productId: P.chicken.id, isSingle: false, quantity: 2 },   // regular: 28.9 * 2 = 57.8
        { productId: P.entrecote.id, isSingle: false, quantity: 1.5 },// per-kg carton: 123.9 * 1.5 = 185.85
        { productId: P.salmon.id, isSingle: true, quantity: 2 },      // singles: (59.9+3)*2 = 125.8
        { productId: P.pkg.id, isSingle: false, quantity: 3 },        // package: 37.5 * 3 = 112.5
      ],
    }));
    const body = res._body;
    ok("הזמנה עם 4 סוגי מוצרים התקבלה (200)", res.status === 200, JSON.stringify(body));
    // recompute expected on server side
    const expected = round2(28.9 * 2 + 123.9 * 1.5 + (59.9 + 3) * 2 + 37.5 * 3);
    const order = prisma._T.order.find((o) => o.id === body.id);
    ok("סכום משוער מחושב נכון בשרת", Number(order.estimatedTotal) === expected, `got ${order?.estimatedTotal} want ${expected}`);
    const salmonItem = prisma._T.orderItem.find((i) => i.orderId === body.id && i.productId === P.salmon.id);
    ok("בודדים מוסיפים תוספת לק\"ג (62.9)", Number(salmonItem.unitPrice) === 62.9, `got ${salmonItem?.unitPrice}`);
    const chickenItem = prisma._T.orderItem.find((i) => i.orderId === body.id && i.productId === P.chicken.id);
    ok("מוצר רגיל ללא תוספת", Number(chickenItem.unitPrice) === 28.9);
    const pkgItem = prisma._T.orderItem.find((i) => i.orderId === body.id && i.productId === P.pkg.id);
    ok("מארז מתומחר לפי יחידת מארז", Number(pkgItem.unitPrice) === 37.5 && pkgItem.unit === "מארז");
  }

  // =========================================================
  section("מניעת זיוף מחיר: מחיר נשלח מהלקוח מתעלמים ממנו");
  {
    const { prisma, P, pts } = seed();
    const { POST } = await loadRoute(prisma);
    const res = await POST(makeReq({
      pricelistId: "pl_active", pointId: pts.modiin.id, customerName: "ניסיון זיוף", phone: "1",
      items: [{ productId: P.chicken.id, isSingle: false, quantity: 1, unitPrice: 0.01, estimatedPrice: 0.01 }],
    }));
    const order = prisma._T.order.find((o) => o.id === res._body.id);
    ok("מחיר מהלקוח לא משפיע — השרת קובע 28.9", Number(order.estimatedTotal) === 28.9, `got ${order?.estimatedTotal}`);
  }

  // =========================================================
  section("6. לא ניתן להזמין לפני פתיחה / אחרי סגירה");
  {
    // closed (closeDate in the past)
    const past = new Date(Date.now() - 3600_000);
    const dbClosed = seed({ closeDate: past });
    const { POST: postClosed } = await loadRoute(dbClosed.prisma);
    const r1 = await postClosed(makeReq({
      pricelistId: "pl_active", pointId: dbClosed.pts.modiin.id, customerName: "x", phone: "1",
      items: [{ productId: dbClosed.P.chicken.id, isSingle: false, quantity: 1 }],
    }));
    ok("אחרי סגירה — נדחה (400)", r1.status === 400 && /הסתיים/.test(r1._body.error), JSON.stringify(r1._body));

    // not yet open (openDate in the future)
    const future = new Date(Date.now() + 3600_000);
    const dbFuture = seed({ openDate: future });
    const { POST: postFuture } = await loadRoute(dbFuture.prisma);
    const r2 = await postFuture(makeReq({
      pricelistId: "pl_active", pointId: dbFuture.pts.modiin.id, customerName: "x", phone: "1",
      items: [{ productId: dbFuture.P.chicken.id, isSingle: false, quantity: 1 }],
    }));
    ok("לפני פתיחה — נדחה (400)", r2.status === 400 && /טרם נפתחה/.test(r2._body.error), JSON.stringify(r2._body));

    // not ACTIVE status (DRAFT)
    const dbDraft = seed({ status: "DRAFT" });
    const { POST: postDraft } = await loadRoute(dbDraft.prisma);
    const r3 = await postDraft(makeReq({
      pricelistId: "pl_active", pointId: dbDraft.pts.modiin.id, customerName: "x", phone: "1",
      items: [{ productId: dbDraft.P.chicken.id, isSingle: false, quantity: 1 }],
    }));
    ok("מכירה לא פעילה (DRAFT) — נדחה (400)", r3.status === 400 && /אינה פעילה/.test(r3._body.error));

    // within window — allowed
    const dbOpen = seed({ openDate: new Date(Date.now() - 3600_000), closeDate: new Date(Date.now() + 3600_000) });
    const { POST: postOpen } = await loadRoute(dbOpen.prisma);
    const r4 = await postOpen(makeReq({
      pricelistId: "pl_active", pointId: dbOpen.pts.modiin.id, customerName: "x", phone: "1",
      items: [{ productId: dbOpen.P.chicken.id, isSingle: false, quantity: 1 }],
    }));
    ok("בתוך חלון הזמן — מתקבל (200)", r4.status === 200);
  }

  // =========================================================
  section("7. לא ניתן להזמין מוצר לא פעיל");
  {
    const { prisma, P, pts } = seed();
    const { POST } = await loadRoute(prisma);
    const res = await POST(makeReq({
      pricelistId: "pl_active", pointId: pts.modiin.id, customerName: "x", phone: "1",
      items: [{ productId: P.inactive.id, isSingle: false, quantity: 1 }],
    }));
    ok("מוצר לא פעיל — נדחה (400)", res.status === 400 && /אינו זמין/.test(res._body.error), JSON.stringify(res._body));
  }

  // =========================================================
  section("8. לא ניתן להזמין לנקודה שלא שייכת למכירה");
  {
    const { prisma, P, pts } = seed();
    const { POST } = await loadRoute(prisma);
    const res = await POST(makeReq({
      pricelistId: "pl_active", pointId: pts.outsider.id, customerName: "x", phone: "1",
      items: [{ productId: P.chicken.id, isSingle: false, quantity: 1 }],
    }));
    ok("נקודה לא משתתפת — נדחה (400)", res.status === 400 && /אינה משתתפת/.test(res._body.error), JSON.stringify(res._body));
  }

  // =========================================================
  section("9. orderNumber ייחודי + snapshot מלא");
  {
    const { prisma, P, pts } = seed();
    const { POST } = await loadRoute(prisma);
    const r1 = await POST(makeReq({ pricelistId: "pl_active", pointId: pts.modiin.id, customerName: "לקוח 1", phone: "1", items: [{ productId: P.chicken.id, isSingle: false, quantity: 1 }] }));
    const r2 = await POST(makeReq({ pricelistId: "pl_active", pointId: pts.bnei.id, customerName: "לקוח 2", phone: "2", items: [{ productId: P.salmon.id, isSingle: true, quantity: 1 }] }));
    ok("שתי הזמנות קיבלו orderNumber", r1._body.orderNumber && r2._body.orderNumber);
    ok("orderNumber ייחודי ועולה", r2._body.orderNumber === r1._body.orderNumber + 1, `${r1._body.orderNumber} vs ${r2._body.orderNumber}`);
    const o1 = prisma._T.order.find((o) => o.id === r1._body.id);
    ok("snapshot: שם נקודה", o1.pointNameSnapshot === "מודיעין");
    ok("snapshot: תאריך חלוקה", typeof o1.deliveryDateSnapshot === "string" && o1.deliveryDateSnapshot.includes("17:00"));
    ok("snapshot: שם מכירה", o1.pricelistNameSnapshot && o1.pricelistNameSnapshot.includes("תמוז"));
    const it1 = prisma._T.orderItem.find((i) => i.orderId === o1.id);
    ok("snapshot פריט: שם מוצר + מחיר נשמרים", it1.productName === "עוף שלם" && Number(it1.unitPrice) === 28.9 && it1.unit === 'ק"ג');
  }

  // =========================================================
  section("מחיר היסטורי לא משתנה כששינו מחיר במחירון");
  {
    const { prisma, P, pts } = seed();
    const { POST } = await loadRoute(prisma);
    const r = await POST(makeReq({ pricelistId: "pl_active", pointId: pts.modiin.id, customerName: "x", phone: "1", items: [{ productId: P.chicken.id, isSingle: false, quantity: 1 }] }));
    const itBefore = Number(prisma._T.orderItem.find((i) => i.orderId === r._body.id).unitPrice);
    // simulate admin changing catalog price afterwards
    prisma._T.product.find((p) => p.id === P.chicken.id).cartonPrice = 99.9;
    const itAfter = Number(prisma._T.orderItem.find((i) => i.orderId === r._body.id).unitPrice);
    ok("שינוי מחיר עתידי לא נוגע בהזמנה קיימת", itBefore === 28.9 && itAfter === 28.9, `before ${itBefore} after ${itAfter}`);
  }

  // =========================================================
  section("10. ההזמנה מופיעה במנהל (GET) ובדוחות");
  {
    const { prisma, P, pts } = seed();
    const { POST, GET } = await loadRoute(prisma, { user: { email: "admin@x" } });
    await POST(makeReq({ pricelistId: "pl_active", pointId: pts.modiin.id, customerName: "דנה", phone: "5", items: [{ productId: P.chicken.id, isSingle: false, quantity: 2 }] }));
    // admin list (real GET handler, with session)
    const listRes = await GET({ url: "http://x/api/orders" });
    const list = listRes._body;
    ok("GET מנהל מחזיר את ההזמנה", Array.isArray(list) && list.length === 1 && list[0].customerName === "דנה");
    // GET without session -> 401
    const noAuth = await loadRoute(prisma, null);
    const unauth = await noAuth.GET({ url: "http://x/api/orders" });
    ok("GET ללא הרשאה — 401", unauth.status === 401);
    // reports aggregation (run real reports logic)
    const rep = await reportsLogic(prisma);
    ok("דוח: סופר הזמנה אחת", rep.totalOrders === 1);
    ok("דוח: סיכום מוצרים כולל 'עוף שלם' x2", rep.products.find((p) => p.name === "עוף שלם")?.qty === 2);
    ok("דוח: סיכום לפי נקודה — מודיעין", rep.byPoint.find((b) => b.name === "מודיעין")?.orders === 1);
  }

  // =========================================================
  section("11. כמות מוגבלת — אזהרה בדוחות מעל 80%");
  {
    const { prisma, P, pts } = seed(); // liver limitedQtyAmount=10
    const { POST } = await loadRoute(prisma);
    // order 9 of the limited liver (90% -> 'near')
    await POST(makeReq({ pricelistId: "pl_active", pointId: pts.modiin.id, customerName: "a", phone: "1", items: [{ productId: P.liver.id, isSingle: false, quantity: 9 }] }));
    let rep = await reportsLogic(prisma);
    const w = rep.limitedWarnings.find((x) => x.name.includes("כבד"));
    ok("90% — מופיעה אזהרת 'מתקרב' (near)", w && w.level === "near", JSON.stringify(rep.limitedWarnings));
    ok("אזהרה מציגה הוזמן/מגבלה", w && w.ordered === 9 && w.limit === 10);
    // push over 100%
    await POST(makeReq({ pricelistId: "pl_active", pointId: pts.bnei.id, customerName: "b", phone: "2", items: [{ productId: P.liver.id, isSingle: false, quantity: 5 }] }));
    rep = await reportsLogic(prisma);
    const w2 = rep.limitedWarnings.find((x) => x.name.includes("כבד"));
    ok("140% — אזהרת חריגה (over)", w2 && w2.level === "over" && w2.ordered === 14);
    // under 80% should NOT warn
    const db2 = seed();
    const { POST: P2 } = await loadRoute(db2.prisma);
    await P2(makeReq({ pricelistId: "pl_active", pointId: db2.pts.modiin.id, customerName: "c", phone: "3", items: [{ productId: db2.P.liver.id, isSingle: false, quantity: 5 }] }));
    const rep2 = await reportsLogic(db2.prisma);
    ok("50% — אין אזהרה", !rep2.limitedWarnings.find((x) => x.name.includes("כבד")));
  }

  // =========================================================
  section("12. ייצוא אקסל — עברית + RTL תקין");
  {
    const { prisma, P, pts } = seed();
    const { POST } = await loadRoute(prisma);
    await POST(makeReq({ pricelistId: "pl_active", pointId: pts.modiin.id, customerName: "שרה לוי", phone: "050-9", notes: "ללא בצל", items: [{ productId: P.entrecote.id, isSingle: true, quantity: 2 }] }));
    const buf = await exportOrdersXlsx(prisma);
    ok("נוצר קובץ xlsx (buffer לא ריק)", Buffer.isBuffer(buf) && buf.length > 0);
    // re-read it back
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    ok("שם גיליון בעברית", wb.SheetNames[0] === "הזמנות", wb.SheetNames[0]);
    ok("כותרות בעברית", Object.keys(rows[0]).includes("שם לקוח") && Object.keys(rows[0]).includes("נקודת חלוקה"));
    ok("ערכים בעברית נשמרו", rows[0]["שם לקוח"] === "שרה לוי" && rows[0]["נקודת חלוקה"] === "מודיעין");
    ok("סטטוס מתורגם לעברית", rows[0]["סטטוס"] === "חדשה");
    // RTL: workbook-level view rightToLeft (the only form xlsx 0.18 actually writes)
    const wbViewRTL = !!(wb.Workbook && wb.Workbook.Views && wb.Workbook.Views[0] && wb.Workbook.Views[0].RTL);
    const xmlHasRTL = /rightToLeft/.test(buf.toString("latin1"));
    ok("חוברת מוגדרת RTL (rightToLeft נכתב לקובץ)", wbViewRTL || xmlHasRTL, `wbView=${wbViewRTL} xml=${xmlHasRTL}`);
  }

  // ---- summary ----
  console.log(`\n${"=".repeat(40)}`);
  console.log(`סה"כ: ${pass} עברו, ${fail} נכשלו`);
  if (fail) { console.log("נכשלו:"); fails.forEach((f) => console.log("  - " + f)); process.exit(1); }
  else console.log("✅ כל הבדיקות עברו");
}

// helper: assert UI gate exists in OrderFlow source
function routeUiGate(varName) {
  const src = readFileSyncSafe("/home/claude/tzedkat/src/app/order/OrderFlow.tsx");
  return src.includes(`disabled={!${varName}`);
}
import { readFileSync as _rfs } from "fs";
function readFileSyncSafe(p) { try { return _rfs(p, "utf8"); } catch { return ""; } }

function round2(n) { return Math.round(n * 100) / 100; }

// run the REAL reports route handler
async function reportsLogic(prisma) {
  global.__PRISMA__ = prisma;
  global.__SESSION__ = { user: { email: "admin@x" } };
  const mod = await import("./build/reports_route.mjs");
  const res = await mod.GET({ url: "http://x/api/admin/reports" });
  return res._body;
}

// run the REAL export route handler ('orders' type), return the xlsx buffer
async function exportOrdersXlsx(prisma) {
  global.__PRISMA__ = prisma;
  global.__SESSION__ = { user: { email: "admin@x" } };
  const mod = await import("./build/export_route.mjs");
  const res = await mod.GET({ url: "http://x/api/admin/export?type=orders" });
  return Buffer.isBuffer(res._raw) ? res._raw : Buffer.from(res._raw);
}

run().catch((e) => { console.error(e); process.exit(1); });
