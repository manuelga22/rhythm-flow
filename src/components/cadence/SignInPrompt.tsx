import { CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

/** Nudge for guests to sign in so their practice can be saved. Hidden when signed in. */
export function SignInPrompt({ className = "", title = "Save your practice history", body = "Sign in to keep your sessions and track progress." }: { className?: string; title?: string; body?: string }) {
  const { user, loading, openSheet } = useAuth();
  if (loading || user) return null;
  return (
    <section className={`flex items-center gap-4 rounded-3xl border border-ink/10 p-5 text-left ${className}`}>
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><CloudUpload className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      <Button type="button" onClick={openSheet} className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-none">Sign in</Button>
    </section>
  );
}
