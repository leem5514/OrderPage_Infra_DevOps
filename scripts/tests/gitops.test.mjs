import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { repoRoot, createOverlay } from '../prepare-deployment.mjs';
import { updatedOverlay, checkRendered, promote, ciTarget } from '../gitops-release.mjs';

const repository='123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/orderpage-backend';
const release={repository,digest:'sha256:'+'b'.repeat(64),sourceCommit:'a'.repeat(40),buildUrl:'http://localhost:8080/job/backend/1/'};
const overlay={resources:['../../../k8s/base'],images:[{name:'REPLACE_REQUIRED_IMAGE',newName:repository,digest:'sha256:'+'c'.repeat(64)}],patches:[{path:'keep.yaml'}]};
test('자동 polling은 수동 parameter 없이 GitOps 환경에서 계정/ECR을 확인',()=>{
  assert.deepEqual(ciTarget(YAML.stringify(overlay)),{accountId:'123456789012',repositoryName:'orderpage-backend'});
  assert.throws(()=>ciTarget(YAML.stringify(overlay).replace('ap-northeast-2','us-east-1')));
});
test('release 갱신은 기존 저장소 digest만 바꾸고 나머지 overlay를 보존',()=>{
  const next=YAML.parse(updatedOverlay(YAML.stringify(overlay),release));
  assert.equal(next.images[0].digest,release.digest);
  next.images[0].digest=overlay.images[0].digest;
  assert.deepEqual(next,overlay);
  assert.throws(()=>updatedOverlay(YAML.stringify(overlay),{...release,repository:repository.replace('123456789012','999999999999')}));
  assert.throws(()=>updatedOverlay(YAML.stringify(overlay),{...release,digest:'latest'}));
  assert.throws(()=>updatedOverlay(YAML.stringify(overlay),{...release,sourceCommit:'main; evil'}));
});
const required=['DB_USERNAME','DB_PASSWORD','REDIS_PASSWORD','RABBITMQ_USERNAME','RABBITMQ_PASSWORD','JWT_SECRET_KEY','JWT_SECRET_KEY_RT'];
const deployment={apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'orderpage-backend',namespace:'orderpage'},spec:{template:{spec:{containers:[{image:repository+'@'+release.digest,env:required.map(name=>({name,valueFrom:{secretKeyRef:{name:'orderpage-backend-secret',key:name}}}))}]}}}};
test('GitOps 렌더는 Secret/비밀 ConfigMap/다른 namespace/태그 이미지를 거부',()=>{
  assert.equal(checkRendered(YAML.stringify(deployment)).length,1);
  for(const extra of [
    {kind:'Secret',metadata:{namespace:'orderpage'}},
    {kind:'ConfigMap',metadata:{namespace:'orderpage'},data:{DB_PASSWORD:'not-a-real-password'}},
    {kind:'Service',metadata:{namespace:'default'}}
  ]) assert.throws(()=>checkRendered(YAML.stringify(deployment)+'---\n'+YAML.stringify(extra)));
  assert.throws(()=>checkRendered(YAML.stringify(deployment).replace(release.digest,'latest')));
  const wrong=structuredClone(deployment);
  wrong.spec.template.spec.containers[0].env[5].valueFrom={value:'public-dev-key'};
  assert.throws(()=>checkRendered(YAML.stringify(wrong)));
});
test('최초 승격은 실제 로컬 Kustomize 결과만 복사하고 Secret/kubeconfig는 제외',()=>{
  // 앞 테스트 파일 실행과 독립적이도록 이미 저장된 검증 fixture를 의존하지 않는다.
  const root=fs.mkdtempSync(path.join(repoRoot,'.local/deploy/gitops-test-'));
  const prepared=createOverlay({
    imageRepository:repository,imageDigest:release.digest,dbHost:'db.ap-northeast-2.rds.amazonaws.com',
    redisHost:'redis.apn2.cache.amazonaws.com',rabbitmqHost:'broker.mq.ap-northeast-2.amazonaws.com',
    imageBucket:'test-product-images',frontendOrigin:'https://devops.auctionbid.shop',adminEmail:'admin@example.test',
    backendRoleArn:'arn:aws:iam::123456789012:role/backend',controllerRoleArn:'arn:aws:iam::123456789012:role/controller',
    certificateArn:'arn:aws:acm:ap-northeast-2:123456789012:certificate/00000000-0000-0000-0000-000000000001',
    apiDomain:'api-devops.auctionbid.shop',accountId:'123456789012',region:'ap-northeast-2',clusterName:'orderpage-dev',vpcId:'vpc-0123456789abcdef0'
  },path.join(root,'prepared'));
  fs.writeFileSync(path.join(prepared,'kubeconfig'),'never-copy');
  const destination=path.join(root,'destination');
  promote(prepared,destination);
  assert.deepEqual(fs.readdirSync(destination),['kustomization.yaml']);
  const render = directory => execFileSync(process.env.KUBECTL || 'kubectl',['kustomize',directory],{encoding:'utf8'});
  assert.equal(render(prepared),render(destination));
  assert.throws(()=>promote(prepared,destination));
});
test('Argo 프로젝트는 지정 저장소/namespace만 허용하고 최초 자동 배포는 꺼짐',()=>{
  const project=YAML.parse(fs.readFileSync(path.join(repoRoot,'argocd/project.yaml'),'utf8'));
  const app=YAML.parse(fs.readFileSync(path.join(repoRoot,'argocd/application.yaml'),'utf8'));
  assert.deepEqual(project.spec.sourceRepos,['https://github.com/leem5514/OrderPage_Infra_DevOps.git']);
  assert.equal(project.spec.destinations[0].namespace,'orderpage');
  assert.ok(!project.spec.namespaceResourceWhitelist.some(r=>['Secret','Role','RoleBinding','*'].includes(r.kind)));
  assert.equal(app.spec.source.targetRevision,'main');
  assert.equal(app.spec.syncPolicy.automated.enabled,false);
  assert.equal(app.spec.syncPolicy.automated.allowEmpty,false);
  assert.equal(app.metadata.finalizers,undefined);
});
test('공식 Argo Helm chart는 내부 서비스와 제한된 비HA 구성으로 렌더',()=>{
  assert.ok(process.env.ARGO_CHART,'ARGO_CHART가 필요합니다.');
  const rendered=execFileSync(process.env.HELM || 'helm',['template','argocd',process.env.ARGO_CHART,'--namespace','argocd','--kube-version','1.35.0','-f',path.join(repoRoot,'argocd/values.dev.yaml')],{encoding:'utf8',maxBuffer:12*1024*1024});
  const docs=YAML.parseAllDocuments(rendered).map(d=>d.toJSON()).filter(Boolean);
  assert.ok(!docs.some(d=>d.kind==='Ingress'));
  assert.ok(docs.filter(d=>d.kind==='Service').every(d=>!d.spec.type || d.spec.type==='ClusterIP'));
  const workloads=docs.filter(d=>['Deployment','StatefulSet'].includes(d.kind));
  assert.ok(!workloads.some(d=>/dex|notifications/.test(d.metadata.name)));
  assert.equal(workloads.find(d=>/applicationset/.test(d.metadata.name)).spec.replicas,0);
  assert.ok(workloads.some(d=>d.metadata.name==='argocd-repo-server' && d.spec.template.spec.containers[0].image.endsWith(':v3.6.1')));
});
