export type ContractorCandidate = {
  partnerOrganizationId: string;
  code: string;
  name: string;
  trades?: readonly string[];
};

export type IssueContext = {
  workNodeOwnerPartnerOrganizationId?: string | null;
  workNodeCode?: string;
  category?: string;
  tradeKeywords?: readonly string[];
};

/**
 * Suggests a contractor based on WBS ownership or category/trade matching.
 */
export function suggestContractor(
  candidates: readonly ContractorCandidate[],
  context: IssueContext,
): ContractorCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  // 1. Direct match with work node owner partner organization
  if (context.workNodeOwnerPartnerOrganizationId) {
    const directOwner = candidates.find(
      (c) => c.partnerOrganizationId === context.workNodeOwnerPartnerOrganizationId,
    );
    if (directOwner) {
      return directOwner;
    }
  }

  // 2. Match by category / trade keywords
  const keywords = [
    ...(context.category ? [context.category.toLowerCase()] : []),
    ...(context.tradeKeywords ? context.tradeKeywords.map((k) => k.toLowerCase()) : []),
  ];

  if (keywords.length > 0) {
    for (const candidate of candidates) {
      const candidateTokens = [
        candidate.code.toLowerCase(),
        candidate.name.toLowerCase(),
        ...(candidate.trades ?? []).map((t) => t.toLowerCase()),
      ];
      const matches = keywords.some((kw) => candidateTokens.some((token) => token.includes(kw)));
      if (matches) {
        return candidate;
      }
    }
  }

  // 3. Fallback to first active contractor
  return candidates[0];
}
