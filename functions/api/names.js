export async function onRequestGet({ env }) {
  const url = new URL(env.GAS_URL);
  url.searchParams.set("action", "names");
  url.searchParams.set("secret", env.SECRET);

  const res = await fetch(url.toString(), { method: "GET" });
  const out = await res.json().catch(() => ({}));
  return json(out, res.ok ? 200 : 500);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
