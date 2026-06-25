import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/fanvue-callback")({
  beforeLoad: ({ location }) => {
    const url = new URL(location.href);
    const code = url.searchParams.get("code");

    if (!code) {
      throw new Response("Missing code", { status: 400 });
    }

    throw redirect({
      to: "/generate",
    });
  },
});

export default function FanvueCallback() {
  return <div>Connecting Fanvue...</div>;
}
