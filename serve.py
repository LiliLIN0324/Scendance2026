"""本地开发服务器 · Scendance

Python 的 http.server 依赖 mimetypes 推断类型，而 Windows 上的 mimetypes 会读取
注册表，可能把 .js 报成 text/plain。浏览器对 ES module 脚本执行严格的 MIME 校验，
类型不对就会拒绝加载，页面因此停在“正在加载场地与三维素材…”。

这里覆盖需要实测确认的扩展名，保证本地打开的模块与素材类型正确。

用法：python serve.py [端口] [--bind 主机]
默认：http://127.0.0.1:8766/
"""

from __future__ import annotations

import argparse
import functools
import posixpath
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# 覆盖项优先级高于系统 mimetypes，避免平台差异。
EXTRA_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".map": "application/json",
    ".webmanifest": "application/manifest+json",
    ".wasm": "application/wasm",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".hdr": "image/vnd.radiance",
    ".exr": "image/x-exr",
    ".ktx2": "image/ktx2",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".woff2": "font/woff2",
}


class Handler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        ext = posixpath.splitext(str(path))[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        # 开发阶段避免浏览器复用旧文件。
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Scendance site locally.")
    parser.add_argument("port", nargs="?", type=int, default=8766, help="监听端口，默认 8766")
    parser.add_argument("--bind", default="127.0.0.1", help="绑定地址，默认 127.0.0.1")
    parser.add_argument(
        "--directory",
        default=str(Path(__file__).resolve().parent),
        help="要提供服务的目录，默认脚本所在目录",
    )
    args = parser.parse_args()

    handler = functools.partial(Handler, directory=args.directory)
    url = f"http://{args.bind}:{args.port}/"

    with ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        print(f"Serving {args.directory}")
        print(f"打开 {url}")
        print("按 Ctrl+C 停止。")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")


if __name__ == "__main__":
    main()
