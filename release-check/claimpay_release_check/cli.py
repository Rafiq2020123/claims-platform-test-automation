"""`claimpay-release-check`: run the release checks against a running ClaimPay.

Exit codes: 0 every check passed, 1 at least one failed, 2 the checks could not run (app
unreachable, rules file not found). A pipeline should treat 1 and 2 differently: 1 means the
build is bad, 2 means the check itself needs looking at.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg

from . import checks, reconcile, report
from .api import Api, Unreachable
from .rules import find_rules_file, load_rules


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="claimpay-release-check",
        description="Release checks for a running ClaimPay: health, seeded accounts, one paid "
        "claim per rounding-sensitive worked example, idempotent payments, access rules. With a "
        "database URL, also reconciles every stored claim and payment against the written rules.",
    )
    p.add_argument("--base-url", default="http://127.0.0.1:3000", help="where the app is (default: %(default)s)")
    p.add_argument(
        "--rules",
        type=Path,
        help="path to docs/business-rules.md (default: found by walking up from the current folder)",
    )
    p.add_argument("--timeout", type=float, default=10.0, help="seconds per request (default: %(default)s)")
    p.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres URL for the reconciliation checks (default: $DATABASE_URL; omit to skip them)",
    )
    p.add_argument("--no-api", action="store_true", help="skip the API checks and only reconcile the database")
    p.add_argument("--json", type=Path, metavar="FILE", help="also write the results as JSON to FILE")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    rules_path = args.rules or find_rules_file(Path.cwd())
    if rules_path is None or not rules_path.is_file():
        print("could not find docs/business-rules.md; pass --rules", file=sys.stderr)
        return report.EXIT_COULD_NOT_RUN
    try:
        plans, examples = load_rules(rules_path)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return report.EXIT_COULD_NOT_RUN

    if args.no_api and not args.database_url:
        print("--no-api needs a database URL, or there is nothing to check", file=sys.stderr)
        return report.EXIT_COULD_NOT_RUN

    results: list[checks.CheckResult] = []
    if not args.no_api:
        ctx = checks.Context(api=Api(args.base_url, timeout=args.timeout), plans=plans, examples=examples)
        try:
            results += checks.run(ctx)
        except Unreachable as error:
            print(f"could not reach the app: {error}", file=sys.stderr)
            return report.EXIT_COULD_NOT_RUN

    if args.database_url:
        try:
            results += reconcile.reconcile(args.database_url, plans)
        except psycopg.OperationalError as error:
            print(f"could not reach the database: {error}".strip(), file=sys.stderr)
            return report.EXIT_COULD_NOT_RUN

    print(report.text(results, args.base_url))
    if args.json:
        args.json.write_text(report.as_json(results, args.base_url), encoding="utf-8")
        print(f"\nJSON written to {args.json}")
    return report.exit_code(results)


if __name__ == "__main__":
    sys.exit(main())
