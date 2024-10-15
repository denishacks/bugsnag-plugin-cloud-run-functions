/**
 * Copyright (c) Bugsnag, https://www.bugsnag.com/
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the Software
 * is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
const extractObject = require('@bugsnag/core/lib/extract-object')

module.exports = req => {
  const connection = req.connection
  const address = connection && connection.address && connection.address()
  const portNumber = address && address.port
  const port = (!portNumber || portNumber === 80 || portNumber === 443) ? '' : `:${portNumber}`
  const protocol = typeof req.protocol !== 'undefined' ? req.protocol : (req.connection.encrypted ? 'https' : 'http')
  const hostname = (req.hostname || req.host || req.headers.host || '').replace(/:\d+$/, '')
  const url = `${protocol}://${hostname}${port}${req.url}`
  const request = {
    url: url,
    path: req.path || req.url,
    httpMethod: req.method,
    headers: req.headers,
    httpVersion: req.httpVersion
  }

  request.params = extractObject(req, 'params')
  request.query = extractObject(req, 'query')
  request.body = extractObject(req, 'body')

  request.clientIp = req.ip || (connection ? connection.remoteAddress : undefined)
  request.referer = req.headers.referer || req.headers.referrer

  if (connection) {
    request.connection = {
      remoteAddress: connection.remoteAddress,
      remotePort: connection.remotePort,
      bytesRead: connection.bytesRead,
      bytesWritten: connection.bytesWritten,
      localPort: portNumber,
      localAddress: address ? address.address : undefined,
      IPVersion: address ? address.family : undefined
    }
  }
  return request
}
