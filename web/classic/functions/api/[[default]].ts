// functions/api/[[default]].ts
export async function onRequest(context) {
  const { request, env } = context;
  const backendUrl = env.NEWAPI_BACKEND_URL || 'https://aiai42.mccom.xyz/api/';
  
  const url = new URL(request.url);
  const pathAfterApi = url.pathname.replace(/^\/api\//, '');
  const targetUrl = new URL(pathAfterApi + url.search, backendUrl);
  
  // 创建新的请求，复制原始请求头（包括 cookie）
  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  // 重要：修正 Host 头为目标服务器的实际域名
  proxyRequest.headers.set('Host', targetUrl.host);
  
  try {
    const response = await fetch(proxyRequest);
    return response;
  } catch (error) {
    return new Response(`Proxy error: ${error.message}`, { status: 500 });
  }
}
