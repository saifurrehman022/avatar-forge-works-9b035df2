import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div style={{ padding: "40px", textAlign: "center" }}>
      <h1>Avatar Forge</h1>
      <p>AI-powered video generation for Fanvue creators.</p>

      <a href="/auth-fanvue">Connect with Fanvue</a>

      <br />
      <br />

      <a href="/privacy">Privacy Policy</a> |{" "}
      <a href="/terms">Terms of Service</a>
    </div>
  );
}
