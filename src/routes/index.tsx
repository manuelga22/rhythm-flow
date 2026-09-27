import { createFileRoute } from "@tanstack/react-router";
import { BottomBar } from "@/components/cadence/BottomBar";
import { DashboardScreen } from "@/components/cadence/DashboardScreen";
import { Header } from "@/components/cadence/Header";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RhythmFlow — Train you speaking, build confidence" },
      { name: "description", content: "Practice natural American English rhythm, stress, intonation, and connected speech." },
      { property: "og:title", content: "RhythmFlow — Train you speaking, build confidence" },
      { property: "og:description", content: "A focused studio for practicing natural rhythm and connected speech." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Header />
      <DashboardScreen />
      <BottomBar active="home" />
    </div>
  );
}
