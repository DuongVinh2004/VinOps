// @vitest-environment jsdom

import type { WebConfig } from '@vinops/config';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app.js';
import { VinopsApiClient } from '../src/api.js';
import { readPublicConfig } from '../src/config.js';
import { ErrorBoundary } from '../src/error-boundary.js';

const config: WebConfig = {
  VITE_API_BASE_URL: 'http://127.0.0.1:3000/api/v1',
  VITE_APP_ENV: 'test',
};

const session = {
  access_token: 'test-access-token',
  access_token_expires_at: '2099-01-01T00:00:00.000Z',
  csrf_token: 'test-csrf-token',
  session_id: 'session-1',
  user: { id: 'user-1', display_name: 'Project Administrator' },
};

const organizations = [
  {
    id: 'organization-1',
    code: 'BUILD',
    name: 'Builder Organization',
    status: 'Active',
    version: '1',
  },
  {
    id: 'organization-2',
    code: 'OWNER',
    name: 'Owner Organization',
    status: 'Active',
    version: '1',
  },
];

const projects = {
  'organization-1': [
    {
      id: 'project-active',
      organization_id: 'organization-1',
      code: 'RIV-001',
      name: 'Riverside Office',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'Active',
      version: '2',
    },
    {
      id: 'project-suspended',
      organization_id: 'organization-1',
      code: 'COM-014',
      name: 'Commissioning Review',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'Suspended',
      version: '3',
    },
    {
      id: 'project-archived',
      organization_id: 'organization-1',
      code: 'LEG-003',
      name: 'Legacy Handover',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'Archived',
      version: '4',
    },
  ],
  'organization-2': [
    {
      id: 'project-airport',
      organization_id: 'organization-2',
      code: 'AIR-021',
      name: 'Airport Fit-out',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'Active',
      version: '5',
    },
  ],
} as const;

type RecordedRequest = {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
};

type ApiMock = {
  calls: RecordedRequest[];
};

type OptionalBrowserStorage = Partial<Pick<Window, 'localStorage' | 'sessionStorage'>>;

function browserStorage(): OptionalBrowserStorage {
  return window;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') {
    throw new Error('Expected the web client to send a JSON string body.');
  }
  return JSON.parse(body) as unknown;
}

function pathname(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return new URL(input).pathname;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url).pathname;
}

function projectFor(id: string): (typeof projects)[keyof typeof projects][number] {
  for (const items of Object.values(projects)) {
    const project = items.find((item) => item.id === id);
    if (project !== undefined) {
      return project;
    }
  }
  throw new Error(`Unknown test project ${id}`);
}

function installApiMock(): ApiMock {
  const calls: RecordedRequest[] = [];
  const fetchMock = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    const path = pathname(input);
    if (path === '/api/v1/auth/sessions' && init?.method === 'POST') {
      return Promise.resolve(json(session));
    }
    if (path === '/api/v1/auth/sessions' && init?.method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (path === '/api/v1/organizations') {
      return Promise.resolve(
        json({ items: organizations, page: { next_cursor: null, has_more: false } }),
      );
    }
    const projectListMatch = path.match(/^\/api\/v1\/organizations\/([^/]+)\/projects$/u);
    if (projectListMatch !== null) {
      const organizationId = decodeURIComponent(projectListMatch[1] ?? '');
      return Promise.resolve(
        json({
          items: projects[organizationId as keyof typeof projects] ?? [],
          page: { next_cursor: null, has_more: false },
        }),
      );
    }
    const projectMatch = path.match(/^\/api\/v1\/projects\/([^/]+)$/u);
    if (projectMatch !== null) {
      return Promise.resolve(json(projectFor(decodeURIComponent(projectMatch[1] ?? ''))));
    }
    const membersMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/members$/u);
    if (membersMatch !== null) {
      return Promise.resolve(
        json({
          items: [
            {
              id: 'membership-1',
              user_id: 'user-1',
              display_name: 'Project Administrator',
              roles: ['project_admin'],
              status: 'Active',
              version: '1',
            },
          ],
          page: { next_cursor: null, has_more: false },
        }),
      );
    }
    const contextMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/context$/u);
    if (contextMatch !== null) {
      return Promise.resolve(
        json({
          calendars: [{ id: 'calendar-1', name: 'Working calendar', status: 'Active' }],
          classifications: [],
          disciplines: [],
          location_nodes: [{ id: 'location-1', code: 'L01', name: 'Level 01', status: 'Active' }],
          numbering_profiles: [
            { id: 'numbering-1', code: 'DOC', name: 'Document numbering', status: 'Active' },
          ],
          partners: [],
          work_nodes: [{ id: 'work-1', code: 'WP-100', name: 'Fit-out', status: 'Active' }],
        }),
      );
    }
    const invitationMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/invitations$/u);
    if (invitationMatch !== null && init?.method === 'POST') {
      return Promise.resolve(json({ id: 'invitation-1', status: 'Pending' }));
    }
    throw new Error(`Unexpected web API request: ${init?.method ?? 'GET'} ${path}`);
  };
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  browserStorage().localStorage?.clear();
  browserStorage().sessionStorage?.clear();
});

