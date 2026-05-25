import * as net from 'net'

export function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      const port = addr.port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}
