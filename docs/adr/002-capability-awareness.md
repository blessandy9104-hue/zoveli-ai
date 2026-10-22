# ADR 002: Capability Awareness System

## Status
Accepted

## Context
Zoveli has many packages providing diverse capabilities (math, memory, languages, etc.). The agent needs to:
- Know what capabilities are available at runtime
- Adapt task execution based on available capabilities
- Detect degraded/unavailable capabilities
- Provide introspection for users and debugging
- Enable graceful degradation

## Decision
Implement a **Capability Awareness System** with three components:

### 1. CapabilityScanner
Discovers capabilities from one source of truth:
- **Live tool inventory**: capability groups are reported only when their backing
  tools are actually mounted in the host
- **Host loop**: the agent loop is reported only when the host inventory exists
- **No speculative sources**: the scanner does not probe binaries, MCP servers or
  virtual LLM abilities, and never hardcodes an available tool that is absent

### 2. CapabilityRegistry
Maintains registered capabilities with:
- Status tracking (available/degraded/unavailable)
- Health metrics (success rate, latency, errors)
- Dependency resolution
- Filtering by category, status, priority

### 3. CapabilityAdaptation
Adapts task execution:
- Maps task types to required capabilities
- Selects optimal capability combination
- Handles fallbacks when preferred unavailable
- Generates recommendations and gap analysis

## Capability Model

```typescript
interface Capability {
  name: string;
  displayName: string;
  description: string;
  category: CapabilityCategory;
  version: string;
  status: CapabilityStatus;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'optional';
  dependencies: string[];
  provides: string[];
  requires: CapabilityRequirement[];
  health: CapabilityHealth;
}
```

## Integration Points

### Agent Injection
On `agent/created`, inject capability summary.

### Tools
- `capability_scan` - Discover all capabilities
- `capability_check` - Check specific capability
- `capability_list` - List with filters
- `capability_adapt` - Get adaptation for task
- `capability_report` - Generate awareness report

### Periodic Scanning
- Refresh on `turn/start` while auto-scan is enabled
- Full refresh on `capability_scan` or when `capability_check` misses
- Scans are cheap because they read the mounted tool registry

## Consequences

### Positive
- Self-Awareness: Agent knows its own limits
- Graceful Degradation: Falls back when capabilities unavailable
- User Transparency: Users can query capabilities
- Debugging: Clear picture of system state
- Optimization: Selects best capability for task

### Negative
- Overhead: Scanning adds latency (mitigated by caching)
- Complexity: Additional system to maintain
- Tool presence is not a health check: a mounted tool can still fail at runtime

## Implementation
Located in `packages/capability/`
