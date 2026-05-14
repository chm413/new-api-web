export async function onRequest(context) {
  const url = new URL(context.request.url);
  return new Response(JSON.stringify({
    path: url.pathname,
    search: url.search,
    method: context.request.method,
    headers: Object.fromEntries(context.request.headers)
  }), { headers: { 'Content-Type': 'application/json' } });
}
