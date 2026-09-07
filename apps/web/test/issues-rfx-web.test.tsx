// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssueKanban } from '../src/issues/issue-kanban.js';
import { RfiHub } from '../src/rfx/rfi-hub.js';
import { SubmittalDashboard } from '../src/rfx/submittal-dashboard.js';
import type { FieldIssue, RfiRequest, Submittal, VinopsApiClient } from '../src/api.js';

afterEach(cleanup);

const emptyClient = {} as unknown as VinopsApiClient;

describe('IssueKanban UI', () => {
  const mockIssues: readonly FieldIssue[] = [
    {
      id: 'iss-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      issueNumber: 'ISS-001',
      title: 'Cracked concrete slab',
      description: 'Discovered hairline cracks near grid line 4',
      status: 'Open',
      severity: 'High',
      gpsLat: 21.0285,
      gpsLng: 105.8542,
      version: '1',
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
    },
    {
      id: 'iss-2',
      organizationId: 'org-1',
      projectId: 'proj-1',
      issueNumber: 'ISS-002',
      title: 'Missing rebar ties',
      description: 'Section 2 needs tie wires',
      status: 'In Progress',
      severity: 'Medium',
      rfiId: 'rfi-99',
      version: '1',
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
    },
  ];

  it('renders kanban board with issues in correct columns', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <IssueKanban
        projectId="proj-1"
        client={emptyClient}
        issues={mockIssues}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId('issues-kanban')).toBeTruthy();
    expect(screen.getByTestId('col-Open')).toBeTruthy();
    expect(screen.getByTestId('col-In Progress')).toBeTruthy();
    expect(screen.getByTestId('issue-ISS-001')).toBeTruthy();
    expect(screen.getByTestId('issue-ISS-002')).toBeTruthy();
    expect(screen.getByText('Cracked concrete slab')).toBeTruthy();
    expect(screen.getByText('GPS: 21.0285, 105.8542')).toBeTruthy();
    expect(screen.getByText('Linked RFI')).toBeTruthy();
  });

  it('filters issues by severity', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <IssueKanban
        projectId="proj-1"
        client={emptyClient}
        issues={mockIssues}
        onRefresh={onRefresh}
      />,
    );

    const filter = screen.getByTestId('severity-filter');
    fireEvent.change(filter, { target: { value: 'High' } });

    expect(screen.getByTestId('issue-ISS-001')).toBeTruthy();
    expect(screen.queryByTestId('issue-ISS-002')).toBeNull();
  });

  it('opens quick create modal and submits new issue', () => {
    const quickCreateIssue = vi.fn().mockResolvedValue({
      id: 'iss-new',
      issueNumber: 'ISS-003',
      title: 'New Defect',
      severity: 'Critical',
    });
    const mockClient = { quickCreateIssue } as unknown as VinopsApiClient;
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <IssueKanban
        projectId="proj-1"
        client={mockClient}
        issues={mockIssues}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTestId('quick-create-btn'));
    expect(screen.getByTestId('quick-create-modal')).toBeTruthy();

    fireEvent.change(screen.getByTestId('input-title'), { target: { value: 'New Defect' } });
    fireEvent.change(screen.getByTestId('input-description'), {
      target: { value: 'Spalling at basement wall' },
    });
    fireEvent.change(screen.getByTestId('input-severity'), { target: { value: 'Critical' } });
    fireEvent.change(screen.getByTestId('input-lat'), { target: { value: '21.0300' } });
    fireEvent.change(screen.getByTestId('input-lng'), { target: { value: '105.8500' } });

    fireEvent.click(screen.getByTestId('submit-issue-btn'));

    expect(quickCreateIssue).toHaveBeenCalledWith('proj-1', {
      title: 'New Defect',
      description: 'Spalling at basement wall',
      severity: 'Critical',
      gps_lat: 21.03,
      gps_lng: 105.85,
    });
  });

  it('opens escalate modal and triggers escalateIssueToRfi', () => {
    const escalateIssueToRfi = vi.fn().mockResolvedValue({
      id: 'rfi-new',
      rfiNumber: 'RFI-101',
    });
    const mockClient = { escalateIssueToRfi } as unknown as VinopsApiClient;
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <IssueKanban
        projectId="proj-1"
        client={mockClient}
        issues={mockIssues}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTestId('escalate-btn-ISS-001'));
    expect(screen.getByTestId('escalate-modal')).toBeTruthy();

    fireEvent.click(screen.getByTestId('confirm-escalate-btn'));

    expect(escalateIssueToRfi).toHaveBeenCalledWith(
      'proj-1',
      'iss-1',
      expect.objectContaining({
        title: '[Escalated] Cracked concrete slab',
        priority: 'High',
      }),
    );
  });
});

