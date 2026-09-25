import { createFileRoute } from "@tanstack/react-router";
import { BottomBar } from "@/components/cadence/BottomBar";
import { DashboardScreen } from "@/components/cadence/DashboardScreen";
import { Header } from "@/components/cadence/Header";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cadence — American English Prosody Studio" },
      { name: "description", content: "Practice natural American English rhythm, stress, intonation, and connected speech." },
      { property: "og:title", content: "Cadence — American English Prosody Studio" },
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
