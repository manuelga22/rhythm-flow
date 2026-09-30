import { createFileRoute, redirect } from "@tanstack/react-router";

// The method now lives on the home page; keep old links working.
export const Route = createFileRoute("/method")({
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "method", replace: true });
  },
});
