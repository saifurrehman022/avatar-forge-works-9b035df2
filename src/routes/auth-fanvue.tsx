import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth-fanvue")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Fanvue Auth Page</div>;
}
