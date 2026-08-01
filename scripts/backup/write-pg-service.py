#!/usr/bin/env python3
import sys
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlparse


ALLOWED_QUERY_KEYS = {
    "application_name",
    "connect_timeout",
    "sslcert",
    "sslkey",
    "sslmode",
    "sslrootcert",
    "target_session_attrs",
}


def clean(value: str, field: str) -> str:
    if "\n" in value or "\r" in value:
        raise SystemExit(f"{field} must not contain newlines")
    return value


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit("usage: write-pg-service.py <url-file> <service-file> <service-name>")

    url_path = Path(sys.argv[1])
    service_path = Path(sys.argv[2])
    service_name = clean(sys.argv[3], "service name")
    if not service_name.replace("_", "").replace("-", "").isalnum():
        raise SystemExit("service name must contain only letters, numbers, underscores, or hyphens")

    raw_url = url_path.read_text(encoding="utf-8").strip()
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise SystemExit("database URL must use postgres:// or postgresql://")
    if not parsed.path or parsed.path == "/":
        raise SystemExit("database URL must include a database name")

    lines = [f"[{service_name}]"]
    if parsed.hostname:
        lines.append(f"host={clean(parsed.hostname, 'host')}")
    if parsed.port:
        lines.append(f"port={parsed.port}")
    lines.append(f"dbname={clean(unquote(parsed.path.lstrip('/')), 'database name')}")
    if parsed.username:
        lines.append(f"user={clean(unquote(parsed.username), 'user')}")
    if parsed.password:
        lines.append(f"password={clean(unquote(parsed.password), 'password')}")

    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key in ALLOWED_QUERY_KEYS:
            lines.append(f"{key}={clean(value, key)}")

    service_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
