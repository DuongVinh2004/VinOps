import { Pool } from 'pg';

const ids = {
  owner: '00000000-0000-4000-8000-000000009101',
  outsider: '00000000-0000-4000-8000-000000009102',
  organization: '00000000-0000-4000-8000-000000009201',
  project: '00000000-0000-4000-8000-000000009301',
  organizationMembership: '00000000-0000-4000-8000-000000009501',
  projectMembership: '00000000-0000-4000-8000-000000009601',
  projectScope: '00000000-0000-4000-8000-000000009611',
};
const passwordHash =
  'scrypt$16384$8$1$mhKrKrTNBvso9YoXUUncrA$8fAmppJNc4kLdS9jFb23q9lcJ1wT_tzpcMXItgyIxpv-3-qE07022plKl9PnaE4XmPZbzzCjqVUOThNec1B1dA';
const pool = new Pool({
  connectionString:
    'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_i2_test9',
  max: 1,
  application_name: 'vinops-mega002-i9-runtime-seed',
});
try {
  await pool.query(
    `INSERT INTO vinops.users (id,email_normalized,display_name,password_hash) VALUES
      ($1::uuid,'i9-owner@vinops.test','I9 Owner',$3),
      ($2::uuid,'i9-outsider@vinops.test','I9 Outsider',$3)
     ON CONFLICT (id) DO NOTHING`,
    [ids.owner, ids.outsider, passwordHash],
  );
  await pool.query(
    `INSERT INTO vinops.organizations (id,code,name,created_by)
     VALUES ($1::uuid,'I9-ORG','I9 Task Organization',$2::uuid)
     ON CONFLICT (id) DO NOTHING`,
    [ids.organization, ids.owner],
  );
  await pool.query(
    `INSERT INTO vinops.organization_members (id,organization_id,user_id,roles,status)
     VALUES ($1::uuid,$2::uuid,$3::uuid,ARRAY['organization_owner'],'Active')
     ON CONFLICT (organization_id,user_id) DO NOTHING`,
    [ids.organizationMembership, ids.organization, ids.owner],
  );
  await pool.query(
    `INSERT INTO vinops.projects (id,organization_id,code,name,timezone,status,created_by)
     VALUES ($1::uuid,$2::uuid,'I9-PROJECT','I9 Task Project','Asia/Bangkok','Active',$3::uuid)
     ON CONFLICT (id) DO NOTHING`,
    [ids.project, ids.organization, ids.owner],
  );
  await pool.query(
    `INSERT INTO vinops.project_members (
       id,organization_id,project_id,user_id,roles,status,valid_from
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,ARRAY['project_admin','document_controller'],'Active',now())
     ON CONFLICT (project_id,user_id) DO NOTHING`,
    [ids.projectMembership, ids.organization, ids.project, ids.owner],
  );
  await pool.query(
    `INSERT INTO vinops.member_scopes (
       id,organization_id,project_id,project_member_id,scope_type,scope_id,actions
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'project',$3::uuid,
       ARRAY['read','document.create','revision.create','revision.submit','revision.publish','revision.withdraw','comment.dispose','annotation.create','transmittal.create'])
     ON CONFLICT (project_member_id,scope_type,scope_id) DO NOTHING`,
    [ids.projectScope, ids.organization, ids.project, ids.projectMembership],
  );
  console.log(JSON.stringify({ status: 'PASS', ids }));
} finally {
  await pool.end();
}
