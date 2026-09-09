import { execFileSync } from 'node:child_process';

/**
 * Script to configure standard GitHub repository rules, metadata, labels,
 * milestones, branch protection, and release tag safeguards via GitHub CLI (gh api).
 */
const targetRepo = process.argv[2] || process.env.GITHUB_REPOSITORY || 'DuongVinh2004/VinOps';

function callGitHubApi(endpointArgs, inputPayload = null) {
  const baseArgs = ['api', ...endpointArgs];
  if (inputPayload) {
    baseArgs.push('--input', '-');
  }
  const result = execFileSync('gh', baseArgs, {
    input: inputPayload ? JSON.stringify(inputPayload) : undefined,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return result;
}

console.log(`[VinOps] Configuring full GitHub repository governance for ${targetRepo}...`);

// 1. Repository Core Settings
console.log('1. Updating repository core settings & metadata...');
callGitHubApi([
  '-X',
  'PATCH',
  `repos/${targetRepo}`,
  '-F',
  'description=Enterprise Digital Engineering & Common Data Environment (CDE) Platform for Capital Infrastructure Projects',
  '-F',
  'homepage=https://github.com/DuongVinh2004/VinOps',
  '-F',
  'delete_branch_on_merge=true',
  '-F',
  'allow_auto_merge=true',
  '-F',
  'squash_merge_commit_title=PR_TITLE',
  '-F',
  'squash_merge_commit_message=PR_BODY',
  '-F',
  'has_wiki=false',
  '-F',
  'has_issues=true',
]);

// 2. Repository Topics
console.log('2. Updating repository topics...');
const standardTopics = [
  'bim',
  'cde',
  'openbim',
  'ifc',
  'bcf',
  'digital-twin',
  'construction-tech',
  'pades-lta',
  'pki',
  'gis',
  'drone-survey',
  'nestjs',
  'react19',
  'typescript',
  'postgresql',
  'infrastructure',
  'smart-city',
  'vietnam',
];
callGitHubApi(['-X', 'PUT', `repos/${targetRepo}/topics`], { names: standardTopics });

// 3. Standardized Labels
console.log('3. Synchronizing standardized GitHub labels...');
const standardizedLabels = [
  // Types
  { name: 'type: bug', color: 'd73a4a', description: "Something isn't working as expected" },
  {
    name: 'type: feature',
    color: '0e8a16',
    description: 'New capability, feature request, or public API',
  },
  {
    name: 'type: docs',
    color: '0075ca',
    description: 'Improvements or additions to documentation or ADRs',
  },
  {
    name: 'type: perf',
    color: 'd4c5f9',
    description: 'Performance improvement or memory optimization',
  },
  {
    name: 'type: refactor',
    color: 'fbca04',
    description: 'Code refactoring or architectural boundary cleanup',
  },
  {
    name: 'type: security',
    color: 'b60205',
    description: 'Security vulnerability, RLS audit, or dependency alert',
  },
  {
    name: 'type: test',
    color: 'bfdadc',
    description: 'Test suite expansion, fault injection, or UAT fixtures',
  },
  {
    name: 'type: chore',
    color: 'c5def5',
    description: 'Toolchain, CI/CD, lockfile, or repository maintenance',
  },

  // Areas
  {
    name: 'area: bim-3d',
    color: '1d76db',
    description: 'openBIM IFC 4.3 parser, glTF streaming, 3D viewer',
  },
  {
    name: 'area: ai-vision',
    color: '5319e7',
    description: 'AI defect detection, NMS bounding boxes, RAG copilot',
  },
  {
    name: 'area: pki-signing',
    color: '0052cc',
    description: 'NĐ 207 acceptance signing, CSC Cloud HSM, PAdES-LTA',
  },
  {
    name: 'area: gis-drone',
    color: '0e8a16',
    description: 'Drone orthophoto ingestion, VN-2000 geodetic projection',
  },
  {
    name: 'area: api-gateway',
    color: 'e99695',
    description: 'NestJS HTTP API, WebSocket rooms, auth & rate limiting',
  },
  {
    name: 'area: web-client',
    color: '61dafb',
    description: 'React 19 SPA, Tailwind UI, MapLibre, Three.js canvas',
  },
  {
    name: 'area: worker-fleet',
    color: 'bfdadc',
    description: 'Background outbox workers, queue processing, ClamAV',
  },
  {
    name: 'area: database-rls',
    color: '336791',
    description: 'PostgreSQL 17 schema, migrations, RLS tenant isolation',
  },

  // Priorities
  {
    name: 'priority: critical',
    color: 'b60205',
    description: 'Blocks releases, production outage, or severe security flaw',
  },
  {
    name: 'priority: high',
    color: 'd93f0b',
    description: 'High impact on milestone or major architectural deliverable',
  },
  {
    name: 'priority: medium',
    color: 'fbca04',
    description: 'Normal priority for upcoming sprint or milestone',
  },
  { name: 'priority: low', color: '0e8a16', description: 'Low priority backlog or cosmetic issue' },

  // Status
  {
    name: 'status: in-progress',
    color: 'c2e0c6',
    description: 'Actively being worked on by an assigned contributor',
  },
  {
    name: 'status: review-needed',
    color: 'fef2c0',
    description: 'Awaiting architectural or peer review',
  },
  {
    name: 'status: blocked',
    color: 'e11d21',
    description: 'Blocked by external dependency or upstream issue',
  },

  // Community & CI
  {
    name: 'good first issue',
    color: '7057ff',
    description: 'Ideal starting issue for newcomers to the project',
  },
  {
    name: 'help wanted',
    color: '008672',
    description: 'Extra community attention or domain expertise requested',
  },
  {
    name: 'question',
    color: 'd876e3',
    description: 'General question, architectural RFC, or discussion',
  },
  {
    name: 'triage',
    color: 'ededed',
    description: 'Awaiting triage and prioritization',
  },
  {
    name: 'dependencies',
    color: '0366d6',
    description: 'Pull requests that update a dependency file',
  },
  {
    name: 'ci',
    color: '168700',
    description: 'Continuous integration workflows and scripts',
  },
  {
    name: 'javascript',
    color: '168700',
    description: 'JavaScript & TypeScript ecosystem updates',
  },
];

const existingLabelsRaw = callGitHubApi([`repos/${targetRepo}/labels`, '--paginate']);
const existingLabels = JSON.parse(existingLabelsRaw || '[]');
const existingLabelNames = new Set(existingLabels.map((label) => label.name));

for (const targetLabel of standardizedLabels) {
  if (existingLabelNames.has(targetLabel.name)) {
    callGitHubApi(
      ['-X', 'PATCH', `repos/${targetRepo}/labels/${encodeURIComponent(targetLabel.name)}`],
      {
        new_name: targetLabel.name,
        color: targetLabel.color,
        description: targetLabel.description,
      },
    );
  } else {
    callGitHubApi(['-X', 'POST', `repos/${targetRepo}/labels`], {
      name: targetLabel.name,
      color: targetLabel.color,
      description: targetLabel.description,
    });
  }
}
console.log(`   Synchronized ${standardizedLabels.length} standardized labels.`);

// 4. Milestones
console.log('4. Configuring project milestones...');
const existingMilestonesRaw = callGitHubApi([
  `repos/${targetRepo}/milestones?state=all`,
  '--paginate',
]);
const existingMilestones = JSON.parse(existingMilestonesRaw || '[]');

const targetMilestones = [
  {
    title: 'v1.0.0 - Production Baseline',
    state: 'closed',
    description:
      'Initial production baseline release: openBIM IFC 4.3, Legal PKI Remote Signing (NĐ 207/2026), AI Site Vision, GIS Drone Orthophoto, and zero-trust PostgreSQL 17 RLS.',
  },
  {
    title: 'v1.1.0 - Extended CA Ecosystem & Advanced Site Analytics',
    state: 'open',
    description:
      'Expanded CA ecosystem integration (Viettel Cloud CA, TrustCA), 4D BIM construction scheduling linkage, and multi-spectral drone analysis.',
    due_on: '2026-12-31T23:59:59Z',
  },
  {
    title: 'v2.0.0 - Smart City Digital Twin & Autonomous Drone Ingestion',
    state: 'open',
    description:
      'CityGML 3.0 integration, autonomous UAV flight plan dispatch, and distributed Edge CDE nodes.',
    due_on: '2027-06-30T23:59:59Z',
  },
];

for (const targetMilestone of targetMilestones) {
  const existingMilestone = existingMilestones.find(
    (milestone) => milestone.title === targetMilestone.title,
  );
  if (existingMilestone) {
    callGitHubApi(
      ['-X', 'PATCH', `repos/${targetRepo}/milestones/${existingMilestone.number}`],
      targetMilestone,
    );
    console.log(`   Updated milestone: ${targetMilestone.title}`);
  } else {
    callGitHubApi(['-X', 'POST', `repos/${targetRepo}/milestones`], targetMilestone);
    console.log(`   Created milestone: ${targetMilestone.title}`);
  }
}

// 5. Branch Protection on 'main'
console.log('5. Applying branch protection on main...');
const branchProtectionPayload = {
  required_status_checks: {
    strict: true,
    contexts: ['Foundation gates (Linux)', 'Portability checks (Windows)'],
  },
  enforce_admins: false,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 0,
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: true,
};

callGitHubApi(
  ['-X', 'PUT', `repos/${targetRepo}/branches/main/protection`],
  branchProtectionPayload,
);

// 6. Tag Protection Ruleset for 'v*' Releases
console.log('6. Ensuring release-tag-protection ruleset exists...');
const rulesetsRaw = callGitHubApi([`repos/${targetRepo}/rulesets`, '--paginate']);
const rulesets = JSON.parse(rulesetsRaw || '[]');
const existingTagRuleset = rulesets.find((ruleset) => ruleset.name === 'release-tag-protection');

const tagRulesetPayload = {
  name: 'release-tag-protection',
  target: 'tag',
  enforcement: 'active',
  conditions: {
    ref_name: {
      include: ['refs/tags/v*'],
      exclude: [],
    },
  },
  rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
};

if (existingTagRuleset) {
  callGitHubApi(
    ['-X', 'PUT', `repos/${targetRepo}/rulesets/${existingTagRuleset.id}`],
    tagRulesetPayload,
  );
  console.log('   Updated existing release-tag-protection ruleset.');
} else {
  callGitHubApi(['-X', 'POST', `repos/${targetRepo}/rulesets`], tagRulesetPayload);
  console.log('   Created new release-tag-protection ruleset.');
}

console.log('[VinOps] Full GitHub repository governance successfully configured!');
