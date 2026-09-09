import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { WebConfig } from '@vinops/config';
import {
  ApiError,
  type ApiSession,
  type ContextEntity,
  type Organization,
  type Project,
  type ProjectContext,
  type ProjectMember,
  VinopsApiClient,
} from './api.js';
import { DocumentControlScreen } from './document-control.js';
import { IssueKanban } from './issues/issue-kanban.js';
import { RfiHub } from './rfx/rfi-hub.js';
import { SubmittalDashboard } from './rfx/submittal-dashboard.js';
import { MobileSiteInspection } from './mobile-site-inspection.js';
import { DailyLogSheet } from './daily-log-sheet.js';
import type { FieldIssue, RfiRequest, Submittal, Inspection, DailyLog } from './api.js';
import './app.css';

type Screen =
  | 'overview'
  | 'organization'
  | 'project'
  | 'members'
  | 'documents'
  | 'settings'
  | 'lbs'
  | 'wbs'
  | 'issues'
  | 'rfi'
  | 'submittals'
  | 'quality'
  | 'daily_logs';

export type ShellState = 'loading' | 'empty' | 'denied' | 'suspended' | 'archived' | 'error';

type AppProps = {
  config: WebConfig;
  /** Test-only hook; production authentication always starts at the sign-in form. */
  initialAuthenticated?: boolean;
  initialScreen?: Screen;
  /** Test-only presentation state; it does not perform a lifecycle mutation. */
  initialShellState?: ShellState;
};

const navigation: Array<{ id: Screen; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'organization', label: 'Organization' },
  { id: 'project', label: 'Project' },
  { id: 'members', label: 'Members' },
  { id: 'documents', label: 'Documents' },
  { id: 'issues', label: 'Field Issues' },
  { id: 'rfi', label: 'RFIs' },
  { id: 'submittals', label: 'Submittals' },
  { id: 'quality', label: 'Quality Inspections' },
  { id: 'daily_logs', label: 'Daily Logs' },
  { id: 'settings', label: 'Settings' },
  { id: 'lbs', label: 'LBS' },
  { id: 'wbs', label: 'WBS' },
];

const testOnlySession: ApiSession = {
  accessToken: 'test-in-memory-access-token',
  accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
  csrfToken: 'test-in-memory-csrf-token',
  sessionId: 'test-session',
  user: { id: 'test-user', displayName: 'Test User' },
};

function lifecycleShellState(project: Project): ShellState | undefined {
  switch (project.status.toLowerCase()) {
    case 'suspended':
      return 'suspended';
    case 'archived':
      return 'archived';
    default:
      return undefined;
  }
}

function stateForError(error: unknown): ShellState {
  return error instanceof ApiError && (error.status === 403 || error.status === 404)
    ? 'denied'
    : 'error';
}

function errorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403 || error.status === 404)
  ) {
    return 'Your server-authorized workspace context is no longer available.';
  }
  return 'The project context could not be loaded. No pending mutation was retried automatically.';
}

function selectFirst<T>(items: readonly T[]): T | null {
  return items[0] ?? null;
}

