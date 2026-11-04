"""Claim-audit result shared by the math guard and verifier plugins."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class ClaimVerdict:
    """Outcome of auditing a proposed answer.

    ``verifier`` names the component that produced the verdict (``math``,
    ``code``, ``knowledge``, or a third-party plugin). ``certificate_digest``
    is set only when a verified math certificate backs the answer.
    """

    verdict: str  # MATCH | MISMATCH | UNVERIFIABLE | UNCOMPARABLE
    verified_answer: Optional[str]
    detail: str
    certificate_digest: str = ""
    verifier: str = "math"
