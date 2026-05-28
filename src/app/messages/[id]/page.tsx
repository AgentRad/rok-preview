import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import MessagesClient from "@/components/MessagesClient";
import { loadThreadList, loadThreadDetail } from "@/lib/dm-page-data";

export const dynamic = "force-dynamic";

export default async function MessagesThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.role === "MANUFACTURER") {
    redirect("/oem");
  }
  const { id } = await params;
  const [threads, detail] = await Promise.all([
    loadThreadList(user.id),
    loadThreadDetail(user.id, user.role, id),
  ]);
  if (!detail) notFound();
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
          selectedThread={detail.thread}
          selectedMessages={detail.messages}
        />
      </main>
      <SiteFooter />
    </>
  );
}
