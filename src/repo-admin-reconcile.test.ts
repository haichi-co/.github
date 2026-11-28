import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorize, assertCurrentMain, excluded, parseConfig, reconcile, type Config, type Reply, type Request, type RunContext } from './repo-admin-reconcile.ts';

const source = readFileSync('.github/repo-admin-reconcile.json', 'utf8');
parseConfig(source); // Actual deployment config is always validated; tests use portable fixture identities.
const disabled: Config = { enabled: false, apply_enabled: false, organization: {login:'fixture-org',id:10},
  central_repository:{name:'.github',id:10000}, owner:{login:'fixture-owner',id:11}, machine:{login:'fixture-machine',id:12},
  expected_base_permission:'write', app:{client_id:null,id:null,installation_id:null} };
const fixtureSource = JSON.stringify(disabled,null,2)+'\n';
const config: Config = { ...disabled, enabled: true, apply_enabled: true, app: { client_id: 'IvTestFixture', id: 911, installation_id: 912 } };
const sha = 'a'.repeat(40);
const run: RunContext = {
  repository: 'fixture-org/.github', repositoryId: String(config.central_repository.id),
  ownerId: String(config.organization.id), ref: 'refs/heads/main', event: 'workflow_dispatch',
  sha, checkedOutSha: sha, workflowRef: 'fixture-org/.github/.github/workflows/reconcile-repo-admin.yml@refs/heads/main', dryRun: 'true'
};
const appPermissions = { administration: 'write', metadata: 'read', members: 'read' };
const inventoryPermissions = { metadata: 'read', members: 'read' };
const writerPermissions = { administration: 'write', metadata: 'read' };
const central = config.central_repository.id;
const repo = (id: number, name: string, archived = false, disabled = false, privateRepo = true) => ({
  id, name, full_name: `fixture-org/${name}`, owner: config.organization, archived, disabled, private: privateRepo
});
type Repo = ReturnType<typeof repo>;
type Call = {token: string; method: string; path: string; body?: unknown};
type Hook = (call: Call, state: Fixture) => Reply | undefined;
class Fixture {
  repositories: Repo[] = [repo(central, '.github', false, false, false), repo(101, 'ready'), repo(102, 'new'), repo(103, 'archived', true), repo(104, 'disabled', false, true)];
  roles = new Map<number, string>([[central,'maintain'],[101,'admin'],[102,'write']]);
  calls: Call[] = [];
  created = new Map<string, {permissions: unknown; ids?: number[]}>();
  revoked: string[] = [];
  writes: number[] = [];
  freshnessChecks = 0;
  hook?: Hook;
  orgBase: string | null = 'write';
  machineRole = 'member';
  ownerRole = 'admin';
  appPerms: unknown = appPermissions;
  installationSelection = 'all';
  current = async () => { this.freshnessChecks++; };
  auth = () => 'fixture-jwt';
  request: Request = async (token, method, path, body) => {
    const call = {token,method,path,body}; this.calls.push(call);
    const response = this.hook?.(call, this);
    if (response) return response;
    const ok = (data: unknown): Reply => ({status: 200, data});
    if (path === '/app' && method === 'GET') {
      assert.equal(token, 'fixture-jwt');
      return ok({id: 911, client_id: 'IvTestFixture', owner:config.organization, public:false, events:[], permissions:this.appPerms});
    }
    if (path === '/app/installations/912' && method === 'GET') {
      assert.equal(token, 'fixture-jwt');
      return ok({id:912, app_id:911, target_id:config.organization.id, target_type:'Organization',
        account:config.organization, repository_selection:this.installationSelection, suspended_at:null, permissions:this.appPerms});
    }
    if (path === '/app/installations/912/access_tokens' && method === 'POST') {
      assert.equal(token, 'fixture-jwt');
      const value = body as {permissions: unknown; repository_ids?:number[]};
      const name = 'token-' + this.created.size;
      if (value.repository_ids) {
        assert.equal(value.repository_ids.length, 1);
        assert.notEqual(value.repository_ids[0], central);
        assert.deepEqual(value.permissions,writerPermissions);
      } else assert.deepEqual(value.permissions,inventoryPermissions);
      this.created.set(name,{permissions:value.permissions,ids:value.repository_ids});
      return {status:201,data:{token:name,permissions:value.permissions}};
    }
    assert(this.created.has(token),'Only installation tokens can call these endpoints');
    const scoped = this.created.get(token)!;
    if (method === 'DELETE' && path === '/installation/token') {
      this.revoked.push(token); return {status:204};
    }
    if (path.startsWith('/installation/repositories?')) {
      assert.equal(method,'GET');
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      const list = this.repositories.filter(r=>!scoped.ids || scoped.ids.includes(r.id));
      return ok({total_count:list.length,repositories:list.slice((page-1)*100,page*100)});
    }
    if (path === '/orgs/fixture-org') {
      assert.equal(method,'GET'); assert(!scoped.ids);
      return ok({...config.organization,default_repository_permission:this.orgBase,
        public_repos:this.repositories.filter(r=>!r.private).length,owned_private_repos:this.repositories.filter(r=>r.private).length});
    }
    if (path.startsWith('/orgs/fixture-org/memberships/')) {
      assert.equal(method,'GET'); assert(!scoped.ids);
      const owner = path.endsWith('/'+config.owner.login);
      return ok({state:'active',role:owner?this.ownerRole:this.machineRole,organization:config.organization,user:owner?config.owner:config.machine});
    }
    const m = path.match(/^\/repos\/fixture-org\/([^/]+)(?:\/collaborators\/fixture-machine(\/permission)?)?$/);
    assert(m,'unexpected test endpoint');
    const r = this.repositories.find(x=>x.name===m[1]);
    if (!r || (scoped.ids && !scoped.ids.includes(r.id))) return {status:404};
    if (path === '/repos/fixture-org/'+r.name) { assert.equal(method,'GET'); return ok(r); }
    if (m[2] && method === 'GET') {
      const role = this.roles.get(r.id) ?? 'write';
      return ok({role_name:role,permission:role==='maintain'?'write':role==='triage'?'read':role,user:config.machine});
    }
    assert.equal(method,'PUT'); assert(scoped.ids && scoped.ids.length===1 && scoped.ids[0]===r.id);
    assert(!excluded(config,r)); assert(!r.archived && !r.disabled);
    assert.deepEqual(body,{permission:'admin'});
    this.writes.push(r.id); this.roles.set(r.id,'admin'); return {status:204};
  };
  execute(dryRun = true, c = config) { return reconcile(c,dryRun,this.request,this.auth,this.current); }
  assertRevoked() { assert.deepEqual([...this.revoked].sort(),[...this.created.keys()].sort()); }
  writerCount() { return [...this.created.values()].filter(v=>v.ids).length; }
}