export function App({
  config,
  initialAuthenticated = false,
  initialScreen = 'overview',
  initialShellState,
}: AppProps) {
  const clientHolder = useRef<{ baseUrl: string; client: VinopsApiClient } | null>(null);
  if (clientHolder.current?.baseUrl !== config.VITE_API_BASE_URL) {
    clientHolder.current = {
      baseUrl: config.VITE_API_BASE_URL,
      client: new VinopsApiClient(config.VITE_API_BASE_URL),
    };
  }
  const client = clientHolder.current.client;
  const [session, setSession] = useState<ApiSession | null>(() => {
    if (!initialAuthenticated) {
      return null;
    }
    client.setSession(testOnlySession);
    return testOnlySession;
  });
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [organizations, setOrganizations] = useState<readonly Organization[]>([]);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [members, setMembers] = useState<readonly ProjectMember[]>([]);
  const [shellState, setShellState] = useState<ShellState | undefined>(undefined);
  const [presentationOverride, setPresentationOverride] = useState<ShellState | undefined>(
    initialShellState,
  );
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  const organization = organizations.find((item) => item.id === organizationId) ?? null;
  const selectedProject = projects.find((item) => item.id === projectId) ?? project;
  const visibleState = presentationOverride ?? shellState;

  function synchronizeSession(): void {
    setSession(client.getSession());
  }

  function resetWorkspace(): void {
    setOrganizations([]);
    setProjects([]);
    setOrganizationId(null);
    setProjectId(null);
    setProject(null);
    setProjectContext(null);
    setMembers([]);
    setShellState(undefined);
    setLoadMessage(null);
  }

  useEffect(() => {
    if (session === null || presentationOverride !== undefined) {
      return undefined;
    }
    let disposed = false;
    setShellState('loading');
    setLoadMessage(null);
    void client
      .listOrganizations()
      .then((items) => {
        if (disposed) {
          return;
        }
        synchronizeSession();
        setOrganizations(items);
        setProjects([]);
        setProjectId(null);
        setProject(null);
        setProjectContext(null);
        setMembers([]);
        const selected = selectFirst(items);
        setOrganizationId(
          (current) => items.find((item) => item.id === current)?.id ?? selected?.id ?? null,
        );
        setShellState(selected === null ? 'empty' : undefined);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        synchronizeSession();
        setShellState(stateForError(error));
        setLoadMessage(errorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, [client, presentationOverride, reloadNonce, session]);

  useEffect(() => {
    if (session === null || organizationId === null || presentationOverride !== undefined) {
      return undefined;
    }
    let disposed = false;
    setShellState('loading');
    setLoadMessage(null);
    void client
      .listProjects(organizationId)
      .then((items) => {
        if (disposed) {
          return;
        }
        synchronizeSession();
        setProjects(items);
        setProject(null);
        setProjectContext(null);
        setMembers([]);
        const selected = selectFirst(items);
        setProjectId(
          (current) => items.find((item) => item.id === current)?.id ?? selected?.id ?? null,
        );
        setShellState(selected === null ? 'empty' : undefined);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        synchronizeSession();
        setShellState(stateForError(error));
        setLoadMessage(errorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, [client, organizationId, presentationOverride, reloadNonce, session]);

  useEffect(() => {
    if (session === null || projectId === null || presentationOverride !== undefined) {
      return undefined;
    }
    let disposed = false;
    setShellState('loading');
    setLoadMessage(null);
    void Promise.all([
      client.getProject(projectId),
      client.getProjectContext(projectId),
      client.listMembers(projectId),
    ])
      .then(([detail, context, projectMembers]) => {
        if (disposed) {
          return;
        }
        synchronizeSession();
        setProject(detail);
        setProjectContext(context);
        setMembers(projectMembers);
        setShellState(lifecycleShellState(detail));
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        synchronizeSession();
        setShellState(stateForError(error));
        setLoadMessage(errorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, [client, presentationOverride, projectId, reloadNonce, session]);

  function handleOrganizationChange(nextOrganizationId: string): void {
    if (!organizations.some((item) => item.id === nextOrganizationId)) {
      return;
    }
    setOrganizationId(nextOrganizationId);
    setProjects([]);
    setProjectId(null);
    setProject(null);
    setProjectContext(null);
    setMembers([]);
  }

  function handleProjectChange(nextProjectId: string): void {
    if (!projects.some((item) => item.id === nextProjectId)) {
      return;
    }
    setProjectId(nextProjectId);
    setProject(null);
    setProjectContext(null);
    setMembers([]);
  }

  async function handleAuthenticated(email: string, password: string): Promise<void> {
    const nextSession = await client.login(email, password);
    resetWorkspace();
    setSession(nextSession);
    setPresentationOverride(undefined);
  }

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await client.signOut();
    } catch {
      // Clear local state even if the network prevents best-effort session revocation.
    } finally {
      resetWorkspace();
      setSession(null);
      setScreen('overview');
      setSigningOut(false);
    }
  }

  async function handleCreateInvitation(input: {
    email: string;
    roles: readonly string[];
    scopes: readonly Record<string, unknown>[];
    validTo: string;
  }): Promise<void> {
    if (selectedProject === null) {
      throw new ApiError(409, 'PROJECT_CONTEXT_MISSING', false);
    }
    await client.createInvitation({ projectId: selectedProject.id, ...input });
    synchronizeSession();
  }

  function retryLoad(): void {
    setPresentationOverride(undefined);
    setShellState(undefined);
    setLoadMessage(null);
    setReloadNonce((value) => value + 1);
  }

  if (session === null) {
    return <LoginPage environment={config.VITE_APP_ENV} onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">VinOps</p>
          <h1>Project administration</h1>
        </div>
        {organization !== null && selectedProject !== null ? (
          <WorkspaceProjectSwitcher
            organization={organization}
            organizationId={organization.id}
            organizations={organizations}
            project={selectedProject}
            projectId={selectedProject.id}
            projects={projects}
            onOrganizationChange={handleOrganizationChange}
            onProjectChange={handleProjectChange}
          />
        ) : (
          <p className="workspace-status">Loading only server-authorized workspaces.</p>
        )}
        <button
          className="secondary-button"
          disabled={signingOut}
          type="button"
          onClick={() => void handleSignOut()}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </header>

      <div className="app-layout">
        <nav aria-label="Project administration" className="app-navigation">
          {navigation.map((item) => (
            <button
              aria-current={screen === item.id ? 'page' : undefined}
              className={screen === item.id ? 'navigation-item is-active' : 'navigation-item'}
              key={item.id}
              type="button"
              onClick={() => setScreen(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="app-content">
          <p className="session-note" data-testid="memory-auth-state">
            Access and CSRF tokens are held in memory only. Refresh uses the HttpOnly cookie through
            credentialed API requests.
          </p>
          {visibleState === undefined && organization !== null && selectedProject !== null ? (
            <ScreenContent
              members={members}
              organization={organization}
              project={selectedProject}
              projectContext={projectContext}
              screen={screen}
              client={client}
              onNavigate={setScreen}
              onCreateInvitation={handleCreateInvitation}
            />
          ) : (
            <ShellStatePanel
              message={loadMessage}
              project={selectedProject}
              state={visibleState ?? 'empty'}
              onRetry={retryLoad}
            />
          )}
          <footer className="app-footer">Environment: {config.VITE_APP_ENV}</footer>
        </main>
      </div>
    </div>
  );
}

type LoginPageProps = {
  environment: string;
  onAuthenticated: (email: string, password: string) => Promise<void>;
};

function LoginPage({ environment, onAuthenticated }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (email.trim() === '' || password === '') {
      setValidationMessage('Enter both email and password to continue.');
      return;
    }
    setSubmitting(true);
    setValidationMessage(null);
    try {
      await onAuthenticated(email.trim(), password);
      setPassword('');
    } catch {
      setValidationMessage("We couldn't sign you in. Check your credentials and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="login-title" className="login-card">
        <p className="eyebrow">VinOps administration</p>
        <h1 id="login-title">Sign in to your workspace</h1>
        <p>
          Use your organization account. This client never stores access credentials in browser
          storage.
        </p>
        <form noValidate onSubmit={(event) => void submit(event)}>
          <label htmlFor="login-email">
            Work email
            <input
              aria-invalid={validationMessage === null ? undefined : true}
              autoComplete="email"
              id="login-email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label htmlFor="login-password">
            Password
            <input
              aria-invalid={validationMessage === null ? undefined : true}
              autoComplete="current-password"
              id="login-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {validationMessage === null ? null : <p role="alert">{validationMessage}</p>}
          <button disabled={submitting} type="submit">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted-copy">Environment: {environment}</p>
      </section>
    </main>
  );
}

type WorkspaceProjectSwitcherProps = {
  organization: Organization;
  organizationId: string;
  organizations: readonly Organization[];
  project: Project;
  projectId: string;
  projects: readonly Project[];
  onOrganizationChange: (organizationId: string) => void;
  onProjectChange: (projectId: string) => void;
};

function WorkspaceProjectSwitcher({
  organization,
  organizationId,
  organizations: availableOrganizations,
  project,
  projectId,
  projects,
  onOrganizationChange,
  onProjectChange,
}: WorkspaceProjectSwitcherProps) {
  return (
    <div className="workspace-switcher">
      <label htmlFor="organization-workspace">
        Workspace
        <select
          id="organization-workspace"
          value={organizationId}
          onChange={(event) => onOrganizationChange(event.target.value)}
        >
          {availableOrganizations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="project-context">
        Project context
        <select
          id="project-context"
          value={projectId}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.code})
            </option>
          ))}
        </select>
      </label>
      <span
        aria-label={`${project.name} lifecycle`}
        className={`status-chip status-${project.status.toLowerCase()}`}
      >
        {project.status}
      </span>
      <span className="visually-hidden">Selected organization: {organization.name}</span>
    </div>
  );
}

type ScreenContentProps = {
  client: VinopsApiClient;
  organization: Organization;
  project: Project;
  projectContext: ProjectContext | null;
  members: readonly ProjectMember[];
  screen: Screen;
  onNavigate?: (screen: Screen) => void;
  onCreateInvitation: (input: {
    email: string;
    roles: readonly string[];
    scopes: readonly Record<string, unknown>[];
    validTo: string;
  }) => Promise<void>;
};

function ScreenContent({
  client,
  members,
  organization,
  project,
  projectContext,
  screen,
  onNavigate,
  onCreateInvitation,
}: ScreenContentProps) {
  switch (screen) {
    case 'organization':
      return <OrganizationScreen organization={organization} />;
    case 'project':
      return <ProjectScreen project={project} />;
    case 'members':
      return (
        <MembersScreen
          members={members}
          project={project}
          onCreateInvitation={onCreateInvitation}
        />
      );
    case 'documents':
      return <DocumentControlScreen client={client} members={members} project={project} />;
    case 'issues':
      return (
        <IssuesScreenWrapper client={client} project={project} projectContext={projectContext} />
      );
    case 'rfi':
      return <RfiScreenWrapper client={client} project={project} projectContext={projectContext} />;
    case 'submittals':
      return (
        <SubmittalsScreenWrapper
          client={client}
          project={project}
          projectContext={projectContext}
        />
      );
    case 'quality':
      return <QualityScreenWrapper client={client} project={project} />;
    case 'daily_logs':
      return <DailyLogsScreenWrapper client={client} project={project} />;
    case 'settings':
      return <SettingsScreen project={project} projectContext={projectContext} />;
    case 'lbs':
      return <LbsScreen project={project} nodes={projectContext?.locationNodes ?? []} />;
    case 'wbs':
      return <WbsScreen project={project} nodes={projectContext?.workNodes ?? []} />;
    case 'overview':
      return (
        <OverviewScreen
          client={client}
          organization={organization}
          project={project}
          projectContext={projectContext}
          onNavigate={onNavigate}
        />
      );
  }
}

function IssuesScreenWrapper({
  client,
  project,
  projectContext,
}: {
  client: VinopsApiClient;
  project: Project;
  projectContext: ProjectContext | null;
}) {
  const [issues, setIssues] = useState<readonly FieldIssue[]>([]);
  const load = async () => {
    try {
      const items = await client.listIssues(project.id);
      setIssues(items);
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    void load();
  }, [project.id]);

  return (
    <IssueKanban
      projectId={project.id}
      client={client}
      issues={issues}
      projectContext={projectContext}
      onRefresh={load}
    />
  );
}

function RfiScreenWrapper({
  client,
  project,
  projectContext,
}: {
  client: VinopsApiClient;
  project: Project;
  projectContext: ProjectContext | null;
}) {
  const [rfis, setRfis] = useState<readonly RfiRequest[]>([]);
  const load = async () => {
    try {
      const items = await client.listRfis(project.id);
      setRfis(items);
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    void load();
  }, [project.id]);

  return (
    <RfiHub
      projectId={project.id}
      client={client}
      rfis={rfis}
      projectContext={projectContext}
      onRefresh={load}
    />
  );
}

function SubmittalsScreenWrapper({
  client,
  project,
  projectContext,
}: {
  client: VinopsApiClient;
  project: Project;
  projectContext: ProjectContext | null;
}) {
  const [submittals, setSubmittals] = useState<readonly Submittal[]>([]);
  const load = async () => {
    try {
      const items = await client.listSubmittals(project.id);
      setSubmittals(items);
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    void load();
  }, [project.id]);

  return (
    <SubmittalDashboard
      projectId={project.id}
      client={client}
      submittals={submittals}
      projectContext={projectContext}
      onRefresh={load}
    />
  );
}

function QualityScreenWrapper({ client, project }: { client: VinopsApiClient; project: Project }) {
  const [inspections, setInspections] = useState<readonly Inspection[]>([]);
  const load = async () => {
    try {
      const items = await client.listInspections(project.id);
      setInspections(items);
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    void load();
  }, [project.id]);

  return (
    <MobileSiteInspection
      projectId={project.id}
      client={client}
      inspections={inspections}
      onRefresh={load}
    />
  );
}

function DailyLogsScreenWrapper({
  client,
  project,
}: {
  client: VinopsApiClient;
  project: Project;
}) {
  const [, setLogs] = useState<readonly DailyLog[]>([]);
  const [activeLog, setActiveLog] = useState<DailyLog | null>(null);

  const load = async () => {
    try {
      const items = await client.listDailyLogs(project.id);
      setLogs(items);
      if (items.length > 0) {
        setActiveLog((prev) =>
          prev ? (items.find((i) => i.id === prev.id) ?? items[0]!) : items[0]!,
        );
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void load();
  }, [project.id]);

  return (
    <div>
      {activeLog ? (
        <DailyLogSheet
          projectId={project.id}
          client={client}
          initialLog={activeLog}
          onRefresh={load}
        />
      ) : (
        <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>
          <p>Chưa có nhật ký thi công cho dự án này.</p>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                try {
                  const created = await client.createDailyLog(project.id, {
                    contract_package_id: '00000000-0000-4000-8000-000000007030',
                    log_date: new Date().toISOString().slice(0, 10),
                  });
                  setActiveLog(created);
                  void load();
                } catch {
                  // ignore
                }
              })();
            }}
            style={{
              padding: '8px 16px',
              background: '#1a73e8',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Tạo nhật ký hôm nay
          </button>
        </div>
      )}
    </div>
  );
}

function OverviewScreen({
  client,
  organization,
  project,
  projectContext,
  onNavigate,
}: {
  client?: VinopsApiClient | undefined;
  organization: Organization;
  project: Project;
  projectContext?: ProjectContext | null | undefined;
  onNavigate?: ((screen: Screen) => void) | undefined;
}) {
  const [counts, setCounts] = useState<{
    issues: number | null;
    rfis: number | null;
    submittals: number | null;
    documents: number | null;
    inspections: number | null;
    dailyLogs: number | null;
  }>({
    issues: null,
    rfis: null,
    submittals: null,
    documents: null,
    inspections: null,
    dailyLogs: null,
  });

  useEffect(() => {
    if (!client || !project?.id) return;
    let disposed = false;
    void Promise.allSettled([
      client.listIssues(project.id),
      client.listRfis(project.id),
      client.listSubmittals(project.id),
      client.listDocuments(project.id),
      client.listInspections(project.id),
      client.listDailyLogs(project.id),
    ]).then(([issuesRes, rfisRes, submittalsRes, docsRes, inspectionsRes, dailyLogsRes]) => {
      if (disposed) return;
      setCounts({
        issues: issuesRes.status === 'fulfilled' ? issuesRes.value.length : 0,
        rfis: rfisRes.status === 'fulfilled' ? rfisRes.value.length : 0,
        submittals: submittalsRes.status === 'fulfilled' ? submittalsRes.value.length : 0,
        documents: docsRes.status === 'fulfilled' ? docsRes.value.length : 0,
        inspections: inspectionsRes.status === 'fulfilled' ? inspectionsRes.value.length : 0,
        dailyLogs: dailyLogsRes.status === 'fulfilled' ? dailyLogsRes.value.length : 0,
      });
    });
    return () => {
      disposed = true;
    };
  }, [client, project?.id]);

  return (
    <section aria-labelledby="overview-title">
      <p className="eyebrow">Current project context</p>
      <h2 id="overview-title">Project overview</h2>
      <div className="card-grid">
        <article className="content-card">
          <h3>Workspace</h3>
          <p>{organization.name}</p>
          <p className="muted-copy">
            Organization and project membership are evaluated by the server.
          </p>
        </article>
        <article className="content-card">
          <h3>Project</h3>
          <p>
            {project.name} · {project.code}
          </p>
          <p className="muted-copy">Timezone: {project.timezone}</p>
        </article>
        <article className="content-card">
          <h3>Administration guardrails</h3>
          <p>Role changes, lifecycle transitions, and scoped access require server validation.</p>
        </article>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <p className="eyebrow">Dữ liệu vận hành thực tế công trường</p>
        <h3 style={{ marginTop: '0.25rem' }}>
          Bảng điều khiển hoạt động dự án (Operational Dashboard)
        </h3>
        <div className="card-grid" style={{ marginTop: '1rem' }}>
          <article className="content-card" style={{ borderTop: '4px solid #d9534f' }}>
            <h4>Field Issues</h4>
            <p style={{ fontSize: '2rem', fontWeight: 800, margin: '0.25rem 0', color: '#d9534f' }}>
              {counts.issues !== null ? `${counts.issues} vấn đề` : '…'}
            </p>
            <p className="muted-copy">
              Các vấn đề an toàn, chất lượng đang phân loại & khắc phục theo quy trình.
            </p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate('issues')}>
                Xem Kanban Issues &rarr;
              </button>
            )}
          </article>

          <article className="content-card" style={{ borderTop: '4px solid #f0ad4e' }}>
            <h4>RFIs</h4>
            <p style={{ fontSize: '2rem', fontWeight: 800, margin: '0.25rem 0', color: '#f0ad4e' }}>
              {counts.rfis !== null ? `${counts.rfis} yêu cầu` : '…'}
            </p>
            <p className="muted-copy">
              Yêu cầu thông tin kỹ thuật làm rõ bản vẽ, chỉ dẫn và biện pháp thi công.
            </p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate('rfi')}>
                Xem RFIs Hub &rarr;
              </button>
            )}
          </article>

          <article className="content-card" style={{ borderTop: '4px solid #0275d8' }}>
            <h4>Submittals</h4>
            <p style={{ fontSize: '2rem', fontWeight: 800, margin: '0.25rem 0', color: '#0275d8' }}>
              {counts.submittals !== null ? `${counts.submittals} hồ sơ` : '…'}
            </p>
            <p className="muted-copy">
              Hồ sơ trình duyệt vật tư, thiết bị MEP và biện pháp thi công các hạng mục.
            </p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate('submittals')}>
                Xem Submittals &rarr;
              </button>
            )}
          </article>

          <article className="content-card" style={{ borderTop: '4px solid #5bc0de' }}>
            <h4>Documents</h4>
            <p style={{ fontSize: '2rem', fontWeight: 800, margin: '0.25rem 0', color: '#5bc0de' }}>
              {counts.documents !== null ? `${counts.documents} tài liệu` : '…'}
            </p>
            <p className="muted-copy">
              Kho bản vẽ thiết kế Shop Drawings và hồ sơ pháp lý dự án có versioning.
            </p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate('documents')}>
                Xem Documents &rarr;
              </button>
            )}
          </article>

          <article className="content-card" style={{ borderTop: '4px solid #5cb85c' }}>
            <h4>Quality Inspections</h4>
            <p style={{ fontSize: '2rem', fontWeight: 800, margin: '0.25rem 0', color: '#5cb85c' }}>
              {counts.inspections !== null ? `${counts.inspections} biên bản` : '…'}
            </p>
            <p className="muted-copy">
              Kiểm tra hiện trường & Nghiệm thu công việc xây dựng theo NĐ 207/2026/NĐ-CP.
            </p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate('quality')}>
                Xem Quality & Nghiệm thu &rarr;
              </button>
            )}
          </article>

          <article className="content-card" style={{ borderTop: '4px solid #6f42c1' }}>
            <h4>Daily Logs</h4>
            <p style={{ fontSize: '2rem', fontWeight: 800, margin: '0.25rem 0', color: '#6f42c1' }}>
              {counts.dailyLogs !== null ? `${counts.dailyLogs} nhật ký` : '…'}
            </p>
            <p className="muted-copy">
              Nhật ký thi công hàng ngày: Thời tiết 2 ca, quân số nhà thầu và máy móc thiết bị.
            </p>
            {onNavigate && (
              <button type="button" onClick={() => onNavigate('daily_logs')}>
                Xem Nhật ký thi công &rarr;
              </button>
            )}
          </article>
        </div>
      </div>

      {projectContext && (
        <div style={{ marginTop: '2rem' }}>
          <p className="eyebrow">Cấu trúc công trình & Đối tác dự án</p>
          <div className="card-grid" style={{ marginTop: '0.5rem' }}>
            <article className="content-card">
              <h4>Đối tác tham gia ({projectContext.partners.length})</h4>
              <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
                {projectContext.partners.map((p) => (
                  <li key={p.id}>
                    <strong>{p.code}</strong>: {p.name}
                  </li>
                ))}
              </ul>
            </article>

            <article className="content-card">
              <h4>Phân khu LBS ({projectContext.locationNodes.length} vị trí)</h4>
              <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
                {projectContext.locationNodes.map((l) => (
                  <li key={l.id}>
                    <strong>{l.code}</strong>: {l.name}
                  </li>
                ))}
              </ul>
            </article>

            <article className="content-card">
              <h4>Gói thầu WBS ({projectContext.workNodes.length} hạng mục)</h4>
              <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
                {projectContext.workNodes.map((w) => (
                  <li key={w.id}>
                    <strong>{w.code}</strong>: {w.name}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      )}
    </section>
  );
}

function OrganizationScreen({ organization }: { organization: Organization }) {
  return (
    <section aria-labelledby="organization-title">
      <p className="eyebrow">Workspace administration</p>
      <h2 id="organization-title">Organization</h2>
      <article className="content-card">
        <h3>{organization.name}</h3>
        <dl className="definition-list">
          <div>
            <dt>Workspace code</dt>
            <dd>{organization.code}</dd>
          </div>
          <div>
            <dt>Server status</dt>
            <dd>{organization.status}</dd>
          </div>
          <div>
            <dt>Owner guardrail</dt>
            <dd>Organization ownership does not automatically grant project approval authority.</dd>
          </div>
        </dl>
      </article>
    </section>
  );
}

function ProjectScreen({ project }: { project: Project }) {
  return (
    <section aria-labelledby="project-title">
      <p className="eyebrow">Project administration</p>
      <h2 id="project-title">Project details</h2>
      <article className="content-card">
        <dl className="definition-list">
          <div>
            <dt>Name</dt>
            <dd>{project.name}</dd>
          </div>
          <div>
            <dt>Code</dt>
            <dd>{project.code}</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>{project.timezone}</dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{project.status}</dd>
          </div>
        </dl>
        <p className="muted-copy">
          Lifecycle updates are not exposed as direct status edits; the server must apply an
          authorized transition command.
        </p>
      </article>
    </section>
  );
}

function inputDateTimeInSevenDays(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

type MembersScreenProps = {
  members: readonly ProjectMember[];
  project: Project;
  onCreateInvitation: ScreenContentProps['onCreateInvitation'];
};

function MembersScreen({ members, project, onCreateInvitation }: MembersScreenProps) {
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState('');
  const [role, setRole] = useState('field_engineer');
  const [validTo, setValidTo] = useState(inputDateTimeInSevenDays);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitInvite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (email.trim() === '' || scope.trim() === '' || validTo === '') {
      setMessage('Enter an email, resource scope, and expiry before requesting an invitation.');
      return;
    }
    const expiry = new Date(validTo);
    if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      setMessage('Choose a future invitation expiry.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await onCreateInvitation({
        email: email.trim(),
        roles: [role],
        scopes: [{ resource_type: 'project_context', resource_id: scope.trim() }],
        validTo: expiry.toISOString(),
      });
      setMessage('Invitation request was accepted for server-side policy validation and delivery.');
    } catch {
      setMessage(
        'The invitation request could not be accepted. Review your scope and permissions, then try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="members-title">
      <p className="eyebrow">Membership and scope</p>
      <h2 id="members-title">Members</h2>
      <div className="split-layout">
        <article className="content-card">
          <h3>Current membership view</h3>
          {members.length === 0 ? (
            <p className="muted-copy">
              No members are visible in this server-authorized project context.
            </p>
          ) : (
            <ul className="member-list">
              {members.map((member) => (
                <li key={member.id}>
                  <strong>{member.displayName}</strong>
                  <span>
                    {member.roles.join(', ') || 'No role'} · {member.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            disabled
            title="Project Admin permission is required to change roles."
            type="button"
          >
            Change role
          </button>
          <p className="muted-copy">
            Permission denied states preserve the form and never reveal unauthorized membership
            metadata.
          </p>
        </article>
        <form className="content-card" noValidate onSubmit={(event) => void submitInvite(event)}>
          <h3>Invite member</h3>
          <p className="muted-copy">Project: {project.name}</p>
          <label htmlFor="invite-email">
            Member email
            <input
              aria-invalid={message?.startsWith('Enter') === true ? true : undefined}
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label htmlFor="invite-role">
            Role
            <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="field_engineer">Field Engineer</option>
              <option value="technical_reviewer">Technical Reviewer</option>
              <option value="project_guest">Project Guest</option>
            </select>
          </label>
          <label htmlFor="invite-scope">
            Resource scope
            <input
              aria-invalid={message?.startsWith('Enter') === true ? true : undefined}
              id="invite-scope"
              placeholder="Location, work package, or discipline"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            />
          </label>
          <label htmlFor="invite-expiry">
            Invitation expiry
            <input
              id="invite-expiry"
              min={new Date().toISOString().slice(0, 16)}
              type="datetime-local"
              value={validTo}
              onChange={(event) => setValidTo(event.target.value)}
            />
          </label>
          {message === null ? null : (
            <p
              role={
                message.startsWith('Enter') || message.startsWith('Choose') ? 'alert' : 'status'
              }
            >
              {message}
            </p>
          )}
          <button disabled={submitting} type="submit">
            {submitting ? 'Requesting invitation…' : 'Request invitation'}
          </button>
        </form>
      </div>
    </section>
  );
}

function SettingsScreen({
  project,
  projectContext,
}: {
  project: Project;
  projectContext: ProjectContext | null;
}) {
  const calendars = projectContext?.calendars ?? [];
  const profiles = projectContext?.numberingProfiles ?? [];
  return (
    <section aria-labelledby="settings-title">
      <p className="eyebrow">Context configuration</p>
      <h2 id="settings-title">Project settings</h2>
      <article className="content-card">
        <h3>Calendar and numbering</h3>
        <p>{project.timezone} is the project timezone returned by the server.</p>
        <ContextSummary label="Calendars" values={calendars} />
        <ContextSummary label="Numbering profiles" values={profiles} />
        <p className="muted-copy">
          Settings changes require expected-version and idempotency controls at the API boundary.
        </p>
      </article>
    </section>
  );
}

function ContextSummary({ label, values }: { label: string; values: readonly ContextEntity[] }) {
  return (
    <div className="context-summary">
      <strong>{label}</strong>
      {values.length === 0 ? (
        <span className="muted-copy">None returned for this project.</span>
      ) : (
        <span>{values.map((value) => value.name).join(', ')}</span>
      )}
    </div>
  );
}

function LbsScreen({ project, nodes }: { project: Project; nodes: readonly ContextEntity[] }) {
  return (
    <section aria-labelledby="lbs-title">
      <p className="eyebrow">Project context</p>
      <h2 id="lbs-title">Location breakdown structure</h2>
      <article className="content-card">
        <p>Location nodes are scoped to {project.name}.</p>
        <ContextTree
          emptyMessage="No location nodes are available in this project context."
          nodes={nodes}
        />
        <p className="muted-copy">
          The API rejects cycles, duplicate sibling codes, and hard deletion of referenced nodes.
        </p>
      </article>
    </section>
  );
}

function WbsScreen({ project, nodes }: { project: Project; nodes: readonly ContextEntity[] }) {
  return (
    <section aria-labelledby="wbs-title">
      <p className="eyebrow">Project context</p>
      <h2 id="wbs-title">Work breakdown structure</h2>
      <article className="content-card">
        <p>Work packages are separate from location nodes for {project.name}.</p>
        <ContextTree
          emptyMessage="No work nodes are available in this project context."
          nodes={nodes}
        />
        <p className="muted-copy">
          A partner owner is metadata only and cannot grant resource access without membership.
        </p>
      </article>
    </section>
  );
}

function ContextTree({
  emptyMessage,
  nodes,
}: {
  emptyMessage: string;
  nodes: readonly ContextEntity[];
}) {
  if (nodes.length === 0) {
    return <p className="muted-copy">{emptyMessage}</p>;
  }
  return (
    <ul className="tree-list">
      {nodes.map((node) => (
        <li aria-label={`${node.code ?? 'Node'} ${node.name}`} key={node.id}>
          <strong>{node.code ?? '—'}</strong> · {node.name}
          {node.parentId === undefined ? null : <span className="muted-copy"> (child node)</span>}
        </li>
      ))}
    </ul>
  );
}

type ShellStatePanelProps = {
  message: string | null;
  project: Project | null;
  state: ShellState;
  onRetry: () => void;
};

function ShellStatePanel({ message, project, state, onRetry }: ShellStatePanelProps) {
  if (state === 'loading') {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        aria-labelledby="loading-title"
        className="state-panel"
      >
        <h2 id="loading-title">Loading project context</h2>
        <p>Membership, scope, and project lifecycle are being revalidated.</p>
      </section>
    );
  }

  if (state === 'empty') {
    return (
      <section aria-labelledby="empty-title" className="state-panel">
        <h2 id="empty-title">No project context is available</h2>
        <p>Choose a workspace and project after membership has been granted.</p>
      </section>
    );
  }

  if (state === 'denied') {
    return (
      <section
        aria-labelledby="denied-title"
        className="state-panel state-panel-warning"
        role="alert"
      >
        <h2 id="denied-title">Permission denied</h2>
        <p>
          {message ??
            'Your membership or resource scope does not permit this project administration action.'}
        </p>
      </section>
    );
  }

  if (state === 'suspended') {
    return (
      <section
        aria-labelledby="suspended-title"
        className="state-panel state-panel-warning"
        role="alert"
      >
        <h2 id="suspended-title">This project is suspended</h2>
        <p>
          {project?.name ?? 'The selected project'} is read-only for business mutations while
          server-enforced suspension is active.
        </p>
      </section>
    );
  }

  if (state === 'archived') {
    return (
      <section aria-labelledby="archived-title" className="state-panel">
        <h2 id="archived-title">This project is archived</h2>
        <p>
          {project?.name ?? 'The selected project'} remains read-only. Restoration requires an
          authorized server transition and does not automatically activate the project.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="retry-title" className="state-panel state-panel-warning" role="alert">
      <h2 id="retry-title">Project context could not be loaded</h2>
      <p>
        {message ??
          'Retry only re-requests project context; it does not repeat a project mutation.'}
      </p>
      <button type="button" onClick={onRetry}>
        Retry loading project context
      </button>
    </section>
  );
}
