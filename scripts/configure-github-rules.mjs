import { execSync } from 'node:child_process';

/**
 * Script to configure standard GitHub repository rules, branch protection,
 * security alerts, and release tag safeguards via GitHub CLI (gh api).
 */
const REPO = 'DuongVinh2004/VinOps';

function runGh(command, inputJson = null) {
  const fullCmd = inputJson ? `gh api ${command} --input -` : `gh api ${command}`;
  return execSync(fullCmd, {
    input: inputJson ? JSON.stringify(inputJson) : undefined,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

console.log(`[VinOps] Configuring GitHub repository governance for ${REPO}...`);

// 1. Repository Core Settings
console.log(
  '1. Updating repository core settings (auto-merge, branch cleanup, squash formatting)...',
);
runGh(
  `-X PATCH repos/${REPO} -F delete_branch_on_merge=true -F allow_auto_merge=true -F squash_merge_commit_title=PR_TITLE -F squash_merge_commit_message=PR_BODY`,
);

// 2. Security Alerts & Automated Fixes
console.log('2. Enabling security vulnerability alerts & automated fixes...');
try {
  runGh(`-X PUT repos/${REPO}/vulnerability-alerts`);
  runGh(`-X PUT repos/${REPO}/automated-security-fixes`);
} catch (err) {
  console.warn('   Note: Vulnerability alerts or automated fixes setting reported:', err.message);
}

// 3. Branch Protection on 'main'
console.log('3. Applying branch protection on main...');
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

runGh(`-X PUT repos/${REPO}/branches/main/protection`, branchProtectionPayload);

// 4. Tag Protection Ruleset for 'v*' Releases
console.log('4. Ensuring release-tag-protection ruleset exists...');
const rulesets = JSON.parse(runGh(`repos/${REPO}/rulesets`));
const existingTagRuleset = rulesets.find((r) => r.name === 'release-tag-protection');

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
  runGh(`-X PUT repos/${REPO}/rulesets/${existingTagRuleset.id}`, tagRulesetPayload);
  console.log('   Updated existing release-tag-protection ruleset.');
} else {
  runGh(`-X POST repos/${REPO}/rulesets`, tagRulesetPayload);
  console.log('   Created new release-tag-protection ruleset.');
}

console.log('[VinOps] GitHub repository governance successfully configured!');