test('canonical config starts disabled with no App binding; rejects duplicates, invalid role and partial bindings',()=>{
  assert.equal(disabled.enabled,false); assert.equal(disabled.app.id,null);
  assert.throws(()=>parseConfig(fixtureSource.replace('"enabled": false,','"enabled": false,\n  "enabled": false,')));
  assert.throws(()=>parseConfig(fixtureSource.replace('"enabled": false','"enabled": true')));
  assert.throws(()=>parseConfig(fixtureSource.replace('"apply_enabled": false','"apply_enabled": true')));
  assert.throws(()=>parseConfig(fixtureSource.replace('"expected_base_permission": "write"','"expected_base_permission": "admin"')));
  assert.throws(()=>parseConfig(fixtureSource.replace('"client_id": null','"client_id": "IvTest"')));
  assert.deepEqual(parseConfig(JSON.stringify(config,null,2)+'\n'),config);
});

test('authorization fails closed on disabled, stale, copied, wrong id, branch, tag, workflow and trigger',()=>{
  assert.equal(authorize(disabled,run),false);
  assert.equal(authorize(config,run),true);
  for (const patch of [{repository:'another/.github'},{repositoryId:'7'},{ownerId:'7'},{ref:'refs/heads/branch'},
    {ref:'refs/tags/main'},{event:'pull_request'},{event:'pull_request_target'},{checkedOutSha:'b'.repeat(40)},
    {workflowRef:'wrong'},{dryRun:'1'}]) assert.throws(()=>authorize(config,{...run,...patch}));
  const dryOnly = {...config,apply_enabled:false};
  assert.equal(authorize(dryOnly,{...run,dryRun:'false'}),false);
  assert.equal(authorize(dryOnly,{...run,event:'schedule',dryRun:'false'}),false);
  assert.equal(authorize(dryOnly,run),true);
  assert.equal(authorize(config,{...run,event:'schedule',dryRun:'false'}),true);
});

