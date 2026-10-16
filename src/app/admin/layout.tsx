import { Providers } from "@/components/Providers";
import { AdminShell } from "@/components/AdminShell";
import { auth } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // login page renders without the shell (it's still under /admin)
  return (
    <Providers>
      {session?.user ? (
        <AdminShell>{children}</AdminShell>
      ) : (
        children
      )}
    </Providers>
  );
}
