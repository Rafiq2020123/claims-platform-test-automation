"""A small client for the ClaimPay API.

It does two things the checks care about and plain `requests` doesn't: it keeps the correlation
ID from every response so a failure can be followed into the server log, and it turns a
connection problem into one exception type (`Unreachable`) so the command can tell "the checks
failed" apart from "the checks could not run".
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import requests


class Unreachable(Exception):
    """The app could not be reached at all. Not a failed check; the run cannot proceed."""


@dataclass(frozen=True)
class Response:
    status: int
    body: Any
    correlation_id: str | None

    def field(self, *path: str) -> Any:
        value = self.body
        for key in path:
            if not isinstance(value, dict):
                return None
            value = value.get(key)
        return value


class Api:
    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.calls: list[tuple[str, str, int, str | None]] = []

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ) -> Response:
        url = f"{self.base_url}/api{path}"
        sent = {"X-Correlation-Id": f"release-check-{uuid.uuid4()}"}
        if token:
            sent["Authorization"] = f"Bearer {token}"
        if headers:
            sent.update(headers)
        try:
            raw = self.session.request(method, url, json=json, headers=sent, timeout=self.timeout)
        except requests.RequestException as error:
            raise Unreachable(f"{method} {url}: {error}") from error
        try:
            body = raw.json() if raw.content else None
        except ValueError:
            body = raw.text
        correlation_id = raw.headers.get("x-correlation-id")
        self.calls.append((method, path, raw.status_code, correlation_id))
        return Response(raw.status_code, body, correlation_id)

    # The handful of calls the checks make, named so the checks read as the journey they are.

    def health(self) -> Response:
        return self.request("GET", "/health")

    def sign_in(self, email: str, password: str) -> Response:
        return self.request("POST", "/session", json={"email": email, "password": password})

    def procedure_codes(self) -> Response:
        return self.request("GET", "/procedure-codes")

    def enrol(self, token: str, email: str, password: str, plan: str) -> Response:
        return self.request(
            "POST",
            "/members",
            token=token,
            json={"email": email, "fullName": "Release Check", "planCode": plan, "password": password},
        )

    def submit_claim(self, token: str, code: str, service_date: str, billed_cents: int) -> Response:
        return self.request(
            "POST",
            "/claims",
            token=token,
            json={"procedureCode": code, "serviceDate": service_date, "billedCents": billed_cents},
        )

    def claim(self, token: str | None, claim_id: str) -> Response:
        return self.request("GET", f"/claims/{claim_id}", token=token)

    def decide(self, token: str, claim_id: str, body: dict[str, Any]) -> Response:
        return self.request("POST", f"/claims/{claim_id}/decision", token=token, json=body)

    def pay(self, token: str, claim_id: str, key: str) -> Response:
        return self.request("POST", f"/claims/{claim_id}/payment", token=token, headers={"Idempotency-Key": key})

    def payment(self, token: str, claim_id: str) -> Response:
        return self.request("GET", f"/claims/{claim_id}/payment", token=token)
