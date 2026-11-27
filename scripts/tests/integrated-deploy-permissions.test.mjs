import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collectDeploySources,packPolicies,renderIntegratedPermissions,writeIntegratedPermissions,statementBody} from '../prepare-integrated-deploy-permissions.mjs';
import {apiDomain} from '../prepare-remaining-service-permissions.mjs';
import {evaluate} from './helpers/delegation-policy-evaluator.mjs';
import {renderAuditPermissions,renderArtifactCleanupPermissions,renderJenkinsTunnelPermissions} from '../prepare-operator-review-permissions.mjs';
const account='123456789012',input={accountId:account,email:'operator@example.invalid',kubernetesVersion:'1.35',jenkinsAmi:'ami-0123456789abcdef0'};
const sources=collectDeploySources(input),packed=packPolicies(sources),docs=Object.values(packed.files);
const arn=(s,r)=>`arn:aws:${s}:ap-northeast-2:${account}:${r}`;
const tags={'aws:RequestTag/Project':'orderpage','aws:RequestTag/Environment':'dev','aws:RequestTag/ManagedBy':'terraform'};
const context={'aws:PrincipalAccount':account,'aws:RequestedRegion':'ap-northeast-2','aws:SecureTransport':'true'};
const topic=arn('sns','orderpage-dev-operations'),bucket=`arn:aws:s3:::orderpage-dev-product-images-${account}`;
const run=(action,resource,extra={})=>{
  const request={action,resource,context:{...context,...extra}},actual=evaluate(docs,request);
  assert.equal(actual,evaluate(Object.values(sources),request),'통합 전후 권한 결과');return actual;
};
test('모든 문장을 보존하면서 정책 크기·수 제한을 지키고 결정적으로 출력한다',()=>{
  const manifest=JSON.parse(renderIntegratedPermissions(input)['manifest.json']);
  assert.ok(manifest.attachedPolicyCount<=20);assert.equal(manifest.sourceCount,22);
  assert.equal(manifest.readyForApply,false);assert.equal(manifest.actualAccountQuotaVerified,false);
  for(const d of docs)assert.ok(JSON.stringify(d).length<=6144);
  const bodies=ds=>[...new Set(ds.flatMap(d=>d.Statement.map(s=>JSON.stringify(statementBody(s)))))].sort();
  assert.deepEqual(bodies(docs),bodies(Object.values(sources)));
  assert.deepEqual(renderIntegratedPermissions(input),renderIntegratedPermissions(input));
});
test('정책 병합이 Action과 Resource의 새로운 조합을 허용하지 않는다',()=>{
  const input={one:{Statement:[{Effect:'Allow',Action:'s3:GetObject',Resource:'arn:aws:s3:::a/*'},{Effect:'Allow',Action:'s3:DeleteObject',Resource:'arn:aws:s3:::b/*'}]}};
  const result=Object.values(packPolicies(input).files);
  assert.equal(evaluate(result,{action:'s3:DeleteObject',resource:'arn:aws:s3:::a/object'}),'implicitDeny');
  assert.throws(()=>packPolicies({x:{Statement:[{Effect:'Allow',Action:'s3:GetObject',Resource:'x'.repeat(6200)}]}}));
});
test('S3 상태 파일은 보호하면서 잠금 해제와 지정 상품 버킷 설정을 허용한다',()=>{
  const state=`arn:aws:s3:::orderpage-devops-tfstate-${account}-ap-northeast-2`;
  // 실제 state key는 기존 정책에서 가져오되 보안 요구는 독립적으로 검증한다.
  const stateDoc=sources['state-access.json'];const protectedStatement=stateDoc.Statement.find(s=>s.Effect==='Deny'&&[].concat(s.Action).includes('s3:DeleteObject'));
  const stateObject=[].concat(protectedStatement.Resource)[0];
  assert.ok(stateObject.startsWith(state+'/'));
  assert.equal(run('s3:DeleteObject',stateObject,{'s3:ResourceAccount':account}),'explicitDeny');
  assert.equal(run('s3:DeleteObject',stateObject+'.tflock',{'s3:ResourceAccount':account}),'allowed');
  assert.equal(run('s3:CreateBucket',bucket,{'s3:locationconstraint':'ap-northeast-2'}),'allowed');
  assert.equal(run('s3:CreateBucket',bucket,{'s3:locationconstraint':'us-east-1'}),'implicitDeny');
  assert.equal(run('s3:PutBucketPolicy',bucket,{'s3:ResourceAccount':account}),'allowed');
  assert.equal(run('s3:PutBucketPolicy',state,{'s3:ResourceAccount':account}),'explicitDeny');
  assert.equal(run('s3:PutBucketPolicy',bucket,{'s3:ResourceAccount':account,'aws:SecureTransport':'false'}),'explicitDeny');
  assert.equal(run('s3:DeleteObject',bucket+'/test.jpg'),'implicitDeny');
});
test('ECR 저장소 설정과 이미지 업로드·삭제 권한을 구분한다',()=>{
  const repo=arn('ecr','repository/orderpage-backend');
  assert.equal(run('ecr:CreateRepository',repo,tags),'allowed');
  for(const action of ['DeleteRepository','PutLifecyclePolicy','DeleteLifecyclePolicy','PutImageTagMutability','PutImageScanningConfiguration'])assert.equal(run('ecr:'+action,repo),'allowed');
  for(const action of ['PutImage','BatchDeleteImage','InitiateLayerUpload'])assert.equal(run('ecr:'+action,repo),'implicitDeny');
  assert.equal(run('ecr:CreateRepository',arn('ecr','repository/other'),tags),'implicitDeny');
});
test('ACM은 확정 도메인·DNS만 허용하고 SAN 우회와 유료 export를 거부한다',()=>{
  const c={...tags,'acm:DomainNames':[apiDomain],'acm:ValidationMethod':'DNS'};
  assert.equal(run('acm:RequestCertificate','*',c),'allowed');
  for(const domains of [[],[apiDomain,'other.example.invalid'],['*.auctionbid.shop']])assert.equal(run('acm:RequestCertificate','*',{...c,'acm:DomainNames':domains}),'implicitDeny');
  assert.equal(run('acm:RequestCertificate','*',{...c,'acm:ValidationMethod':'EMAIL'}),'implicitDeny');
  assert.equal(run('acm:RequestCertificate','*',{...c,'acm:Export':'ENABLED'}),'explicitDeny');
  assert.equal(run('acm:RequestCertificate','*',{...c,'aws:RequestedRegion':'us-east-1'}),'implicitDeny');
});
test('SNS 구독 주소·프로토콜과 알림 목적지를 제한한다',()=>{
  assert.equal(run('sns:Subscribe',topic,{'sns:Protocol':'email','sns:Endpoint':input.email}),'allowed');
  assert.equal(run('sns:Subscribe',topic,{'sns:Protocol':'email','sns:Endpoint':'other@example.invalid'}),'implicitDeny');
  assert.equal(run('sns:Subscribe',topic,{'sns:Protocol':'https','sns:Endpoint':input.email}),'implicitDeny');
  for(const action of ['GetSubscriptionAttributes','SetSubscriptionAttributes','Unsubscribe'])assert.equal(run('sns:'+action,topic),'allowed');
  const alarm=arn('cloudwatch','alarm:orderpage-dev-rds-cpu');
  assert.equal(run('cloudwatch:PutMetricAlarm',alarm,{'cloudwatch:AlarmActions':[topic]}),'allowed');
  for(const actions of [[],[topic,arn('sns','other')]])assert.equal(run('cloudwatch:PutMetricAlarm',alarm,{'cloudwatch:AlarmActions':actions}),'implicitDeny');
});
test('로그 ARN 형식과 리전 단위 전달 권한의 한계를 명시적으로 검증한다',()=>{
  const log=arn('logs','log-group:/aws/eks/orderpage-dev/cluster');
  assert.equal(run('logs:CreateLogGroup',log+':*',tags),'allowed');
  assert.equal(run('logs:TagResource',log,tags),'allowed');
  assert.equal(run('logs:PutRetentionPolicy',log+':*'),'allowed');
  assert.equal(run('logs:PutResourcePolicy','*'),'allowed');
  assert.equal(run('logs:PutResourcePolicy','*',{'aws:RequestedRegion':'us-east-1'}),'implicitDeny');
  assert.equal(run('logs:DeleteLogGroup',arn('logs','log-group:/other:*')),'implicitDeny');
});
test('비용 조회와 단일 Budget 관리만 허용하고 anomaly·자동 실행을 거부한다',()=>{
  assert.equal(run('ce:GetCostAndUsage','*',{'aws:RequestedRegion':'us-east-1'}),'allowed');
  assert.equal(run('ce:GetCostAndUsage','*'),'implicitDeny');
  const budget=`arn:aws:budgets::${account}:budget/orderpage-dev-account-monthly`;
  assert.equal(run('budgets:ModifyBudget',budget,{'aws:RequestedRegion':'us-east-1'}),'allowed');
  assert.equal(run('budgets:ModifyBudget',budget+'-other'),'implicitDeny');
  assert.equal(run('ce:CreateAnomalyMonitor','*'),'explicitDeny');
  assert.equal(run('budgets:ExecuteBudgetAction',budget),'explicitDeny');
});
test('기존 IAM 보호·SLR·OIDC 단계가 서비스 권한 추가로 무력화되지 않는다',()=>{
  for(const role of ['orderpage-terraform-deploy','orderpage-terraform-bootstrap','orderpage-eks-operator'])assert.equal(run('iam:AttachRolePolicy',`arn:aws:iam::${account}:role/${role}`),'explicitDeny');
  assert.equal(run('iam:CreateAccessKey',`arn:aws:iam::${account}:user/orderpage-operator`),'explicitDeny');
  const provider=`arn:aws:iam::${account}:oidc-provider/oidc.eks.ap-northeast-2.amazonaws.com/id/${'A'.repeat(32)}`;
  assert.equal(run('iam:CreateOpenIDConnectProvider',provider),'explicitDeny');
  const bound={...input,oidcCluster:{name:'orderpage-dev',arn:arn('eks','cluster/orderpage-dev'),status:'ACTIVE',identity:{oidc:{issuer:'https://oidc.eks.ap-northeast-2.amazonaws.com/id/'+'A'.repeat(32)}}}};
  const boundSources=collectDeploySources(bound),boundPacked=packPolicies(boundSources);
  assert.ok(Object.keys(boundPacked.files).length<=20);
  const request={action:'iam:CreateOpenIDConnectProvider',resource:provider,context:{...context,...tags}};
  assert.equal(evaluate(Object.values(boundPacked.files),request),'allowed');
  assert.equal(evaluate(Object.values(boundSources),request),'allowed');
});
test('실제 입력은 비공개 폴더에 포맷된 JSON으로 쓰며 기존 결과는 덮어쓰지 않는다',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'order-iam-'));
  try{assert.ok(writeIntegratedPermissions(input,temp)>1);const output=path.join(temp,'.local/iam-integrated-deploy-review');assert.ok(fs.readFileSync(path.join(output,'OrderPageDeployBundle01.json'),'utf8').includes('\n  "Statement"'));assert.throws(()=>writeIntegratedPermissions(input,temp));}finally{fs.rmSync(temp,{recursive:true,force:true});}
  assert.throws(()=>renderIntegratedPermissions({...input,email:'bad\nvalue'}));
  assert.throws(()=>renderIntegratedPermissions({...input,email:input.email+'\n'}));
  assert.throws(()=>renderIntegratedPermissions({...input,accountId:'*'}));
});
test('별도 검토용 권한은 정책 검증·조회만 허용하며 연결 권한을 주지 않는다',()=>{
  const audit=[renderAuditPermissions(account)];
  for(const action of ['access-analyzer:ValidatePolicy','iam:GetAccountSummary'])assert.equal(evaluate(audit,{action,resource:'*'}),'allowed');
  assert.equal(evaluate(audit,{action:'iam:AttachRolePolicy',resource:`arn:aws:iam::${account}:role/orderpage-terraform-deploy` }),'implicitDeny');
  assert.equal(evaluate(audit,{action:'iam:GetRole',resource:`arn:aws:iam::${account}:role/other` }),'implicitDeny');
});
test('별도 삭제 후보는 상품 객체·백엔드 이미지만 허용하고 state에는 접근하지 못한다',()=>{
  const cleanup=[renderArtifactCleanupPermissions(account)];
  const request={action:'s3:DeleteObject',resource:bucket+'/x',context:{...context,'s3:ResourceAccount':account}};
  assert.equal(evaluate(cleanup,request),'allowed');
  assert.equal(evaluate(cleanup,{...request,resource:`arn:aws:s3:::orderpage-devops-tfstate-${account}-ap-northeast-2/state` }),'implicitDeny');
  assert.equal(evaluate(cleanup,{...request,action:'s3:DeleteObjectVersion'}),'implicitDeny');
});
test('Jenkins 터널은 실제 ID·태그·문서 접근 검사를 요구하고 타인 세션 종료를 막는다',()=>{
  const id='i-0123456789abcdef0',user='AROAEXAMPLE:operator';
  // 이 단위 테스트에서만 IAM 정책 변수 값을 대입한다. 실제 AWS의 변수/태그 평가는 원격 검증 대상이다.
  const session=[JSON.parse(JSON.stringify(renderJenkinsTunnelPermissions(account,id)).replaceAll('${aws:userid}',user))];
  const c={...context,'ssm:SessionDocumentAccessCheck':'true','ssm:resourceTag/Project':'orderpage','ssm:resourceTag/Environment':'dev','ssm:resourceTag/Name':'orderpage-dev-jenkins'};
  const start={action:'ssm:StartSession',resource:arn('ec2','instance/'+id),context:c};
  assert.equal(evaluate(session,start),'allowed');
  assert.equal(evaluate(session,{...start,resource:arn('ec2','instance/i-11111111111111111')}),'implicitDeny');
  assert.equal(evaluate(session,{...start,context:{...c,'ssm:SessionDocumentAccessCheck':'false'}}),'implicitDeny');
  const end={action:'ssm:TerminateSession',resource:arn('ssm','session/operator-example'),context:{...context,'ssm:resourceTag/aws:ssmmessages:target-id':id,'ssm:resourceTag/aws:ssmmessages:session-id':user}};
  assert.equal(evaluate(session,end),'allowed');
  assert.equal(evaluate(session,{...end,context:{...end.context,'ssm:resourceTag/aws:ssmmessages:session-id':'another'}}),'implicitDeny');
  assert.throws(()=>renderJenkinsTunnelPermissions(account,'*'));
  assert.throws(()=>renderJenkinsTunnelPermissions(account,id+'\n'));
});
