import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderServicePlanIam, writeServicePlanIam} from '../prepare-service-plan-iam.mjs';

const account='123456789012'; // 문서용 계정이며 실제 계정이 아니다.
const files=renderServicePlanIam(account);
const policy=name=>JSON.parse(files[name+'.json']);
const array=value=>[value].flat();
const allows=name=>policy(name).Statement.filter(s=>s.Effect==='Allow');
const bucket=`arn:aws:s3:::orderpage-devops-tfstate-${account}-ap-northeast-2`;
const state=bucket+'/orderpage/dev/terraform.tfstate';
const lock=state+'.tflock';

test('신뢰 대상과 사용자가 전환할 Role을 각각 하나로 한정',()=>{
  assert.equal(policy('trust').Statement.length,1);
  const trust=policy('trust').Statement[0];
  assert.equal(trust.Action,'sts:AssumeRole');
  assert.deepEqual(trust.Principal,{AWS:`arn:aws:iam::${account}:user/orderpage-operator`});
  const assume=allows('operator-assume');
  assert.equal(assume.length,1);
  assert.equal(assume[0].Action,'sts:AssumeRole');
  assert.equal(assume[0].Resource,`arn:aws:iam::${account}:role/orderpage-terraform-deploy`);
});

test('state 객체 경로가 backend와 같고 다른 workspace·버킷에 쓰지 않는다',()=>{
  const backend=files['backend.hcl'];
  const key=backend.match(/^key\s*=\s*"([^"]+)"/m)?.[1];
  const name=backend.match(/^bucket\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal('arn:aws:s3:::'+name,bucket);
  assert.equal(bucket+'/'+key,state);
  assert.match(backend,/use_lockfile\s*=\s*true/);
  for(const s of allows('state-access')){
    assert.deepEqual(s.Condition,{StringEquals:{'s3:ResourceAccount':account}});
    if(array(s.Action).some(a=>a==='s3:PutObject'))assert.ok([state,lock].includes(s.Resource));
    assert.ok(!s.Resource.includes('*'));
  }
  assert.deepEqual(allows('state-access').filter(s=>array(s.Action).includes('s3:PutObject')).map(s=>s.Resource).sort(),[state,lock].sort());
});

test('잠금 해제 DeleteObject만 허용하고 실제 state 및 과거 버전 삭제는 거부',()=>{
  const deletion=allows('state-access').filter(s=>array(s.Action).some(a=>a.startsWith('s3:Delete')));
  assert.equal(deletion.length,1);
  assert.equal(deletion[0].Resource,lock);
  assert.ok(!array(deletion[0].Action).includes('s3:DeleteObjectVersion'));
  const deny=policy('state-access').Statement.find(s=>s.Sid==='DenyDeletingStateHistory');
  assert.equal(deny.Effect,'Deny');
  assert.equal(deny.Resource,state);
  assert.deepEqual(deny.Action,['s3:DeleteObject','s3:DeleteObjectVersion']);
});

test('state 버킷의 공개화·수명주기 변경 및 HTTP 접근을 거부',()=>{
  const statements=policy('state-access').Statement;
  const protection=statements.find(s=>s.Sid==='DenyChangingStateBucketProtection');
  assert.equal(protection.Effect,'Deny');
  assert.equal(protection.Resource,bucket);
  for(const action of ['s3:DeleteBucket','s3:PutBucketPolicy','s3:PutBucketPublicAccessBlock','s3:PutLifecycleConfiguration','s3:PutBucketVersioning'])assert.ok(protection.Action.includes(action));
  const tls=statements.find(s=>s.Sid==='DenyInsecureStateRequests');
  assert.equal(tls.Effect,'Deny');
  assert.equal(tls.Action,'s3:*');
  assert.deepEqual(tls.Resource,[bucket,bucket+'/*']);
  assert.deepEqual(tls.Condition,{Bool:{'aws:SecureTransport':'false'}});
});

test('서비스 plan 조회 정책은 생성·삭제·PassRole·추가 AssumeRole 권한이 없다',()=>{
  const sensitive=/^(secretsmanager|ssm|sts):|GetSecretValue|GetAuthorizationToken|GetLogEvents|FilterLogEvents|ExportCertificate|GetObject/;
  for(const s of allows('plan-read'))for(const action of array(s.Action)){
    assert.match(action,/^[a-z0-9]+:(Get|List|Describe|View)[A-Za-z]+$/);
    assert.ok(!action.includes('*'));
    assert.ok(!sensitive.test(action),'Unexpected sensitive read: '+action);
  }
});

test('범용 메타데이터 조회는 서울로, 글로벌 조회는 프로젝트 ARN으로 제한',()=>{
  for(const s of allows('plan-read')){
    if(s.Resource==='*'){
      assert.deepEqual(s.Condition,{StringEquals:{'aws:RequestedRegion':'ap-northeast-2'}});
      assert.ok(array(s.Action).every(a=>!a.startsWith('iam:')&&!a.startsWith('s3:')&&!a.startsWith('budgets:')));
    }else{
      for(const resource of array(s.Resource)){
        assert.ok(resource.includes(account));
        if(resource.startsWith('arn:aws:ec2:')){
          assert.equal(s.Condition.StringEquals['aws:RequestedRegion'],'ap-northeast-2');
          assert.equal(s.Condition.StringEquals['aws:ResourceTag/Project'],'orderpage');
          assert.equal(s.Condition.StringEquals['aws:ResourceTag/Environment'],'dev');
        }else assert.ok(resource.includes('orderpage-')||resource.includes('oidc.eks.ap-northeast-2.amazonaws.com/id/'));
        assert.ok(!resource.includes(':root'));
      }
    }
  }
});

test('실제 값 생성 시 정책 크기·플레이스홀더·프로필 인증 경로 검사',()=>{
  for(const [name,content]of Object.entries(files)){
    assert.ok(!content.includes('{{')&&!content.includes('<account-id>'));
    if(name.endsWith('.json'))assert.ok(JSON.stringify(JSON.parse(content)).length<=6144);
    assert.doesNotMatch(content,/aws_access_key_id|aws_secret_access_key|aws_session_token/);
  }
  assert.match(files['profile.example.ini'],/source_profile = orderpage-lab/);
  assert.match(files['profile.example.ini'],/role\/orderpage-terraform-deploy/);
  for(const bad of [null,undefined,123456789012,'','000000000000','123456789012\n','../../outside','123456789012"'])assert.throws(()=>renderServicePlanIam(bad));
});

test('기존 산출물을 덮어쓰지 않고 bootstrap 파일도 변경하지 않는다',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'orderpage-service-iam-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  fs.mkdirSync(path.join(temp,'.local/iam-bootstrap'),{recursive:true});
  fs.writeFileSync(path.join(temp,'.local/iam-bootstrap/sentinel'),'keep');
  assert.equal(writeServicePlanIam(account,temp).length,6);
  const output=path.join(temp,'.local/iam-service-plan/state-access.json');
  const original=fs.readFileSync(output,'utf8');
  assert.throws(()=>writeServicePlanIam('111122223333',temp));
  assert.equal(fs.readFileSync(output,'utf8'),original);
  assert.equal(fs.readFileSync(path.join(temp,'.local/iam-bootstrap/sentinel'),'utf8'),'keep');
  assert.deepEqual(fs.readdirSync(temp),['.local']);
});
