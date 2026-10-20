"""Serve the n8n workflow JSON with CORS headers.

n8n's "Import from URL" fetches from the browser, so a plain
`python -m http.server` fails the cross-origin check and n8n reports the
result as invalid JSON. This adds the headers that make the fetch succeed.
"""

import http.server
import socketserver

PORT = 8900
DIRECTORY = r"D:\Claude\In_Progress\02_Web_Apps\Cursed_Ai\modules\before-the-dragons\tools"


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def guess_type(self, path):
        if str(path).endswith(".json"):
            return "application/json"
        return super().guess_type(path)


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), CORSHandler) as httpd:
        print(f"serving {DIRECTORY} on http://127.0.0.1:{PORT}")
        httpd.serve_forever()
