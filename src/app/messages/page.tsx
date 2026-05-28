import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import MessagesClient from "@/components/MessagesClient";
import { loadThreadList } from "@/lib/dm-page-data";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await requireUser();
  if (user.role === "MANUFACTURER") {
    redirect("/oem");
  }
  const threads = await loadThreadList(user.id);
  const viewerRole =
    user.role === "ADMIN"
      ? "admin"
      : user.role === "SUPPLIER"
        ? "supplier"
        : user.role === "BUYER"
          ? "buyer"
          : "none";
  return (
    <>
      <SiteHeader />
      <main className="container" style={{ padding: "24px 0 48px" }}>
        <MessagesClient
          currentUser={{ id: user.id, name: user.name, role: user.role }}
          viewerRole={viewerRole}
          threads={threads}
          selectedThread={null}
          selectedMessages={[]}
        />
      </main>
      <SiteFooter />
    </>
  );
}
