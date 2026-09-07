const api='http://127.0.0.1:4610';
const u='00000000-0000-4000-8000-000000000921';
const malformed={bad:true};
const unauth=await fetch(`${api}/api/v1/upload-sessions/${u}/complete`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'i7-unauth-0001'},body:JSON.stringify(malformed)}); console.log('unauth',unauth.status,await unauth.text());
const l=await fetch(api+'/api/v1/auth/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@vinops.test',password:'VinOps-Mega002!',device_name:'i7-probe'})});const b=await l.json();
const auth=await fetch(`${api}/api/v1/upload-sessions/${u}/complete`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+b.access_token,'idempotency-key':'i7-auth-0001'},body:JSON.stringify(malformed)}); console.log('auth',auth.status,await auth.text());
const t=await fetch(`${api}/api/v1/transmittals/00000000-0000-4000-8000-000000000941`,{headers:{authorization:'Bearer '+b.access_token}}); console.log('trans',t.status,await t.text());
