// monitor-report 演示项目：零依赖本地服务器。
// 职责：静态文件（demo 页面 + dist 产物）+ 上报接收端点 /api/upload（打印摘要并落盘 jsonl）。
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { appendFile, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 3860)
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..') // 项目根目录
const LOG_FILE = join(ROOT, 'demo', 'received.jsonl')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  if (decoded === '/' || decoded === '') return join(ROOT, 'demo', 'index.html')
  const normalized = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '')
  const full = join(ROOT, normalized)
  if (!full.startsWith(ROOT)) return null // 防目录穿越
  return full
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (url.pathname === '/api/upload' && req.method === 'POST') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      let parsed = null
      try {
        parsed = JSON.parse(body)
        const types = [...new Set((parsed.logs ?? []).map((s) => s.type))].join(',')
        console.log(
          `[report] appId=${parsed.appInfo?.appId} sdk=${parsed.appInfo?.sdkVersion} logs=${parsed.logs?.length ?? 0} types=${types} pageUrl=${parsed.pageInfo?.url}`
        )
        appendFile(LOG_FILE, body + '\n', 'utf8').catch(() => {})
      } catch {
        console.log('[report] invalid json: ' + body.slice(0, 120))
      }
      res.writeHead(parsed ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(parsed ? '{"ok":true}' : '{"ok":false}')
    })
    return
  }

  // image 模式（像素信标）：GET /api/upload?d=<encodeURIComponent(JSON)>
  // 浏览器发的是 no-cors 请求，必须返回一张真实图片，否则 onerror 触发但 SDK 无从感知
  if (url.pathname === '/api/upload' && req.method === 'GET') {
    const GIF_1X1 = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    )
    const raw = url.searchParams.get('d') // URLSearchParams 已自动 decode
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        const types = [...new Set((parsed.logs ?? []).map((s) => s.type))].join(',')
        console.log(
          `[report:image] logs=${parsed.logs?.length ?? 0} types=${types} pageUrl=${parsed.pageInfo?.url}`
        )
        appendFile(LOG_FILE, raw + '\n', 'utf8').catch(() => {})
      } catch {
        console.log('[report:image] invalid json: ' + raw.slice(0, 120))
      }
    }
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' })
    res.end(GIF_1X1)
    return
  }

  if (url.pathname === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end('{"code":0,"data":[1,2,3]}')
    return
  }
  if (url.pathname === '/api/not-exist') {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end('{"code":404}')
    return
  }
  if (url.pathname === '/api/unauthorized') {
    // 验证 statusCategory: unauthorized（前端最高频事故）
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end('{"code":401,"msg":"token expired"}')
    return
  }
  if (url.pathname === '/api/hang') {
    // 永不响应：用于验证超时（客户端 requestConfig.timeout 生效）与 statusCategory: timeout
    return
  }

  // ---- 电商模拟项目 API ----
  const PRODUCTS = [
    { id: 1, name: '蓝牙耳机', price: 199 },
    { id: 2, name: '机械键盘', price: 399 },
    { id: 3, name: '幸运盲盒（坏商品）', price: 9.9 },
    { id: 4, name: '显示器支架', price: 129 }
  ]
  if (url.pathname === '/api/products') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ code: 0, data: PRODUCTS }))
    return
  }
  const productMatch = /^\/api\/product\/(\d+)$/.exec(url.pathname)
  if (productMatch) {
    const id = Number(productMatch[1])
    const product = PRODUCTS.find((p) => p.id === id)
    if (!product) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end('{"code":404,"msg":"product not found"}')
      return
    }
    if (id === 3) {
      // 模拟线上偶发故障：坏商品接口 500
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end('{"code":500,"msg":"internal error"}')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ code: 0, data: product }))
    return
  }
  if (url.pathname === '/api/search') {
    // 慢接口：1.8s 后返回
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ code: 0, data: { keyword: url.searchParams.get('q') ?? '', total: 3 } }))
    }, 1800)
    return
  }

  const filePath = safePath(url.pathname)
  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  stat(filePath)
    .then((s) => {
      if (s.isDirectory()) {
          const target = url.pathname.endsWith('/')
            ? url.pathname + 'index.html'
            : url.pathname + '/'
          // 保留 query：否则 302 会吞掉 location 上的敏感参数，脱敏验证无法端到端命中
          res.writeHead(302, { Location: target + url.search })
          res.end()
          return
        }
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(filePath).pipe(res)
    })
    .catch(() => {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    })
})

server.listen(PORT, () => {
  console.log(`[demo] server listening at http://localhost:${PORT}/demo/`)
  console.log(`[demo] report endpoint: POST http://localhost:${PORT}/api/upload`)
  console.log(`[demo] log file: ${LOG_FILE}`)
})