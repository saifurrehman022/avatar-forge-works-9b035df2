export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    throw new Response("Missing code", { status: 400 });
  }

  return Response.redirect("/generate");
}

export default function FanvueCallback() {
  return <div>Connecting Fanvue...</div>;
}
