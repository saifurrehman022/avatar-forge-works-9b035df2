import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/fanvue-callback")({
  beforeLoad: ({ search }) => {
    const code = search.code;

    if (code) {
      throw redirect({
        to: "/generate",
      });
    }
  },
});

export default function FanvueCallback() {
  return <div>Waiting for Fanvue authentication...</div>;
}