test('current main must be the exact protected checkout and API denial fails closed', async()=>{
  const response = (protectedMain:boolean, head:string, privateRepo=false): Request => async(_token,_method,path)=>({status:200,data:path.endsWith('/branches/main')?{name:'main',protected:protectedMain,commit:{sha:head}}:repo(central,'.github',false,false,privateRepo)});
  await assertCurrentMain(config,run,response(true,sha),'read');
  await assert.rejects(assertCurrentMain(config,run,response(false,sha),'read'));
  await assert.rejects(assertCurrentMain(config,run,response(true,sha,true),'read'));
  await assert.rejects(assertCurrentMain(config,run,response(true,'b'.repeat(40)),'read'));
  await assert.rejects(assertCurrentMain(config,run,async()=>({status:403}),'read'));
});

test('dry run discovers all classes and mints only one read-only token; no writes',async()=>{
  const f=new Fixture();
  assert.deepEqual(await f.execute(), {dry_run:true,inventory:5,excluded:1,archived:1,disabled:1,already_admin:1,planned:1,applied:0,converged_during_apply:0});
  assert.equal(f.writerCount(),0); assert.deepEqual(f.writes,[]); f.assertRevoked();
});

test('apply scopes writer by immutable ID, verifies grant, then repeats with zero writes or writer tokens',async()=>{
  const f=new Fixture();
  const result=await f.execute(false); assert.equal(result.applied,1);
  assert.deepEqual(f.writes,[102]); assert.equal(f.roles.get(central),'maintain');
  assert.deepEqual(f.created.get('token-1')?.ids,[102]); f.assertRevoked();
  const prior=f.created.size;
  const next=await f.execute(false); assert.equal(next.planned,0); assert.equal(next.applied,0);
  assert.equal(f.created.size,prior+1); assert.deepEqual(f.writes,[102]); f.assertRevoked();
});

