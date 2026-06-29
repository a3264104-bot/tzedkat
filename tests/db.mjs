// A faithful, in-memory Prisma-shaped data layer for the models the routes use.
// Implements exactly the query shapes called by the real route handlers:
//   pricelist.findUnique/findFirst({where, include:{products:{include:{product}}, points:{include:{point}}}})
//   product.findMany({where:{limitedQty, limitedQtyAmount:{not:null}}, select})
//   order.findMany({where, include:{point, items}, orderBy})
//   order.create({data:{... items:{create:[...]}}})
// Decimals are represented as JS numbers but wrapped so Number()/toString behave like Prisma.Decimal.

let _id = 0;
const cuid = (p) => `${p}_${(++_id).toString().padStart(4, "0")}`;

// Prisma.Decimal-ish: Number(x) works, and it's truthy/serializable.
class Dec {
  constructor(v) { this._v = v == null ? null : Number(v); }
  valueOf() { return this._v; }
  toString() { return this._v == null ? "null" : String(this._v); }
  toJSON() { return this._v; }
}
const D = (v) => (v == null ? null : new Dec(v));

export function createDb() {
  const T = {
    admin: [],
    category: [],
    product: [],
    deliveryPoint: [],
    pricelist: [],
    pricelistPoint: [],
    pricelistProduct: [],
    order: [],
    orderItem: [],
  };

  let orderSeq = 1000;

  function matchWhere(row, where) {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      const v = row[k];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Dec)) {
        if ("not" in cond) {
          if (cond.not === null) { if (v === null || v === undefined) return false; }
          else if (v === cond.not) return false;
        }
        if ("in" in cond && !cond.in.includes(v)) return false;
      } else {
        if (v !== cond) return false;
      }
    }
    return true;
  }

  function hydratePricelist(pl, include) {
    const out = { ...pl, singleSurcharge: D(pl.singleSurcharge) };
    if (include?.products) {
      out.products = T.pricelistProduct
        .filter((pp) => pp.pricelistId === pl.id)
        .map((pp) => {
          const o = { ...pp, price: D(pp.price) };
          if (include.products.include?.product) {
            o.product = hydrateProduct(T.product.find((p) => p.id === pp.productId));
          }
          return o;
        });
    }
    if (include?.points) {
      out.points = T.pricelistPoint
        .filter((pp) => pp.pricelistId === pl.id)
        .map((pp) => {
          const o = { ...pp };
          if (include.points.include?.point) {
            o.point = { ...T.deliveryPoint.find((d) => d.id === pp.pointId) };
          }
          return o;
        });
    }
    return out;
  }

  function hydrateProduct(p) {
    if (!p) return p;
    return { ...p, cartonPrice: D(p.cartonPrice), singleSurcharge: D(p.singleSurcharge) };
  }

  function hydrateOrder(o, include) {
    const out = { ...o, estimatedTotal: D(o.estimatedTotal), finalTotal: D(o.finalTotal) };
    if (include?.point) out.point = { ...T.deliveryPoint.find((d) => d.id === o.pointId) };
    if (include?.items) {
      out.items = T.orderItem
        .filter((it) => it.orderId === o.id)
        .map((it) => ({
          ...it,
          quantity: D(it.quantity),
          unitPrice: D(it.unitPrice),
          estimatedPrice: D(it.estimatedPrice),
          finalWeight: D(it.finalWeight),
          finalPrice: D(it.finalPrice),
        }));
    }
    return out;
  }

  const prisma = {
    pricelist: {
      async findUnique({ where, include }) {
        const pl = T.pricelist.find((x) => x.id === where.id);
        return pl ? hydratePricelist(pl, include) : null;
      },
      async findFirst({ where, include }) {
        const pl = T.pricelist.find((x) => matchWhere(x, where));
        return pl ? hydratePricelist(pl, include) : null;
      },
    },
    product: {
      async findMany({ where, select }) {
        let rows = T.product.filter((p) => matchWhere(p, where));
        if (select) {
          rows = rows.map((p) => {
            const o = {};
            for (const k of Object.keys(select)) o[k] = p[k];
            return o;
          });
        } else {
          rows = rows.map(hydrateProduct);
        }
        return rows;
      },
    },
    order: {
      async findMany({ where, include, orderBy }) {
        let rows = T.order.filter((o) => matchWhere(o, where));
        return rows.map((o) => hydrateOrder(o, include));
      },
      async create({ data }) {
        const id = cuid("order");
        const o = {
          id,
          orderNumber: ++orderSeq,
          pricelistId: data.pricelistId ?? null,
          pointId: data.pointId,
          pointNameSnapshot: data.pointNameSnapshot ?? null,
          deliveryDateSnapshot: data.deliveryDateSnapshot ?? null,
          pricelistNameSnapshot: data.pricelistNameSnapshot ?? null,
          customerName: data.customerName,
          phone: data.phone,
          phone2: data.phone2 ?? null,
          notes: data.notes ?? null,
          internalNotes: null,
          status: data.status ?? "NEW",
          estimatedTotal: data.estimatedTotal,
          finalTotal: data.finalTotal ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        T.order.push(o);
        if (data.items?.create) {
          for (const it of data.items.create) {
            T.orderItem.push({
              id: cuid("item"),
              orderId: id,
              productId: it.productId,
              productName: it.productName,
              unit: it.unit,
              isSingle: it.isSingle ?? false,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              estimatedPrice: it.estimatedPrice,
              finalWeight: it.finalWeight ?? null,
              finalPrice: it.finalPrice ?? null,
            });
          }
        }
        return hydrateOrder(o, {});
      },
    },
    // raw table access for the harness to seed
    _T: T,
    _seedOrderNumber: (n) => { orderSeq = n; },
  };

  return { prisma, T };
}
