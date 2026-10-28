"use client";
import Link from "next/link";
import { AppPage, Card, EmptyState } from "@/components/ds";
import { useApi } from "@/components/dashboard/shared";
import { credits, subscriberLabel, useLabel, type Terms } from "@/lib/model";

type C = { uid: string; displayName: string; demo: boolean; channel: { title: string; subscriberCount: number | null } | null; terms: Terms | null; photo: string | null };

export default function CreatorsPage() {
  const { data, error } = useApi<{ creators: C[] }>("/api/creators");
  return (
    <AppPage title="Creators" description="Verified creators who license their likeness. Each one approves every licence.">
      {error && <p className="m-0 text-bad">{error}</p>}
      {data && data.creators.length === 0 && <EmptyState title="No creators listed yet">Creators appear here once they connect YouTube and go live.</EmptyState>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.creators.map((c) => (
          <Link key={c.uid} href={`/creators/${c.uid}`} className="no-underline">
            <Card>
              {c.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.photo} alt={`${c.displayName}'s public photo`} className="aspect-square w-full rounded-[14px] object-cover" />
              )}
              <span className="text-[17px] font-bold">{c.displayName}</span>
              <span className="text-[14px] text-grey">
                {c.demo ? "Synthetic demo creator" : `YouTube · ${subscriberLabel(c.channel?.subscriberCount ?? null)}`}
              </span>
              {c.terms && (
                <span className="text-[14px]">
                  {credits(c.terms.pricePerImage)} per image · {credits(c.terms.pricePerVideo)} per video · {c.terms.uses.map(useLabel).join(", ")}
                </span>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </AppPage>
  );
}
