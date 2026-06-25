import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth-fanvue")({
  component: AuthFanvue,
});

function AuthFanvue() {
  const clientId = import.meta.env.VITE_FANVUE_CLIENT_ID;
  const redirectUri = encodeURIComponent(
    "https://avatar-forge-works-9b035df2-olive.vercel.app/fanvue-callback"
  );

  const authUrl =
    `https://auth.fanvue.com/oauth2/auth?` +
    `client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=openid offline_access offline`;

  if (typeof window !== "undefined") {
    window.location.href = authUrl;
  }

  return <div>Redirecting to Fanvue...</div>;
}
