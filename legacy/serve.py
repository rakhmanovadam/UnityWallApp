#!/usr/bin/env python3
"""SPA fallback dev server — serves files when they exist, otherwise index.html.
Run: python3 serve.py [port]
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))

class SpaHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        fs_path = os.path.normpath(os.path.join(ROOT, path.lstrip("/")))
        if not fs_path.startswith(ROOT):
            self.send_error(403); return
        if path != "/" and os.path.isfile(fs_path):
            return super().do_GET()
        if path != "/" and not os.path.exists(fs_path):
            self.path = "/index.html"
        return super().do_GET()
    def log_message(self, *a, **kw): pass  # quiet

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), SpaHandler)
    print(f"UnityWall on http://127.0.0.1:{port}")
    httpd.serve_forever()
