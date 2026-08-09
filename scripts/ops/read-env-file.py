#!/usr/bin/env python3
import ast
import re
import sys
from pathlib import Path

KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def strip_inline_comment(value: str) -> str:
    for index, char in enumerate(value):
        if char == "#" and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
    return value.rstrip()


def parse_quoted(value: str) -> tuple[str, str]:
    quote = value[0]
    escaped = False
    for index in range(1, len(value)):
        char = value[index]
        if quote == '"' and char == "\\" and not escaped:
            escaped = True
            continue
        if char == quote and not escaped:
            return value[: index + 1], value[index + 1 :]
        escaped = False
    fail("Unterminated quoted environment value")


def parse_value(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if value[0] in ("'", '"'):
        quoted, rest = parse_quoted(value)
        if strip_inline_comment(rest.strip()):
            fail("Unexpected content after quoted environment value")
        try:
            parsed = ast.literal_eval(quoted)
        except (SyntaxError, ValueError) as error:
            fail(f"Invalid quoted environment value: {error}")
        if not isinstance(parsed, str):
            fail("Quoted environment value did not parse as a string")
        result = parsed
    else:
        result = strip_inline_comment(value)
    if any(char in result for char in ("\0", "\n", "\r")):
        fail("Environment values must not contain NUL or newline characters")
    return result


def main() -> None:
    if len(sys.argv) != 2:
        fail("Usage: read-env-file.py ENV_FILE")
    path = Path(sys.argv[1])
    seen_keys: set[str] = set()
    for line_number, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        if "=" not in line:
            fail(f"Invalid environment assignment on line {line_number}")
        key, value = line.split("=", 1)
        key = key.strip()
        if not KEY_RE.match(key):
            fail(f"Invalid environment key on line {line_number}")
        if key in seen_keys:
            fail(f"Duplicate environment key on line {line_number}: {key}")
        seen_keys.add(key)
        assignment = f"{key}={parse_value(value)}".encode()
        sys.stdout.buffer.write(assignment + b"\0")


if __name__ == "__main__":
    main()
