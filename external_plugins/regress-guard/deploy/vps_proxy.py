#!/usr/bin/env python3
"""零依赖带认证 HTTP/CONNECT 代理（部署于 VPS，供 regress-guard 企微 API 出口用）。
用法: python3 vps_proxy.py <port> <user> <pass>
"""
import base64
import socket
import sys
import threading
import select
from urllib.parse import urlsplit

PORT = int(sys.argv[1])
AUTH = "Basic " + base64.b64encode((sys.argv[2] + ":" + sys.argv[3]).encode()).decode()


def pipe(a, b):
    pair = [a, b]
    while True:
        r, _, _ = select.select(pair, [], [], 120)
        if not r:
            return
        for s in r:
            try:
                data = s.recv(65536)
            except OSError:
                return
            if not data:
                return
            try:
                (b if s is a else a).sendall(data)
            except OSError:
                return


def worker(c):
    try:
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = c.recv(65536)
            if not chunk:
                return
            req += chunk
        head = req.decode("latin1")
        first = head.split("\r\n", 1)[0]
        lines = head.split("\r\n\r\n", 1)[0].split("\r\n")[1:]
        hdrs = dict(l.split(": ", 1) for l in lines if ": " in l)
        if hdrs.get("Proxy-Authorization", "") != AUTH:
            c.sendall(
                b"HTTP/1.1 407 Proxy Authentication Required\r\n"
                b'Proxy-Authenticate: Basic realm="p"\r\nContent-Length: 0\r\n\r\n'
            )
            return
        method, target = first.split(" ")[0].upper(), first.split(" ")[1]
        if method == "CONNECT":
            host, port = target.rsplit(":", 1)
            u = socket.create_connection((host, int(port)), 10)
            c.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            pipe(c, u)
        else:
            p = urlsplit(target)
            u = socket.create_connection((p.hostname, p.port or 80), 10)
            u.sendall(req.replace(target.encode(), (p.path or "/").encode(), 1))
            pipe(c, u)
    except Exception:
        pass
    finally:
        try:
            c.close()
        except OSError:
            pass


srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("0.0.0.0", PORT))
srv.listen(64)
sys.stderr.write("vps_proxy on %d\n" % PORT)
while True:
    conn, _ = srv.accept()
    threading.Thread(target=worker, args=(conn,), daemon=True).start()
