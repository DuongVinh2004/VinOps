-- ============================================================================
-- Migration: 018_realtime_push_notification.sql
-- Description: Realtime Infrastructure, User Device Tokens, Push Notification Audit,
--              Notification Preferences, and Active Connection Subscriptions.
-- ============================================================================

-- 1. User Device Tokens (Capacitor FCM / APNs Push Endpoints)
CREATE TABLE vinops.user_device_tokens (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES vinops.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android_fcm', 'ios_apns', 'web_push')),
  device_token text NOT NULL,
  device_name text NOT NULL DEFAULT '',
  device_model text NOT NULL DEFAULT '',
  app_version text NOT NULL DEFAULT '',
  os_version text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, device_token),
  CHECK (length(trim(device_token)) BETWEEN 10 AND 4096)
);

CREATE INDEX idx_user_device_tokens_lookup ON vinops.user_device_tokens (user_id, status, platform);

-- 2. Notification Preferences (Per-user, per-project notification fine-tuning)
CREATE TABLE vinops.notification_preferences (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES vinops.users(id) ON DELETE CASCADE,
  event_category text NOT NULL CHECK (event_category IN ('field_issue', 'rfi', 'submittal', 'inspection', 'daily_log', 'document', 'system')),
  channel_web boolean NOT NULL DEFAULT true,
  channel_push boolean NOT NULL DEFAULT true,
  channel_email boolean NOT NULL DEFAULT false,
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, user_id, event_category)
);

CREATE INDEX idx_notif_prefs_lookup ON vinops.notification_preferences (project_id, user_id, event_category);

-- 3. Push Notification Delivery Audit Log
CREATE TABLE vinops.push_notification_log (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  device_token_id uuid REFERENCES vinops.user_device_tokens(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'expired')),
  provider_message_id text,
  failure_reason text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);

CREATE INDEX idx_push_notif_log_query ON vinops.push_notification_log (project_id, user_id, status, created_at DESC);
CREATE INDEX idx_push_notif_log_event ON vinops.push_notification_log (event_id);

-- 4. Realtime Subscriptions (Active WS / SSE Live Connections Tracker)
CREATE TABLE vinops.realtime_subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES vinops.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES vinops.projects(id) ON DELETE CASCADE,
  channel text NOT NULL,
  transport text NOT NULL CHECK (transport IN ('websocket', 'sse')),
  server_instance text NOT NULL,
  last_event_id uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  CHECK (length(trim(channel)) BETWEEN 2 AND 255),
  CHECK (length(trim(server_instance)) BETWEEN 2 AND 100)
);

CREATE INDEX idx_realtime_subs_active ON vinops.realtime_subscriptions (project_id, channel, disconnected_at) WHERE disconnected_at IS NULL;
CREATE INDEX idx_realtime_subs_user ON vinops.realtime_subscriptions (user_id, transport);

-- ============================================================================
-- Triggers
-- ============================================================================
CREATE TRIGGER trg_user_device_tokens_touch BEFORE UPDATE ON vinops.user_device_tokens FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER trg_user_device_tokens_no_delete BEFORE DELETE ON vinops.user_device_tokens FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER trg_notification_preferences_touch BEFORE UPDATE ON vinops.notification_preferences FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER trg_notification_preferences_no_delete BEFORE DELETE ON vinops.notification_preferences FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER trg_push_notification_log_no_delete BEFORE DELETE ON vinops.push_notification_log FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();
CREATE TRIGGER trg_realtime_subscriptions_no_delete BEFORE DELETE ON vinops.realtime_subscriptions FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- ============================================================================
-- Row Level Security (RLS) Configuration
-- ============================================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'user_device_tokens',
    'notification_preferences',
    'push_notification_log',
    'realtime_subscriptions'
  ]) LOOP
    EXECUTE format('ALTER TABLE vinops.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END;
$$;

CREATE POLICY user_device_tokens_user_scoped ON vinops.user_device_tokens
  USING (user_id = vinops.current_actor_id() OR vinops.is_system_admin())
  WITH CHECK (user_id = vinops.current_actor_id() OR vinops.is_system_admin());

CREATE POLICY notification_preferences_tenant ON vinops.notification_preferences
  USING (vinops.can_access_project(project_id) AND (user_id = vinops.current_actor_id() OR vinops.is_system_admin()))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY push_notification_log_tenant ON vinops.push_notification_log
  USING (vinops.can_access_project(project_id) AND (user_id = vinops.current_actor_id() OR vinops.is_system_admin()))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY realtime_subscriptions_tenant ON vinops.realtime_subscriptions
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

-- Role Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON vinops.user_device_tokens TO vinops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON vinops.notification_preferences TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.push_notification_log TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.realtime_subscriptions TO vinops_app;

GRANT SELECT, INSERT, UPDATE ON vinops.push_notification_log TO vinops_worker;
GRANT SELECT ON vinops.user_device_tokens, vinops.notification_preferences TO vinops_worker;
