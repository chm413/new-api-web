// functions/api/[[default]].ts

export async function onRequest(context) {
  const { request, env } = context;
  const backendUrl = env.NEWAPI_BACKEND_URL || 'https://aiai42.mccom.xyz/api/';
  
  const url = new URL(request.url);
  const pathAfterApi = url.pathname.replace(/^\/api\//, '');
  const targetUrl = new URL(pathAfterApi + url.search, backendUrl);
  
  // 复制原始请求头，并修正 Host
  const headers = new Headers(request.headers);
  headers.set('Host', targetUrl.host);
  // 移除可能导致问题的 hop-by-hop 头
  headers.delete('Connection');
  headers.delete('Keep-Alive');
  headers.delete('Proxy-Connection');
  
  // 创建代理请求（不要设置 decompress: "manual"）
  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  });
  
  try {
    // 直接 fetch，默认会自动解压并移除 Content-Encoding 头
    const response = await fetch(proxyRequest);
    
    // 创建新的响应头（避免修改原始响应头）
    const responseHeaders = new Headers(response.headers);
    // 确保不会残留 Content-Encoding（fetch 应该已移除，但为了保险）
    responseHeaders.delete('Content-Encoding');
    // 可选：添加自定义头标识代理
    responseHeaders.set('X-Proxied-By', 'EdgeOne-Pages');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({ error: 'API gateway error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
