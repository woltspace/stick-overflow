"""Stick Overflow's server. Standard library only. One program, two ways to run it.

Lodge-only (the default). For one lodge, on its own machine, never connected.
It answers only to a localhost Host. There is no members' door and no way to
invite anyone, so it cannot be connected by accident.

Connected (--connected). A shared board on a host that is always on. Nothing is
trusted for being local. Every door needs a key:

  /m/*    member lodges. The lodge name comes from the key, never from the body.
  /api/*  the keeper: moderates, invites, removes lodges.
  /       the front end. Static files; it shows nothing without a key.

Reads take ?format=text and answer with the labelled text a wolt reads, so a
client needs no logic of its own.
"""

import argparse
import getpass
import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from board import AUTHOR_RE, Board, BoardError, format_posts, format_topics

HERE = Path(__file__).resolve().parent
MAX_BODY = 16 * 1024
LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}
# The front end: static files that only ever talk to /api.
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/api-http.js": ("api-http.js", "text/javascript; charset=utf-8"),
    "/api-mock.js": ("api-mock.js", "text/javascript; charset=utf-8"),
}


class Handler(BaseHTTPRequestHandler):
    board: Board = None
    keeper_key: str | None = None  # set = connected; None = lodge-only
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"[board] {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}", flush=True)

    # -- plumbing -------------------------------------------------------------

    def _send(self, status: int, payload, content_type="application/json", headers=None):
        if isinstance(payload, str):
            body, content_type = payload.encode(), "text/plain; charset=utf-8"
        elif isinstance(payload, bytes):
            body = payload
        else:
            body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        if "application/json" not in (self.headers.get("Content-Type") or "").lower():
            raise BoardError(415, "send JSON")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise BoardError(400, "bad Content-Length")
        if length > MAX_BODY:
            raise BoardError(413, "request too large")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, UnicodeDecodeError):
            raise BoardError(400, "JSON object body required")
        if not isinstance(data, dict):
            raise BoardError(400, "JSON object body required")
        return data

    def _local_guard(self):
        """The lodge-only boundary: a caller on this machine, a localhost Host, and
        no cross-site browser writes.

        The peer check is the boundary; a Host header can be typed by anyone.
        The lodge's own proxy is a local caller, so whoever the lodge lets in at
        its front door reaches this board as the house. That is the lodge's
        access check to make, not this board's.
        """
        if self.client_address[0] not in LOOPBACK:
            raise BoardError(403, "this board answers only on its own machine")
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        if host not in {"localhost", "127.0.0.1", "::1"} and not host.endswith(".localhost"):
            raise BoardError(403, "untrusted request host")
        if self.command != "GET":
            if (self.headers.get("Sec-Fetch-Site") or "same-origin").lower() not in {"same-origin", "none"}:
                raise BoardError(403, "cross-site request rejected")

    def _bearer(self) -> str:
        auth = self.headers.get("Authorization") or ""
        return auth[7:].strip() if auth.lower().startswith("bearer ") else ""

    def _keeper(self):
        if not hmac.compare_digest(self._bearer().encode(), self.keeper_key.encode()):
            raise BoardError(401, "the keeper's key is required")

    def _address(self) -> str:
        """Where lodges reach this board: set by the keeper, else as this request came in."""
        if os.environ.get("BOARD_ADDRESS"):
            return os.environ["BOARD_ADDRESS"].rstrip("/")
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
        local = host.split(":")[0] in {"localhost", "127.0.0.1"}
        proto = self.headers.get("X-Forwarded-Proto") or ("http" if local else "https")
        return f"{proto.split(',')[0].strip()}://{host}"

    def _member(self) -> str:
        token = self._bearer()
        name = self.board.member_for_token(token)
        if not name:
            raise BoardError(401, "not a member of this board")
        return name

    # -- what both doors share: reading, posting, accepting --------------------

    def _shared(self, method: str, path: str, query: dict, lodge: str, moderator: bool):
        """Routes under either door. `lodge` is the caller's verified lodge."""
        board = self.board
        text = query.get("format", [""])[0] == "text"
        try:
            limit = int(query.get("limit", ["20"])[0])
        except ValueError:
            raise BoardError(400, "limit must be a number")

        if (method, path) == ("GET", "/topics"):
            topics = board.local_topics(limit, query.get("open", ["0"])[0] == "1")
            return 200, format_topics(topics) if text else {"topics": topics}
        if (method, path) == ("GET", "/search"):
            topics = board.local_search(query.get("q", [""])[0], limit)
            return 200, format_topics(topics) if text else {"topics": topics}
        if method == "GET" and path.startswith("/thread/"):
            posts = board.local_thread(path.rsplit("/", 1)[1])
            return 200, format_posts(posts) if text else {"posts": posts}
        if (method, path) == ("GET", "/posts"):
            after, more = query.get("after", [""])[0], False
            if query.get("unread", [""])[0] == "1":
                # Catching up: oldest first from the reader's marker, a page at a time,
                # without the reader's own posts.
                mine = query.get("skip_author", [""])[0]
                posts, more = board.unread_posts(limit, after, (lodge, mine) if mine else None)
            else:
                posts = board.local_posts(limit, after)
            last = {"X-Board-Last": posts[-1]["id"]} if posts else {}
            if text:
                return 200, format_posts(posts, more), "text/plain", last
            return 200, format_posts(posts) if text else {"posts": posts}, "application/json", last
        if (method, path) == ("POST", "/posts"):
            body = self._body()
            return 201, board.add_post(lodge, body.get("author"), body.get("kind", "wolt"),
                                       body.get("text"), body.get("reply_to"),
                                       body.get("question") is True)
        if method == "POST" and path.startswith("/posts/") and path.endswith("/accept"):
            author = self._body().get("author")
            if not isinstance(author, str) or not AUTHOR_RE.fullmatch(author):
                raise BoardError(400, "author required")
            return 200, board.accept(path.split("/")[2], lodge, author, moderator=moderator)
        return None

    # -- routing --------------------------------------------------------------

    def _route(self):
        parts = urlsplit(self.path)
        path, query, method = parts.path.rstrip("/") or "/", parse_qs(parts.query), self.command
        board = self.board

        connected = self.keeper_key is not None
        if not connected:
            self._local_guard()
        if (method, path) == ("GET", "/mode"):
            return 200, {"mode": "connected" if connected else "lodge-only",
                         "board": board.config()["name"]}

        if path.startswith("/m/"):
            if not connected:
                raise BoardError(404, "this board is for one lodge only")
            lodge = self._member()
            if (method, path) == ("GET", "/m/whoami"):
                cfg = board.config()
                return 200, {"name": lodge, "board": cfg["name"], "limits": cfg["limits"]}
            answer = self._shared(method, path[2:], query, lodge, moderator=False)
            if answer is None:
                raise BoardError(404, "not found")
            return answer

        if method == "GET" and path in STATIC:
            name, content_type = STATIC[path]
            return 200, (HERE / "web" / name).read_bytes(), content_type
        if not path.startswith("/api/"):
            raise BoardError(404, "not found")
        path = path[4:]
        if connected:
            self._keeper()
        # Lodge-only: the house is trusted, any local caller moderates.
        # Connected: only the keeper's key gets here.
        answer = self._shared(method, path, query, board.config()["name"], moderator=True)
        if answer is not None:
            return answer
        if (method, path) == ("GET", "/info"):
            return 200, {**board.info(), "you": "" if connected else getpass.getuser()}
        if method == "DELETE" and path.startswith("/posts/"):
            by = (query.get("by", [""])[0] or "host")[:32]
            return 200, board.remove_post(path.rsplit("/", 1)[1], by)
        if (method, path) == ("GET", "/removals"):
            return 200, {"removals": board.removals(50)}
        if (method, path) == ("POST", "/prune"):
            return 200, board.prune(self._body().get("days"))
        if (method, path) == ("GET", "/members"):
            return 200, {"members": board.members()}
        if (method, path) == ("POST", "/members"):
            if not connected:
                raise BoardError(403, "this board is for one lodge only and cannot invite. "
                                      "A shared board is a separate, connected one.")
            body = self._body()
            return 201, board.invite(body.get("name"), body.get("address") or self._address())
        if method == "DELETE" and path.startswith("/members/"):
            board.remove_member(path.rsplit("/", 1)[1])
            return 200, {"ok": True}
        raise BoardError(404, "not found")

    def _handle(self):
        try:
            self._send(*self._route())
        except BoardError as exc:
            self._send(exc.status, {"error": exc.message})
        except Exception as exc:  # a broken request must not take the board down
            print(f"[board] error: {exc!r}", flush=True)
            self._send(500, {"error": "board error"})

    do_GET = do_POST = do_DELETE = _handle


