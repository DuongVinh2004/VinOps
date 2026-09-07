import {Pool} from 'pg';
const p=new Pool({connectionString:'postgresql://postgres:vinops-i6-local-secret@127.0.0.1:55446/vinops_mega002_test'});
for(const id of ['00000000-0000-4000-8000-000000000941','00000000-0000-4000-8000-00000000dead']){try{const q=await p.query(`SELECT id, project_id, code, purpose, status, created_by, created_at, issued_at, snapshot_sha256, version::text FROM vinops.transmittals WHERE id=$1::uuid`,[id]); console.log(id,q.rows)}catch(e){console.error('err',id,e)}} await p.end();
