// functions/api/[[default]].ts

// ---------- 配置（可通过环境变量覆盖） ----------
const DEFAULT_CONFIG = {
  BACKEND_URL: 'https://aiai42.mccom.xyz/api/',
  TIMEOUT_MS: 8000,               // 8秒
  MAX_RETRIES: 1,                 // 仅对幂等请求重试
  ALLOWED_PATHS_REGEX: /^[a-zA-Z0-9\/\-_]*$/,  // 禁止特殊字符
  LOG_LEVEL: 'info',              // debug | info | error
  ENABLE_CIRCUIT_BREAKER: false,  // 简单实现，暂不启用
  MAX_BODY_SIZE_BYTES: 1024 * 1024, // 1MB，超过直接拒绝
};

// ---------- 辅助函数 ----------
const getConfig = (env: any) => ({
  backendUrl: (env.NEWAPI_BACKEND_URL || DEFAULT_CONFIG.BACKEND_URL).replace(/\/$/, '') + '/',
  timeoutMs: parseInt(env.TIMEOUT_MS ?? DEFAULT_CONFIG.TIMEOUT_MS),
  maxRetries: env.ENVIRONMENT === 'development' ? 0 : DEFAULT_CONFIG.MAX_RETRIES,
  logLevel: env.LOG_LEVEL ?? DEFAULT_CONFIG.LOG_LEVEL,
  allowedPathsRegex: DEFAULT_CONFIG.ALLOWED_PATHS_REGEX,
  maxBodySize: DEFAULT_CONFIG.MAX_BODY_SIZE_BYTES,
});

const generateRequestId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

const log = (level: string, msg: string, data?: any) => {
  if (level === 'debug' && getConfig({}).logLevel !== 'debug') return;
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ level, msg, ...data, timestamp: new Date().toISOString() }));
};

const isSafePath = (path: string, regex: RegExp) => regex.test(path) && !path.includes('..') && !path.includes('%2e');

// ---------- 主函数 ----------
export async function onRequest(context: { request: Request; env: any; waitUntil: (p: Promise<any>) => void }) {
  const { request, env, waitUntil } = context;
  const config = getConfig(env);
  const requestId = generateRequestId();
  const startTime = Date.now();

  // 1. 预处理请求体大小限制
  const contentLength = parseInt(request.headers.get('content-length') || '0');
  if (contentLength > config.maxBodySize) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
  }

  // 2. 解析并验证路径
  const url = new URL(request.url);
  let pathAfterApi = url.pathname.replace(/^\/api\//, '');
  if (!isSafePath(pathAfterApi, config.allowedPathsRegex)) {
    log('error', 'Unsafe path detected', { requestId, path: url.pathname });
    return new Response(JSON.stringify({ error: 'Invalid path' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // 3. 构造目标 URL（确保最终 URL 在允许的后端域名下）
  const targetBase = config.backendUrl;
  let targetUrl: URL;
  try {
    targetUrl = new URL(pathAfterApi + url.search, targetBase);
    // 防止 URL 被解析到其他域名（如 //evil.com）
    if (targetUrl.origin !== new URL(targetBase).origin) {
      throw new Error('Origin mismatch');
    }
  } catch (err) {
    log('error', 'Invalid target URL', { requestId, pathAfterApi, error: err.message });
    return new Response(JSON.stringify({ error: 'Bad backend configuration' }), { status: 500 });
  }

  // 4. 构造安全的请求头
  const headers = new Headers(request.headers);
  // 强制修正 Host
  headers.set('Host', targetUrl.host);
  // 移除危险头
  headers.delete('Connection');
  headers.delete('Keep-Alive');
  headers.delete('Proxy-Connection');
  headers.delete('Transfer-Encoding'); // 让 fetch 自动处理
  // 添加请求追踪头
  headers.set('X-Request-Id', requestId);
  headers.set('X-Forwarded-For', ''); // 可选：设置为真实客户端 IP（从 context 获取）
  // 避免后端因 Cloudflare 质询而返回 418，可尝试添加模拟浏览器 UA（但可能违反政策）
  // if (!headers.has('User-Agent')) headers.set('User-Agent', 'Mozilla/5.0 (compatible; EdgeOneProxy/1.0)');

  const isIdempotent = ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
  const maxRetries = isIdempotent ? config.maxRetries : 0;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const fetchOptions: RequestInit = {
        method: request.method,
        headers,
        body: isIdempotent ? undefined : request.body,
        redirect: 'follow',
        signal: controller.signal,
      };
      const response = await fetch(targetUrl.toString(), fetchOptions);
      clearTimeout(timeoutId);

      // 记录成功
      log('info', 'Proxy success', { requestId, status: response.status, duration: Date.now() - startTime, target: targetUrl.toString() });
      
      // 添加自定义响应头
      const respHeaders = new Headers(response.headers);
      respHeaders.set('X-Proxy-Request-Id', requestId);
      if (response.status === 418) {
        respHeaders.set('X-Proxy-Warning', 'Backend rejected request (Cloudflare challenge)');
        log('warn', 'Backend returned 418', { requestId });
      }
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;
      const isTimeout = err.name === 'AbortError';
      const isNetwork = err.message.includes('fetch') || err.message.includes('network');
      if (!isTimeout && !isNetwork) break;
      if (attempt === maxRetries) break;
      // 等待指数退避
      const backoff = Math.min(100 * Math.pow(2, attempt), 1000);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }

  // 最终失败
  log('error', 'Proxy failed after retries', { requestId, target: targetUrl.toString(), error: lastError?.message, duration: Date.now() - startTime });
  // 不暴露内部错误细节
  return new Response(JSON.stringify({ error: 'API gateway error' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
  });
}