describe('web administration shell', () => {
  it('refreshes through the HttpOnly-cookie request path and replaces only the in-memory access session', async () => {
    const refreshSession = {
      ...session,
      access_token: 'test-refreshed-access-token',
      csrf_token: 'test-refreshed-csrf-token',
    };
    let organizationsAttempt = 0;
    let refreshAttempt = 0;
    const calls: RecordedRequest[] = [];
    const fetchMock = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ input, init });
      const path = pathname(input);
      if (path === '/api/v1/auth/sessions') {
        return Promise.resolve(json(session));
      }
      if (path === '/api/v1/auth/refresh') {
        refreshAttempt += 1;
        return Promise.resolve(json(refreshSession));
      }
      if (path === '/api/v1/organizations') {
        organizationsAttempt += 1;
        return Promise.resolve(
          organizationsAttempt <= 2
            ? json({ code: 'AUTH_SESSION_REVOKED' }, 401)
            : json({ items: organizations, page: { next_cursor: null, has_more: false } }),
        );
      }
      throw new Error(`Unexpected refresh-flow request: ${path}`);
    };
    const client = new VinopsApiClient(config.VITE_API_BASE_URL, fetchMock);

    await client.login('admin@example.test', 'passphrase');
    await Promise.all([client.listOrganizations(), client.listOrganizations()]);

    const refreshCall = calls.find((call) => pathname(call.input) === '/api/v1/auth/refresh');
    if (refreshCall === undefined) {
      throw new Error('Expected a refresh request after the first 401 response.');
    }
    expect(new Headers(refreshCall.init?.headers).get('x-csrf-token')).toBe('test-csrf-token');
    expect(refreshCall.init?.credentials).toBe('include');
    expect(refreshAttempt).toBe(1);
    const retriedOrganizationCall = calls.at(-1);
    if (retriedOrganizationCall === undefined) {
      throw new Error('Expected the organization request to be retried.');
    }
    expect(new Headers(retriedOrganizationCall.init?.headers).get('authorization')).toBe(
      'Bearer test-refreshed-access-token',
    );
    expect(client.getSession()?.accessToken).toBe('test-refreshed-access-token');
  });

  it('validates sign-in input, then loads workspaces through the configured API without browser storage', async () => {
    const apiMock = installApiMock();
    expect(readPublicConfig(config)).toEqual(config);
    render(<App config={config} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter both email and password');

    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'admin@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Project overview' });
    expect(screen.getByTestId('memory-auth-state')).toHaveTextContent('memory only');
    expect(browserStorage().localStorage?.length ?? 0).toBe(0);
    expect(browserStorage().sessionStorage?.length ?? 0).toBe(0);
    const signInCall = apiMock.calls.find(
      (call) => pathname(call.input) === '/api/v1/auth/sessions' && call.init?.method === 'POST',
    );
    expect(signInCall?.init).toMatchObject({ credentials: 'include', method: 'POST' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in to your workspace' });
  });

  it('switches server-returned workspace and renders suspended and archived lifecycle states', async () => {
    installApiMock();
    render(<App config={config} initialAuthenticated />);

    await screen.findByRole('heading', { name: 'Project overview' });
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'organization-2' } });
    await screen.findByText('Airport Fit-out · AIR-021');

    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'organization-1' } });
    await screen.findByText('Riverside Office · RIV-001');
    fireEvent.change(screen.getByLabelText('Project context'), {
      target: { value: 'project-suspended' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('This project is suspended');

    fireEvent.change(screen.getByLabelText('Project context'), {
      target: { value: 'project-archived' },
    });
    expect(
      await screen.findByRole('heading', { name: 'This project is archived' }),
    ).toBeInTheDocument();
  });

  it('loads members and sends an idempotent invitation request to the server', async () => {
    const apiMock = installApiMock();
    render(<App config={config} initialAuthenticated initialScreen="members" />);

    await screen.findByRole('heading', { name: 'Members' });
    expect(await screen.findByText('Project Administrator')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request invitation' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an email, resource scope, and expiry',
    );

    fireEvent.change(screen.getByLabelText('Member email'), {
      target: { value: 'guest@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Resource scope'), { target: { value: 'Level 01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request invitation' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'accepted for server-side policy validation',
    );
    const invitationCall = apiMock.calls.find(
      (call) =>
        pathname(call.input) === '/api/v1/projects/project-active/invitations' &&
        call.init?.method === 'POST',
    );
    if (invitationCall === undefined) {
      throw new Error('Expected an invitation request.');
    }
    expect(new Headers(invitationCall.init?.headers).get('idempotency-key')).toMatch(/^web-/u);
    const invitationBody = jsonRequestBody(invitationCall.init?.body);
    expect(invitationBody).toMatchObject({
      email: 'guest@example.test',
      roles: ['field_engineer'],
    });
  });

  it('renders loading, empty, denied, and retryable project-context states', async () => {
    installApiMock();
    const loading = render(
      <App config={config} initialAuthenticated initialShellState="loading" />,
    );
    expect(
      screen.getByRole('heading', { name: 'Loading project context' }).closest('section'),
    ).toHaveAttribute('aria-busy', 'true');
    loading.unmount();

    const empty = render(<App config={config} initialAuthenticated initialShellState="empty" />);
    expect(
      screen.getByRole('heading', { name: 'No project context is available' }),
    ).toBeInTheDocument();
    empty.unmount();

    const denied = render(<App config={config} initialAuthenticated initialShellState="denied" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
    denied.unmount();

    render(<App config={config} initialAuthenticated initialShellState="error" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading project context' }));
    await screen.findByRole('heading', { name: 'Project overview' });
  });

  it('navigates API-backed project context structure screens', async () => {
    installApiMock();
    render(<App config={config} initialAuthenticated />);

    await screen.findByRole('heading', { name: 'Project overview' });
    fireEvent.click(screen.getByRole('button', { name: 'LBS' }));
    expect(
      await screen.findByRole('heading', { name: 'Location breakdown structure' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('listitem', { name: /Level 01/u })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'WBS' }));
    expect(screen.getByRole('heading', { name: 'Work breakdown structure' })).toBeInTheDocument();
    expect(await screen.findByRole('listitem', { name: /Fit-out/u })).toBeInTheDocument();
  });

  it('renders a safe fallback when a child fails', () => {
    function BrokenChild(): ReactNode {
      throw new Error('test-only render failure');
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(
        <ErrorBoundary>
          <BrokenChild />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The application shell could not be rendered.',
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
