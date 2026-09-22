"""Serve the site locally, the way it is served in production: every file revalidated.

``python -m http.server`` sends no Cache-Control, so browsers cache by heuristic and can keep an
old worker.js or glue module long after it changed. This is the same server, telling them not to::

    python serve.py [port]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = partial(NoCacheHandler, directory=str(Path(__file__).parent))
    print(f"mento-web on http://localhost:{port}")
    ThreadingHTTPServer(("", port), handler).serve_forever()
