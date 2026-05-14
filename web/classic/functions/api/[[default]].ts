// functions/api/[[default]].ts
export async function onRequest(context: { request: Request }) {
  // 1. 从环境变量获取你的 NewAPI 后端地址（在控制台配置）
  const apiBase = context.env?.NEWAPI_BACKEND_URL ?? 'https://aiai42.mccom.xyz/api/';

  // 2. 获取请求路径，例如 /api/v1/users -> v1/users
  const url = new URL(context.request.url);
  const subPath = url.pathname.replace(/^\/api\//, '');

  // 3. 构建完整的目标 URL
  const targetUrl = `${apiBase}${subPath}${url.search}`;

  // 4. 转发请求
  const response = await fetch(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  });

  // 5. 返回响应
  return new Response(response.body, response);
}
