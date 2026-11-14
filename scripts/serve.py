"""Serve the site on this computer for trying things out.

Unlike plain `python -m http.server`, every answer tells the browser to check back before
reusing a saved copy. Without that a browser keeps showing old code for hours after a file has
changed, and a reload does not help.

usage: python scripts/serve.py [port] [folder]      (4175 and the current folder unless given)
"""
import contextlib
import functools
import http.server
import socket
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')      # "ask me first": unchanged files still come back as a quick "not modified"
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    """Answers on localhost both ways a browser may dial it (::1 and 127.0.0.1), as python's own server does."""
    address_family = socket.AF_INET6
    # A page asks for dozens of files at once now that none is taken from a saved copy. Python's
    # usual queue of five waiting callers overflows at that, and on Windows the browser is then
    # refused outright and the page never finishes loading.
    request_queue_size = 256

    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        return super().server_bind()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4175
    folder = sys.argv[2] if len(sys.argv) > 2 else '.'
    print(f'Serving {folder} at http://localhost:{port}/ (no stale copies)', flush=True)
    Server(('::', port), functools.partial(Handler, directory=folder)).serve_forever()
