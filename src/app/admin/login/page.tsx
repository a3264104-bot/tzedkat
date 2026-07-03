import { redirect } from "next/navigation";

// מסך ההתחברות אוחד ל-/login. עמוד זה נשאר רק כדי להפנות משם למי שמגיע לכתובת הישנה.
export default function AdminLoginRedirect() {
  redirect("/login");
}
