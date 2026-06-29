// Mutable prisma injection point. The harness sets global.__PRISMA__ before importing the route.
export const prisma = new Proxy({}, {
  get(_t, model) {
    return new Proxy({}, {
      get(_t2, method) {
        return (...args) => global.__PRISMA__[model][method](...args);
      },
    });
  },
});
