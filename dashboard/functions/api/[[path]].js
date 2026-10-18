export async function onRequest({ request, env }) {
  const upstream = (env && env.UPSTREAM) || "http://127.0.0.1:8000";
  const url = new URL(request.url);
  const target = upstream + url.pathname.replace(/^\/api/, "") + url.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const init = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  return fetch(target, init);
}
