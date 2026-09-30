import { Link } from "@tanstack/react-router";
import { BarChart3, Home, Mic, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Tab = "home" | "practice" | "progress";

// Progress has no page yet, so it has no route.
const items: { tab: Tab; label: string; icon: LucideIcon; to?: "/" | "/practice" }[] = [
  { tab: "home", label: "Home", icon: Home, to: "/" },
  { tab: "practice", label: "Practice", icon: Mic, to: "/practice" },
  { tab: "progress", label: "Progress", icon: BarChart3 },
];

/** App navigation: a floating bottom bar on phones, a left sidebar on desktop. */
export function BottomBar({ active }: { active?: "home" | "practice" }) {
  const tone = (tab: Tab) => (active === tab ? "text-primary" : "text-muted-foreground");
  return (
    <>
      <nav className="fixed bottom-3 left-1/2 z-30 grid w-[calc(100%-1.5rem)] max-w-[calc(var(--width-device)-1.5rem)] -translate-x-1/2 grid-cols-3 rounded-[1.4rem] border border-ink/10 bg-card/95 px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))] pt-2 shadow-lg backdrop-blur-md lg:hidden" aria-label="App navigation">
        {items.map(({ tab, label, icon: Icon, to }) => (
          <Button key={tab} asChild={Boolean(to)} variant="ghost" className={`h-12 flex-col gap-0.5 rounded-xl text-[9px] ${tone(tab)}`}>
            {to ? <Link to={to}><Icon className="size-5" />{label}</Link> : <><Icon className="size-5" />{label}</>}
          </Button>
        ))}
      </nav>
      <nav className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-ink/10 bg-background lg:flex" aria-label="App navigation">
        {/* Matches the header: 3.5rem plus its bottom border. */}
        <div className="flex h-[calc(3.5rem+1px)] shrink-0 items-center border-b border-ink/10 px-6">
          <Link to="/" className="flex cursor-pointer items-baseline gap-2" aria-label="Cadence home">
            <span className="font-display text-xl">RhythmFlow</span>
          </Link>
        </div>
        <div className="flex flex-col gap-1 p-3">
          {items.map(({ tab, label, icon: Icon, to }) => (
            <Button key={tab} asChild={Boolean(to)} variant="ghost" className={`h-11 justify-start gap-3 rounded-xl px-3 text-sm ${active === tab ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground"}`}>
              {to ? <Link to={to} aria-current={active === tab ? "page" : undefined}><Icon className="size-5" />{label}</Link> : <><Icon className="size-5" />{label}</>}
            </Button>
          ))}
        </div>
      </nav>
    </>
  );
}
