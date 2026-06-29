import { Providers } from "@/components/Providers";
import { AdminNav } from "@/components/AdminNav";
import { auth } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // login page renders without the shell (it's still under /admin)
  return (
    <Providers>
      {session?.user ? (
        <div className="md:flex bg-[#faf6ec] min-h-screen">
          <AdminNav />
          <main className="flex-1 min-w-0 p-4 md:p-6">{children}</main>
        </div>
      ) : (
        children
      )}
    </Providers>
  );
}
