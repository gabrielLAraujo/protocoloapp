// A stand-in for the S3-compatible bucket (R2), for the e2e only: the API signs URLs for it (`R2__ServiceUrl`), the browser
// PUTs the PDF to it and the API HEADs / GETs it back. Signatures are not checked; objects live in memory. Plain Node.
// Run: `node storage-stub.mjs [port]` (default 9101).
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? process.env.PORT ?? 9101)
const objects = new Map()

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'ETag',
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub')
  console.log(`${req.method} ${url.pathname}`)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }
  // Path style: /<bucket>/<key>. The bucket itself (a listing, used by the readiness probe) has no key.
  const [, bucket = '', ...rest] = decodeURIComponent(url.pathname).split('/')
  const key = rest.join('/')

  if (!key) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><KeyCount>0</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>`
    res.writeHead(200, { ...cors, 'content-type': 'application/xml' })
    return res.end(xml)
  }

  if (req.method === 'PUT') {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      // The SDK reads the ETag as the hex MD5 of the body.
      const etag = `"${createHash('md5').update(body).digest('hex')}"`
      objects.set(`${bucket}/${key}`, { body, etag, type: req.headers['content-type'] ?? 'application/octet-stream' })
      res.writeHead(200, { ...cors, etag })
      res.end()
    })
    return
  }

  const object = objects.get(`${bucket}/${key}`)
  if (!object) {
    res.writeHead(404, { ...cors, 'content-type': 'application/xml' })
    return res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>')
  }
  res.writeHead(200, { ...cors, 'content-type': object.type, 'content-length': object.body.length, etag: object.etag, 'last-modified': new Date().toUTCString() })
  res.end(req.method === 'HEAD' ? undefined : object.body)
}).listen(port, '127.0.0.1', () => console.log(`storage stub on http://127.0.0.1:${port}`))
