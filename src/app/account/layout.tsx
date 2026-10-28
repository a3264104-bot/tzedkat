import { auth } from "@/lib/auth";
import { AdminFloatingMenu } from "@/components/AdminFloatingMenu";

// המנהל עובד גם במסכים האלה (בשם לקוח / נציג). כאן אין AdminShell,
// ולכן מוסיפים כפתור תפריט ניהול צף — רק למנהל.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  return (
    <>
      {children}
      {isAdmin && <AdminFloatingMenu />}
    </>
  );
}
