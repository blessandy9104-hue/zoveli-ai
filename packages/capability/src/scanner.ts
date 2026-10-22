import {
  Capability,
  CapabilityCategory,
  CapabilityHealth,
  CapabilityScanOptions,
  CapabilityStatus,
} from './types';

interface CapabilityDefinition {
  name: string;
  displayName: string;
  description: string;
  category: CapabilityCategory;
  subcategory: string;
  priority: Capability['priority'];
  tools?: string[];
  prefixes?: string[];
  requiresHost?: boolean;
  provides: string[];
  dependencies?: string[];
  tags: string[];
}

const CAPABILITIES: CapabilityDefinition[] = [
  {
    name: 'mathcore.verified-compute',
    displayName: 'Verified Mathematical Computation',
    description: 'Verified math through the mounted mathcore and math-domain tools',
    category: 'computation',
    subcategory: 'verified-math',
    priority: 'critical',
    tools: ['mathcore_compute', 'mathcore_check_answer', 'mathcore_status'],
    prefixes: ['math_'],
    provides: [
      'evaluate',
      'solve',
      'derivative',
      'integrate',
      'linear-algebra',
      'statistics',
      'number-theory',
      'logic',
      'units',
    ],
    tags: ['verified', 'offline', 'auditable'],
  },
  {
    name: 'memory.vault',
    displayName: 'Local Memory Vault',
    description: 'Persistent local markdown notes with search, tags and wiki-links',
    category: 'memory',
    subcategory: 'knowledge-base',
    priority: 'critical',
    tools: [
      'memory_create_note',
      'memory_read_note',
      'memory_update_note',
      'memory_delete_note',
      'memory_search',
      'memory_list_tags',
      'vault_search',
    ],
    provides: ['create-note', 'search', 'read', 'list-tags', 'wiki-links', 'frontmatter'],
    tags: ['local-first', 'markdown', 'portable'],
  },
  {
    name: 'memory.graph',
    displayName: 'Knowledge Graph',
    description: 'Vault wiki-link graph with orphans, hubs and DOT export',
    category: 'memory',
    subcategory: 'graph',
    priority: 'medium',
    tools: ['vault_graph'],
    provides: ['vault-graph', 'orphans', 'hubs', 'dot-export'],
    dependencies: ['memory.vault'],
    tags: ['graph', 'wiki-links'],
  },
  {
    name: 'languages.polyglot',
    displayName: 'Programming Languages',
    description: 'Language detection, analysis, formatting, linting, tests and tooling guidance',
    category: 'tools',
    subcategory: 'languages',
    priority: 'high',
    prefixes: ['language_'],
    provides: [
      'language-detect',
      'code-analyze',
      'code-format',
      'code-lint',
      'run-tests',
      'tooling-guide',
    ],
    tags: ['polyglot', 'ast', 'format', 'lint', 'test'],
  },
  {
    name: 'code.review',
    displayName: 'Code Review',
    description: 'Complexity hotspots, duplication, dead code and secret detection',
    category: 'tools',
    subcategory: 'code-analysis',
    priority: 'medium',
    tools: ['code_review'],
    provides: ['code-review', 'hotspots', 'duplication', 'dead-code'],
    tags: ['review', 'quality'],
  },
  {
    name: 'docs.generate',
    displayName: 'Documentation Generator',
    description: 'Offline Markdown API docs generated from source exports',
    category: 'tools',
    subcategory: 'docgen',
    priority: 'low',
    tools: ['docs_generate'],
    provides: ['docs-generate'],
    tags: ['docs', 'offline'],
  },
  {
    name: 'project.health',
    displayName: 'Project Health Monitor',
    description: 'Scores projects on tests, CI, docs, dependencies and TODO debt',
    category: 'reasoning',
    subcategory: 'health',
    priority: 'medium',
    tools: ['project_health'],
    provides: ['project-health', 'health-score'],
    tags: ['health', 'score'],
  },
  {
    name: 'tasks.smart-schedule',
    displayName: 'Smart Task Scheduler',
    description: 'Energy-aware prioritisation with deep-work, quick-win and low-energy blocks',
    category: 'workflows',
    subcategory: 'scheduler',
    priority: 'medium',
    tools: ['tasks_schedule'],
    provides: ['task-scheduling', 'time-blocking'],
    tags: ['scheduling', 'energy'],
  },
  {
    name: 'security.scan',
    displayName: 'Security Scanner',
    description: 'Secret and risky-pattern scanning for repository files',
    category: 'system',
    subcategory: 'secscan',
    priority: 'high',
    tools: ['security_scan'],
    provides: ['security-scan', 'secret-detection'],
    tags: ['security', 'secrets'],
  },
  {
    name: 'system.hardware',
    displayName: 'System & Hardware Awareness',
    description: 'Local OS, CPU, memory, disk, GPU, battery and network insight',
    category: 'system',
    subcategory: 'sysinfo',
    priority: 'high',
    prefixes: ['sysinfo_'],
    provides: [
      'sysinfo-snapshot',
      'cpu',
      'memory',
      'disk',
      'gpu',
      'battery',
      'network',
      'budget-check',
    ],
    tags: ['hardware', 'local-only', 'no-network'],
  },
  {
    name: 'web.research',
    displayName: 'Web Research',
    description: 'SSRF-guarded page fetching and keyless search when network access is available',
    category: 'tools',
    subcategory: 'web',
    priority: 'medium',
    tools: ['web_search', 'web_fetch'],
    provides: ['web-search', 'web-fetch', 'source-citation'],
    tags: ['network', 'research', 'ssrf-guarded'],
  },
  {
    name: 'persona.switching',
    displayName: 'Persona Switching',
    description: 'Switch the active response style between friend, tutor, engineer and coach',
    category: 'communication',
    subcategory: 'persona',
    priority: 'low',
    tools: ['persona_switch', 'persona_current'],
    provides: ['persona-switch', 'persona-current'],
    tags: ['style', 'persona'],
  },
  {
    name: 'capability.introspection',
    displayName: 'Capability Introspection',
    description: 'Inspect, adapt to and report the tools actually mounted in this host',
    category: 'reasoning',
    subcategory: 'introspection',
    priority: 'medium',
    prefixes: ['capability_'],
    provides: ['capability-scan', 'capability-check', 'capability-report'],
    tags: ['inventory', 'introspection'],
  },
  {
    name: 'diagnostics.health',
    displayName: 'Runtime Diagnostics',
    description: 'Health rollup for the runtime, configuration, vault and tool registry',
    category: 'system',
    subcategory: 'diagnostics',
    priority: 'medium',
    tools: ['health_report'],
    provides: ['health-report', 'diagnostics'],
    tags: ['health', 'diagnostics'],
  },
  {
    name: 'agent.loop',
    displayName: 'Agent Loop',
    description: 'The host tool-dispatch and multi-turn loop',
    category: 'agents',
    subcategory: 'core',
    priority: 'critical',
    requiresHost: true,
    provides: ['tool-use', 'multi-turn'],
    tags: ['core'],
  },
  {
    name: 'guard.policy',
    displayName: 'Shell Guard Policy',
    description: 'Destructive-command policy for an optional shell_exec tool (not mounted by default)',
    category: 'system',
    subcategory: 'guard',
    priority: 'low',
    tools: ['guard_set_policy'],
    provides: ['shell-policy'],
    tags: ['security', 'shell', 'opt-in'],
  },
];

