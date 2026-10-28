"use client";
import Link from "next/link";
import { AppPage, pillClass } from "@/components/ds";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandDashboard } from "@/components/dashboard/BrandDashboard";
import { CreatorDashboard } from "@/components/dashboard/CreatorDashboard";

export default function DashboardPage() {
  const { user, me, loading, refresh } = useAuth();
  if (loading) return <AppPage title="Dashboard">Loading…</AppPage>;
  if (!user || !me)
    return (
      <AppPage title="Dashboard" description="Sign in to see your licences.">
        <Link href="/start" className={pillClass("lime", "self-start")}>
          Get started
        </Link>
      </AppPage>
    );
  if (me.user.role === "creator" && me.creator?.status !== "live")
    return (
      <AppPage title="Dashboard" description="Finish setting up to go live.">
        <Link href="/creator/onboard" className={pillClass("lime", "self-start")}>
          Continue onboarding
        </Link>
      </AppPage>
    );
  if (!me.user.role)
    return (
      <AppPage title="Dashboard">
        <Link href="/start" className={pillClass("lime", "self-start")}>
          Choose creator or brand
        </Link>
      </AppPage>
    );
  return (
    <AppPage title={me.user.role === "creator" ? "Creator dashboard" : "Brand dashboard"} description={me.user.role === "creator" ? "Your licences, earnings and who opened your photos." : "Your licences, demo credits and ads."}>
      {me.user.role === "creator" ? <CreatorDashboard me={me} refresh={refresh} /> : <BrandDashboard me={me} refresh={refresh} />}
    </AppPage>
  );
}