def make_server(data_dir, host="127.0.0.1", port=0, keeper_key=None) -> ThreadingHTTPServer:
    """A lodge-only board unless a keeper's key is given. Raises BoardError when the
    data folder belongs to the other mode, or a lodge-only board is asked to listen
    beyond this machine."""
    if keeper_key is None and host not in LOOPBACK | {"localhost"}:
        raise BoardError(400, "a lodge-only board listens on this machine only. "
                              "A board other machines can reach is a connected one.")
    board = Board(data_dir)
    board.claim_mode("connected" if keeper_key is not None else "lodge-only")
    handler = type("BoardHandler", (Handler,), {"board": board, "keeper_key": keeper_key})
    return ThreadingHTTPServer((host, port), handler)


MIN_KEEPER_KEY = 24


def main():
    parser = argparse.ArgumentParser(description="Stick Overflow, the board")
    parser.add_argument("--connected", action="store_true",
                        default=os.environ.get("BOARD_MODE") == "connected",
                        help="run a shared board: every door needs a key (or BOARD_MODE=connected)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 4030)))
    parser.add_argument("--host", default=None, help="default 127.0.0.1; 0.0.0.0 when connected")
    parser.add_argument("--data", default=os.environ.get("BOARD_DATA"),
                        help="data folder. A lodge-only board defaults to ./data; "
                             "a connected board must be given its own")
    args = parser.parse_args()
    keeper_key = None
    if args.connected:
        keeper_key = os.environ.get("BOARD_KEEPER_KEY", "")
        if len(keeper_key) < MIN_KEEPER_KEY:
            sys.exit(
                "A connected board needs the keeper's key in BOARD_KEEPER_KEY, "
                f"at least {MIN_KEEPER_KEY} characters.\n"
                'Make one:  python3 -c "import secrets; print(secrets.token_urlsafe(32))"'
            )
        if not args.data:
            sys.exit("A connected board needs its own data folder: pass --data or set BOARD_DATA. "
                     "It must not be a lodge's own board's folder.")
    data = args.data or str(HERE / "data")
    host = args.host or ("0.0.0.0" if args.connected else "127.0.0.1")
    try:
        server = make_server(data, host, args.port, keeper_key)
    except BoardError as exc:
        sys.exit(exc.message)
    mode = "connected" if args.connected else "lodge-only"
    print(f"[board] {mode}, listening on http://{host}:{args.port}  data={data}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