describe('RfiHub UI', () => {
  const mockRfis: readonly RfiRequest[] = [
    {
      id: 'rfi-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      rfiNumber: 'RFI-001',
      title: 'Discrepancy in beam elevation',
      question: 'Drawing S-01 shows +4.5m but A-02 shows +4.2m',
      status: 'Under Review',
      priority: 'High',
      ballInCourtOrganizationId: 'org-consultant',
      dueDate: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
      version: '1',
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
    },
  ];

  it('renders RFI table and warning SLA badge', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <RfiHub projectId="proj-1" client={emptyClient} rfis={mockRfis} onRefresh={onRefresh} />,
    );

    expect(screen.getByTestId('rfi-hub')).toBeTruthy();
    expect(screen.getByTestId('rfi-row-RFI-001')).toBeTruthy();
    expect(screen.getByText('Discrepancy in beam elevation')).toBeTruthy();
    expect(screen.getByTestId('sla-warning')).toBeTruthy();
    expect(screen.getByTestId('bic-badge')).toBeTruthy();
  });

  it('submits official response modal', () => {
    const addRfiResponse = vi.fn().mockResolvedValue({ id: 'resp-1' });
    const mockClient = { addRfiResponse } as unknown as VinopsApiClient;
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<RfiHub projectId="proj-1" client={mockClient} rfis={mockRfis} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByTestId('btn-answer-RFI-001'));
    expect(screen.getByTestId('rfi-response-modal')).toBeTruthy();

    fireEvent.change(screen.getByTestId('response-text-input'), {
      target: { value: 'Follow elevation +4.5m per structural engineering revision' },
    });
    fireEvent.click(screen.getByTestId('cost-impact-checkbox'));
    fireEvent.click(screen.getByTestId('submit-response-btn'));

    expect(addRfiResponse).toHaveBeenCalledWith('proj-1', 'rfi-1', {
      response_text: 'Follow elevation +4.5m per structural engineering revision',
      is_official: true,
      cost_impact: true,
      schedule_impact: false,
    });
  });
});

describe('SubmittalDashboard UI', () => {
  const mockSubmittals: readonly Submittal[] = [
    {
      id: 'sub-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      submittalNumber: 'SUB-001',
      title: 'Waterproofing membrane sample',
      submittalType: 'Material Sample',
      status: 'Under Review',
      makerPartnerOrganizationId: 'org-maker',
      version: '1',
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
    },
  ];

  it('renders submittals table and review buttons', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <SubmittalDashboard
        projectId="proj-1"
        client={emptyClient}
        submittals={mockSubmittals}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId('submittal-dashboard')).toBeTruthy();
    expect(screen.getByTestId('submittal-row-SUB-001')).toBeTruthy();
    expect(screen.getByTestId('btn-review-SUB-001')).toBeTruthy();
  });

  it('submits Maker-Checker review decision Code A', () => {
    const reviewSubmittal = vi.fn().mockResolvedValue({ id: 'rev-1' });
    const mockClient = { reviewSubmittal } as unknown as VinopsApiClient;
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <SubmittalDashboard
        projectId="proj-1"
        client={mockClient}
        submittals={mockSubmittals}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTestId('btn-review-SUB-001'));
    expect(screen.getByTestId('review-submittal-modal')).toBeTruthy();

    fireEvent.change(screen.getByTestId('decision-code-select'), { target: { value: 'A' } });
    fireEvent.change(screen.getByTestId('review-comments-input'), {
      target: { value: 'Complies with project technical specification 07100' },
    });
    fireEvent.click(screen.getByTestId('confirm-review-btn'));

    expect(reviewSubmittal).toHaveBeenCalledWith('proj-1', 'sub-1', {
      decision_code: 'A',
      review_comments: 'Complies with project technical specification 07100',
    });
  });
});
