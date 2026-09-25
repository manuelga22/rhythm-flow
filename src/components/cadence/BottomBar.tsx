import { Link } from "@tanstack/react-router";
import { BarChart3, Home, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BottomBar({ active }: { active?: "home" | "practice" }) {
  const tone = (tab: "home" | "practice") => (active === tab ? "text-primary" : "text-muted-foreground");
  return (
    <nav className="fixed bottom-3 left-1/2 z-30 grid w-[calc(100%-1.5rem)] max-w-[calc(var(--width-device)-1.5rem)] -translate-x-1/2 grid-cols-3 rounded-[1.4rem] border border-ink/10 bg-card/95 px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))] pt-2 shadow-lg backdrop-blur-md" aria-label="App navigation">
      <Button asChild variant="ghost" className={`h-12 flex-col gap-0.5 rounded-xl text-[9px] ${tone("home")}`}><Link to="/"><Home className="size-5" />Home</Link></Button>
      <Button asChild variant="ghost" className={`h-12 flex-col gap-0.5 rounded-xl text-[9px] ${tone("practice")}`}><Link to="/practice"><Mic className="size-5" />Practice</Link></Button>
      <Button variant="ghost" className="h-12 flex-col gap-0.5 rounded-xl text-[9px] text-muted-foreground"><BarChart3 className="size-5" />Progress</Button>
    </nav>
  );
}
