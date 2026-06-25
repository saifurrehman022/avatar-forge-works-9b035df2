import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div style={{ padding: "40px", maxWidth: "800px", margin: "auto" }}>
      <h1>Privacy Policy</h1>
      <p>
        Avatar Forge respects your privacy. We only collect data necessary to
        provide AI video generation services.
      </p>

      <h2>Data We Collect</h2>
      <ul>
        <li>Fanvue OAuth tokens</li>
        <li>Uploaded media</li>
        <li>Generated video URLs</li>
      </ul>

      <h2>How We Use Data</h2>
      <p>
        We use your data only to process video generation requests and improve
        service functionality.
      </p>

      <h2>Data Deletion</h2>
      <p>
        To request deletion of your data, contact us at:
        support@avatarforge.ai
      </p>
    </div>
  );
}
