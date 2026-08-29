/**
 * download-xlsx.js — 通过本地 SOCKS5 代理（xray 10808）下载 SheetJS
 * 手写 SOCKS5 握手 + TLS（绕过系统 curl 的 schannel 凭据问题）
 * 用法：node test/download-xlsx.js
 */
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const PROXY = { host: '127.0.0.1', port: 10808 };
const SOURCES = [
  { host: 'cdnjs.cloudflare.com', path: '/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' },
  { host: 'unpkg.com', path: '/xlsx@0.18.5/dist/xlsx.full.min.js' },
  { host: 'cdn.jsdelivr.net', path: '/npm/xlsx@0.18.5/dist/xlsx.full.min.js' }
];
const OUT = path.join(__dirname, '..', 'lib', 'xlsx.full.min.js');

/** 解码 HTTP chunked body */
function decodeChunked(body) {
  const out = [];
  let pos = 0;
  while (pos < body.length) {
    const crlf = body.indexOf('\r\n', pos);
    if (crlf < 0) break;
    const size = parseInt(body.slice(pos, crlf).toString('utf8').trim(), 16);
    if (isNaN(size) || size < 0) break;
    if (size === 0) break; // 结束块
    out.push(body.slice(crlf + 2, crlf + 2 + size));
    pos = crlf + 2 + size + 2;
  }
  return Buffer.concat(out);
}

function downloadViaSocks(source) {
  return new Promise(function (resolve, reject) {
    const socket = net.connect(PROXY.port, PROXY.host);
    const HOST = source.host;
    const PORT = 443;

    socket.once('error', function (e) { reject(new Error('socks connect: ' + e.message)); });
    socket.once('connect', function () {
      socket.write(Buffer.from([0x05, 0x01, 0x00])); // 版本5, 1种认证方式: 无认证
    });

    socket.once('data', function (buf) {
      if (buf[0] !== 0x05 || buf[1] !== 0x00) { reject(new Error('socks auth failed')); socket.destroy(); return; }
      const hostBuf = Buffer.from(HOST, 'utf8');
      const req = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
        hostBuf,
        Buffer.from([0x01, 0xBB]) // 端口 443
      ]);
      socket.write(req);
      socket.once('data', function (rep) {
        if (rep[1] !== 0x00) { reject(new Error('socks connect refused code=' + rep[1])); socket.destroy(); return; }
        const tlsSocket = tls.connect({ socket: socket, servername: HOST }, function () {
          tlsSocket.write('GET ' + source.path + ' HTTP/1.1\r\nHost: ' + HOST + '\r\nConnection: close\r\nUser-Agent: dsh-seatplanner\r\nAccept-Encoding: identity\r\n\r\n');
        });
        const chunks = [];
        tlsSocket.on('data', function (d) { chunks.push(d); });
        tlsSocket.on('error', function (e) { reject(new Error('tls: ' + e.message)); });
        tlsSocket.on('end', function () {
          const all = Buffer.concat(chunks);
          const idx = all.indexOf('\r\n\r\n');
          if (idx < 0) { reject(new Error('no http header')); return; }
          const header = all.slice(0, idx).toString();
          let body = all.slice(idx + 4);
          // 解码 chunked transfer-encoding（cdnjs 等会分块传输）
          if (/transfer-encoding:\s*chunked/i.test(header)) {
            body = decodeChunked(body);
          }
          const m = /^HTTP\/1\.[01] (\d+)/.exec(header);
          const code = m ? m[1] : '?';
          if (code === '200') resolve({ body: body, header: header });
          else reject(new Error('HTTP ' + code));
        });
      });
    });
  });
}

(async function () {
  for (const src of SOURCES) {
    try {
      console.log('trying', src.host);
      const r = await downloadViaSocks(src);
      if (r.body.length > 300000) {
        fs.writeFileSync(OUT, r.body);
        console.log('OK saved', OUT, r.body.length, 'bytes from', src.host);
        process.exit(0);
      } else {
        console.log('body too small', r.body.length, '- skip');
      }
    } catch (e) {
      console.log('FAIL', src.host, e.message);
    }
  }
  console.log('ALL_SOURCES_FAILED');
  process.exit(1);
})();
