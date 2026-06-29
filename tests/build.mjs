import { build } from "esbuild";
import { readFileSync, writeFileSync } from "fs";

// Plugin to rewrite the route's bare imports to our shims/real-pricing.
const rewrite = {
  name: "rewrite",
  setup(b) {
    b.onResolve({ filter: /^next\/server$/ }, () => ({ path: new URL("./shim-next.mjs", import.meta.url).pathname }));
    b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: new URL("./inject-prisma.mjs", import.meta.url).pathname }));
    b.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: new URL("./inject-auth.mjs", import.meta.url).pathname }));
    b.onResolve({ filter: /^@\/lib\/pricing$/ }, () => ({ path: new URL("./_pricing_src.ts", import.meta.url).pathname }));
    b.onResolve({ filter: /^@\/lib\/guard$/ }, () => ({ path: new URL("./inject-guard.mjs", import.meta.url).pathname }));
  },
};

async function go() {
  for (const [src, out] of [
    ["./_orders_route_src.ts", "./build/orders_route.mjs"],
    ["./_export_route_src.ts", "./build/export_route.mjs"],
    ["./_reports_route_src.ts", "./build/reports_route.mjs"],
  ]) {
    await build({
      entryPoints: [src],
      outfile: out,
      bundle: true,
      format: "esm",
      platform: "node",
      plugins: [rewrite],
      external: ["zod", "xlsx"],
      logLevel: "warning",
    });
  }
  console.log("built");
}
go();
