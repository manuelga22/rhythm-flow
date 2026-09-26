import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { ArrowLeft, LogOut, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { MAX_DISPLAY_NAME, deleteAccount, initials, profileKey, sendEmailCode, signInWithGoogle, signOut, updateDisplayName, verifyEmailCode, type Profile } from "@/lib/auth";

const CODE_LENGTH = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Account panel opened from the header: sign-in when signed out, profile settings when signed in. */
export function AccountSheet() {
  const { user, profile, loading, sheetOpen, setSheetOpen } = useAuth();
  return (
    <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
      <DrawerContent className="device-column mx-auto max-h-[90dvh] border-ink/10 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {loading ? (
          <DrawerHeader className="px-0 pt-6 text-left">
            <DrawerTitle className="font-display text-3xl font-normal tracking-normal">ACCOUNT</DrawerTitle>
            <DrawerDescription>Checking your session…</DrawerDescription>
          </DrawerHeader>
        ) : user ? (
          // Remount once the profile arrives so the name field starts from it.
          <SignedIn key={`${user.id}:${profile ? "loaded" : "pending"}`} user={user} profile={profile} onDone={() => setSheetOpen(false)} />
        ) : (
          <SignIn onDone={() => setSheetOpen(false)} />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (event?: FormEvent) => {
    event?.preventDefault();
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setError("Enter a valid email address.");
      return;
    }
    void run(async () => {
      await sendEmailCode(address);
      setCode("");
      setStep("code");
    });
  };

  const verify = (value: string) =>
    run(async () => {
      try {
        await verifyEmailCode(email.trim(), value);
      } catch (err) {
        setCode("");
        throw err;
      }
      toast.success("You're signed in.");
      onDone();
    });

  return (
    <div className="pb-2">
      <DrawerHeader className="px-0 pt-6 text-left">
        <DrawerTitle className="font-display text-3xl font-normal tracking-normal">{step === "email" ? "SIGN IN" : "CHECK YOUR EMAIL"}</DrawerTitle>
        <DrawerDescription>
          {step === "email" ? "Practice freely. Sign in to save your sessions." : `We sent a ${CODE_LENGTH}-digit code to ${email.trim()}.`}
        </DrawerDescription>
      </DrawerHeader>

      {step === "email" ? (
        <div className="grid gap-4">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run(signInWithGoogle)} className="h-12 rounded-2xl border-ink/15 shadow-none">
            <GoogleMark /> Continue with Google
          </Button>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <span className="h-px flex-1 bg-ink/10" />or<span className="h-px flex-1 bg-ink/10" />
          </div>
          <form onSubmit={sendCode} className="grid gap-3" noValidate>
            <label htmlFor="account-email" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Email</label>
            <Input id="account-email" type="email" inputMode="email" autoComplete="email" value={email} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(error)} className="h-12 rounded-xl border-ink/15 bg-background px-4 shadow-none" />
            <Button type="submit" disabled={busy || !email.trim()} className="h-12 rounded-2xl bg-primary text-primary-foreground shadow-none">
              <Mail /> {busy ? "Sending…" : "Email me a code"}
            </Button>
          </form>
        </div>
      ) : (
        <div className="grid gap-4">
          <InputOTP maxLength={CODE_LENGTH} value={code} onChange={setCode} onComplete={(value: string) => void verify(value)} disabled={busy} autoFocus inputMode="numeric" containerClassName="justify-center">
            <InputOTPGroup>
              {Array.from({ length: CODE_LENGTH }, (_, index) => (
                <InputOTPSlot key={index} index={index} className="h-12 w-11 border-ink/15 text-lg" />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <div className="flex items-center justify-between text-sm">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { setError(null); setStep("email"); }} className="h-10 rounded-xl px-2 text-muted-foreground">
              <ArrowLeft /> Different email
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => sendCode()} className="h-10 rounded-xl px-2 text-primary">
              Resend code
            </Button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function SignedIn({ user, profile, onDone }: { user: User; profile: Profile | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const saved = profile?.display_name ?? "";
  const [name, setName] = useState(saved);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const save = useMutation({
    mutationFn: () => updateDisplayName(user.id, name),
    onSuccess: (updated) => {
      queryClient.setQueryData(profileKey(user.id), updated);
      setName(updated.display_name ?? "");
      toast.success("Name saved.");
    },
  });
  const leave = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      toast.success("You're signed out.");
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success("Your account was deleted.");
      onDone();
    },
  });

  const error = save.error ?? leave.error ?? remove.error;
  const dirty = name.trim() !== saved;

  return (
    <div className="pb-2">
      <DrawerHeader className="flex flex-row items-center gap-4 px-0 pt-6 text-left">
        <Avatar className="size-14">
          <AvatarFallback className="bg-ink font-display text-xl text-background">{initials(saved, user.email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <DrawerTitle className="truncate font-display text-3xl font-normal tracking-normal">{saved ? saved.toUpperCase() : "YOUR ACCOUNT"}</DrawerTitle>
          <DrawerDescription className="truncate">{user.email}</DrawerDescription>
        </div>
      </DrawerHeader>

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) save.mutate();
        }}
      >
        <label htmlFor="account-name" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Display name</label>
        <div className="flex gap-2">
          <Input id="account-name" value={name} maxLength={MAX_DISPLAY_NAME} autoComplete="name" placeholder="What should we call you?" onChange={(event) => setName(event.target.value)} className="h-12 min-w-0 flex-1 rounded-xl border-ink/15 bg-background px-4 shadow-none" />
          <Button type="submit" disabled={!dirty || save.isPending} className="h-12 rounded-xl bg-primary px-5 text-primary-foreground shadow-none">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>

      <Button type="button" variant="outline" disabled={leave.isPending} onClick={() => leave.mutate()} className="mt-6 h-12 w-full rounded-2xl border-ink/15 shadow-none">
        <LogOut /> {leave.isPending ? "Signing out…" : "Sign out"}
      </Button>

      <section className="mt-6 rounded-2xl border border-destructive/25 p-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-destructive">Danger zone</p>
        <p className="mt-1 text-sm text-muted-foreground">Deleting your account removes your profile and saved data for good.</p>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="ghost" className="mt-3 h-10 rounded-xl px-3 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Trash2 /> Delete account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-[calc(var(--width-device)-2rem)] rounded-3xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>This permanently deletes {user.email ?? "your account"} and everything saved to it. This can't be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl" disabled={remove.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={remove.isPending}
                onClick={(event) => {
                  // Keep the dialog open until the deletion finishes.
                  event.preventDefault();
                  remove.mutate();
                }}
              >
                {remove.isPending ? "Deleting…" : "Delete account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