test('dry-run-only apply denied before API/auth tokens',async()=>{
  const f=new Fixture();
  await assert.rejects(f.execute(false,{...config,apply_enabled:false}));
  assert.equal(f.calls.length,0);
});
test('exclude both stable ID and case-insensitive .github even when original central is renamed',async()=>{
  const f=new Fixture();
  f.repositories[0]=repo(central,'renamed-central',false,false,false);
  f.repositories.push(repo(105,'.GiThUb',false,false,false));
  assert.equal(excluded(config,f.repositories[0]),true);
  assert.equal(excluded(config,f.repositories.at(-1)!),true);
  const value=await f.execute(false);
  assert.equal(value.excluded,2); assert.deepEqual(f.writes,[102]); f.assertRevoked();
});
test('empty inventory or missing pinned central fails even if similarly named repo exists',async()=>{
  for (const rows of [[],[repo(199,'.github')]]) {
    const f=new Fixture(); f.repositories=rows;
    await assert.rejects(f.execute(false),/Central repository missing/);
    assert.equal(f.writerCount(),0); f.assertRevoked();
  }
});
test('read-only inventory handles 100+ repositories and stable pagination',async()=>{
  const f=new Fixture();
  for(let i=0;i<101;i++) { f.repositories.push(repo(1000+i,'repo-'+i)); f.roles.set(1000+i,'admin'); }
  const result=await f.execute();
  assert.equal(result.inventory,106); assert.equal(result.already_admin,102);
  assert(f.calls.some(c=>c.path.endsWith('page=2'))); f.assertRevoked();
});
test('incomplete pagination, duplicate IDs/names, owner mismatch and missing metadata stop before any writer',async()=>{
  for(const mutate of [
    (f:Fixture)=>{f.hook=c=>c.path.startsWith('/installation/repositories?')?{status:200,data:{total_count:6,repositories:f.repositories}}:undefined;},
    (f:Fixture)=>{f.repositories.push(repo(102,'duplicate-id'));},
    (f:Fixture)=>{f.repositories.push(repo(199,'NEW'));},
    (f:Fixture)=>{f.repositories[2]={...f.repositories[2],owner:{id:1,login:'foreign'}};},
    (f:Fixture)=>{delete (f.repositories[2] as Partial<Repo>).disabled;},
    (f:Fixture)=>{f.hook=c=>c.path==='/orgs/fixture-org'?{status:200,data:{...config.organization,public_repos:1,owned_private_repos:9}}:undefined;}
  ]) {
    const f=new Fixture();mutate(f); await assert.rejects(f.execute(false)); assert.equal(f.writerCount(),0); assert.deepEqual(f.writes,[]);f.assertRevoked();
  }
});
test('App identity, excessive scope and selected installation rejected before mint',async()=>{
  for(const mutate of [
    (f:Fixture)=>{f.appPerms={...appPermissions,contents:'write'};},
    (f:Fixture)=>{f.installationSelection='selected';},
    (f:Fixture)=>{f.hook=c=>c.path==='/app'?{status:200,data:{id:999}}:undefined;},
    (f:Fixture)=>{f.hook=c=>c.path==='/app/installations/912'?{status:200,data:{id:912,app_id:911,target_id:999}}:undefined;}
  ]) { const f=new Fixture();mutate(f);await assert.rejects(f.execute(false));assert.equal(f.created.size,0); }
});
test('membership, base role and central effective permission drift reject before minting Admin',async()=>{
  for(const mutate of [
    (f:Fixture)=>{f.machineRole='admin';},
    (f:Fixture)=>{f.ownerRole='member';},
    (f:Fixture)=>{f.orgBase='admin';},
    (f:Fixture)=>{f.roles.set(central,'admin');},
    (f:Fixture)=>{f.hook=c=>c.path.endsWith('/memberships/fixture-machine')?{status:200,data:{state:'active',role:'member',organization:config.organization,user:{...config.machine,id:10}}}:undefined;},
    (f:Fixture)=>{f.hook=c=>c.path==='/orgs/fixture-org'?{status:200,data:{id:999,login:'fixture-org',public_repos:1,owned_private_repos:4}}:undefined;}
  ]) {const f=new Fixture();mutate(f);await assert.rejects(f.execute(false));assert.equal(f.writerCount(),0);f.assertRevoked();}
});
test('missing base metadata does not manufacture exact proof: non-owner plus central Maintain still required',async()=>{
  const f=new Fixture();f.orgBase=null;
  assert.equal((await f.execute()).planned,1);f.assertRevoked();
  f.roles.set(central,'admin');await assert.rejects(f.execute(false));assert.equal(f.writerCount(),0);f.assertRevoked();
});
test('unknown role, inconsistent ID, and API denied discovery are not treated as non-admin',async()=>{
  for(const response of [{status:403},{status:404},{status:200,data:{user:{...config.machine,id:9},permission:'write',role_name:'write'}},
    {status:200,data:{user:config.machine,permission:'write',role_name:'custom'}},{status:200,data:{user:config.machine,permission:'admin',role_name:'maintain'}}]) {
    const f=new Fixture(); f.hook=c=>c.path.endsWith('/new/collaborators/fixture-machine/permission')?response:undefined;
    await assert.rejects(f.execute(false));assert.equal(f.writerCount(),0);f.assertRevoked();
  }
});
test('transfer or rename race before writer mint fails closed',async()=>{
  const f=new Fixture();let reads=0;
  f.hook=c=>{if (c.path==='/repos/fixture-org/new' && ++reads===2) return {status:200,data:{...f.repositories[2],owner:{login:'other',id:999}}};};
  await assert.rejects(f.execute(false));assert.equal(f.writerCount(),0);f.assertRevoked();
});
test('writer token unexpectedly covers another repo or central: revoke, do not write',async()=>{
  const f=new Fixture();
  f.hook=c=>c.token==='token-1' && c.path.startsWith('/installation/repositories?')?{status:200,data:{total_count:2,repositories:[f.repositories[0],f.repositories[2]]}}:undefined;
  await assert.rejects(f.execute(false),/Writer token scope mismatch/);
  assert.equal(f.writerCount(),1);assert.deepEqual(f.writes,[]);f.assertRevoked();
});
test('writer response excess privileges: revoke before target read or write',async()=>{
  const f=new Fixture();
  f.hook=c=>{
    if(c.method==='POST' && (c.body as {repository_ids?:number[]}).repository_ids) {
      f.created.set('bad-token',{permissions:{...writerPermissions,contents:'write'},ids:[102]});
      return {status:201,data:{token:'bad-token',permissions:{...writerPermissions,contents:'write'}}};
    }
  };
  await assert.rejects(f.execute(false));assert.deepEqual(f.writes,[]);f.assertRevoked();
});
test('race after token mint: renamed/replaced/disabled target denied, and token revoked',async()=>{
  for(const changed of [repo(999,'new'),repo(102,'changed'),repo(102,'new',false,true)]) {
    const f=new Fixture(); f.hook=c=>c.token==='token-1' && c.path==='/repos/fixture-org/new'?{status:200,data:changed}:undefined;
    await assert.rejects(f.execute(false));assert.deepEqual(f.writes,[]);f.assertRevoked();
  }
});
test('already Admin between plan and apply skips writer',async()=>{
  const f=new Fixture();let reads=0;
  f.hook=c=>{if(c.path.endsWith('/new/collaborators/fixture-machine/permission')&&++reads===2){f.roles.set(102,'admin');}return undefined;};
  const result=await f.execute(false);assert.equal(result.converged_during_apply,1);assert.equal(f.writerCount(),0);f.assertRevoked();
});
test('201 invitation and forbidden PUT fail closed, revoke tokens, do not retry',async()=>{
  for(const status of [201,403,500]) {
    const f=new Fixture();f.hook=c=>c.method==='PUT'?{status}:undefined;
    await assert.rejects(f.execute(false));assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);f.assertRevoked();
  }
});
test('successful PUT without converged effective role is an error, not silently successful',async()=>{
  const f=new Fixture(); f.hook=c=>c.method==='PUT'?{status:204}:undefined;
  await assert.rejects(f.execute(false),/Grant read-back did not converge/);f.assertRevoked();
});
test('stale main detected after plan prevents writer mint; stale after writer mint prevents PUT',async()=>{
  for(const failAt of [2,3,4,5]){
    const f=new Fixture();f.current=async()=>{if(++f.freshnessChecks===failAt)throw new Error('stale');};
    await assert.rejects(f.execute(false));assert.deepEqual(f.writes,[]); assert.equal(f.writerCount(),failAt<=3?0:1); f.assertRevoked();
  }
});
test('revocation failure fails run rather than recording success',async()=>{
  const f=new Fixture();f.hook=c=>c.method==='DELETE'&&c.token==='token-1'?{status:500}:undefined;
  await assert.rejects(f.execute(false));assert.equal(f.writes.length,1);assert(f.revoked.includes('token-0'));
});
