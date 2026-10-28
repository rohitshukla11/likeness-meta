import { AppHeader } from "@/components/site/AppHeader";

/** Every app page: the dark nav bar, then compact content on the off-white ground. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <div className="bg-ink text-white">
        <AppHeader />
      </div>
      <main id="main" className="flex-1 text-ink">
        {children}
      </main>
    </div>
  );
}
