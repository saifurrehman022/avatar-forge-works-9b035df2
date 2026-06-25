import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <div style={{ padding: "40px", maxWidth: "800px", margin: "auto" }}>
      <h1>Terms of Service</h1>

      <p>
        By using Avatar Forge, you agree to use the platform responsibly and in
        compliance with Fanvue policies.
      </p>

      <h2>Service Usage</h2>
      <p>
        Avatar Forge provides AI-powered video generation tools for creators.
      </p>

      <h2>Liability</h2>
      <p>
        We are not liable for misuse of generated content or third-party
        platform violations.
      </p>

      <h2>Contact</h2>
      <p>support@avatarforge.ai</p>
    </div>
  );
}
