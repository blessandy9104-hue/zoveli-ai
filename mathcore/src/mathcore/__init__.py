"""mathcore: a local, keyless subsystem that answers only with verified mathematics."""
from .capability import CapabilityError, capability_decision, parse_model_params, require_capability
from .command import Authorization, Command, authorize, parse
from .framework import ERROR, PARTIAL, REGISTRY, REJECTED, VERIFIED, Certificate
from .orchestrator import AuditLog, Blocked, ClaimVerdict, Coordinator, Orchestrator, OutputGuard, Report
from .safe_expr import ParseError
from .verifiers import ClaimVerifier, list_verifiers, register_verifier, unregister_verifier

__all__ = ["Authorization", "Command", "authorize", "parse", "REGISTRY", "Certificate", "VERIFIED", "PARTIAL",
           "REJECTED", "ERROR", "AuditLog", "Blocked", "CapabilityError", "capability_decision",
           "ClaimVerdict", "Coordinator", "Orchestrator", "OutputGuard", "Report", "ParseError",
           "parse_model_params", "require_capability", "ClaimVerifier", "register_verifier",
           "unregister_verifier", "list_verifiers"]
__version__ = "0.1.0"
