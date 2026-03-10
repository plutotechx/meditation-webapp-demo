export function getEnv(ctx, key) {
  const v = ctx.env?.[key] ?? ctx.cloudflare?.env?.[key] ?? undefined;
  if (!v) throw new Error(`missing_env:${key}`);
  return v;
}

export function withAction(gasUrl, action, secret) {
  const u = new URL(gasUrl);
  // ล้าง query เก่าทั้งหมด เผื่อมี action/secret ติดมา
  u.search = "";
  u.searchParams.set("action", action);
  u.searchParams.set("secret", secret);
  return u.toString();
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