export class CapabilityScanner {
  private ctx: any;
  private cache: Map<string, Capability> = new Map();
  private lastScan: Date | null = null;
  private scanPromise: Promise<Capability[]> | null = null;

  constructor(ctx: any) {
    this.ctx = ctx;
  }

  async scanAll(options: CapabilityScanOptions = {}): Promise<Capability[]> {
    if (this.scanPromise && !options.forceRefresh) {
      return this.scanPromise;
    }

    const pending = this.performScan();
    this.scanPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.scanPromise === pending) this.scanPromise = null;
    }
  }

  scanSync(): Capability[] {
    const capabilities = this.scanMountedTools();
    this.updateCache(capabilities);
    this.lastScan = new Date();
    return capabilities;
  }

  async quickScan(): Promise<Capability[]> {
    return this.scanAll({ deep: false });
  }

  async deepScan(): Promise<Capability[]> {
    return this.scanAll({ deep: true });
  }

  async incrementalScan(): Promise<Capability[]> {
    const now = new Date();
    if (this.lastScan && now.getTime() - this.lastScan.getTime() < 60000) {
      return Array.from(this.cache.values());
    }
    return this.scanAll({ forceRefresh: true });
  }

  private async performScan(): Promise<Capability[]> {
    const capabilities = this.scanMountedTools();
    this.updateCache(capabilities);
    this.lastScan = new Date();
    return capabilities;
  }

  private scanMountedTools(): Capability[] {
    const toolNames = this.mountedToolNames();
    if (!toolNames) return [];

    const capabilities: Capability[] = [];
    for (const def of CAPABILITIES) {
      const matched = [
        ...(def.tools ?? []).filter((name) => toolNames.has(name)),
        ...(def.prefixes ?? []).flatMap((prefix) =>
          [...toolNames].filter((name) => name.startsWith(prefix))
        ),
      ];
      if (matched.length === 0 && !def.requiresHost) continue;
      capabilities.push(this.toCapability(def, matched));
    }
    return capabilities;
  }

  private mountedToolNames(): Set<string> | null {
    let inventory: any;
    try {
      inventory = this.ctx.get?.('tool-inventory');
    } catch {
      return null;
    }
    const list = inventory?.list?.();
    if (!Array.isArray(list)) return null;
    const names = list
      .map((item) => (typeof item === 'string' ? item : item?.name))
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    return new Set(names);
  }

  private toCapability(def: CapabilityDefinition, tools: string[]): Capability {
    return {
      name: def.name,
      displayName: def.displayName,
      description: def.description,
      category: def.category,
      subcategory: def.subcategory,
      version: '1.0.0',
      status: 'available',
      priority: def.priority,
      dependencies: def.dependencies ?? [],
      conflicts: [],
      provides: def.provides,
      requires: tools.map((name) => ({
        type: 'capability' as const,
        name,
        optional: false,
        description: `Mounted tool: ${name}`,
      })),
      metadata: {
        source: 'plugin',
        tags: [...def.tags, ...tools],
        maturity: 'stable',
      },
      health: this.createHealth('available'),
      discoveredAt: new Date(),
      lastVerified: new Date(),
    };
  }

  private createHealth(status: CapabilityStatus): CapabilityHealth {
    return {
      lastCheck: new Date(),
      successRate: status === 'available' ? 1.0 : 0,
      avgLatency: 0,
      errorCount: 0,
      warningCount: 0,
    };
  }

  private updateCache(capabilities: Capability[]): void {
    this.cache.clear();
    for (const cap of capabilities) {
      this.cache.set(cap.name, cap);
    }
  }

  getCachedCapabilities(): Capability[] {
    return Array.from(this.cache.values());
  }
}
