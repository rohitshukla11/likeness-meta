"use client";

/** The app header: home mark, destinations, and sign in / who you are. */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { pillClass } from "@/components/ds";
import { IconPerson } from "@/components/ds/icons";
import { useAuth } from "@/components/auth/AuthProvider";
import { reason, signIn, signOut } from "@/lib/client/firebase";

const NAV = [
  { href: "/creators", label: "Creators" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/verify", label: "Verify" },
];

export function AppHeader() {
  const path = usePathname();
  const router = useRouter();
  const { user, me, configured } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  return (
    <header className="on-dark border-b border-ink-line text-white">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-7 gap-y-3 px-4 py-[18px] sm:px-8">
        <Link href="/" aria-label="Likeness AI home" className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-raised text-white">
          <IconPerson size={20} />
        </Link>
        <nav aria-label="App" className="order-3 flex w-full flex-wrap gap-x-5 gap-y-1 text-[14px] font-medium sm:order-none sm:w-auto sm:flex-1 sm:gap-x-7 sm:text-[15px]">
          {NAV.map((n) => {
            const on = path === n.href || path.startsWith(`${n.href}/`);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`py-3 no-underline ${on ? "border-b-2 border-lime text-lime" : "text-white hover:text-lime"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {err && <span className="max-w-[260px] text-[13px] text-bad">{err}</span>}
          {!configured ? (
            <span className="text-[13px] text-grey-dark">Sign-in not configured</span>
          ) : user ? (
            <>
              <span className="hidden text-[14px] text-grey-dark sm:inline">
                {me?.user.role ? `${me.user.role === "creator" ? "Creator" : "Brand"} · ` : ""}
                {user.displayName ?? user.email}
              </span>
              <button type="button" onClick={() => signOut().then(() => router.push("/"))} className={pillClass("white", "min-h-10 px-4 text-[14px]")}>
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                signIn()
                  .then(() => router.push("/start"))
                  .catch((e) => setErr(reason(e)))
              }
              className={pillClass("lime", "min-h-10 px-5 text-[14px]")}
            >
              Sign in with Google
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
