import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import YAML from 'yaml';
import { repoRoot, deploymentConfig, createOverlay, renderDeployment } from '../prepare-deployment.mjs';
import { validateSecret } from '../check-backend-secret.mjs';

const account = '123456789012';
const tf = {
  deployment_account_id: {value:account},
  eks_cluster_name:{value:'orderpage-dev'},
  vpc_id:{value:'vpc-0123456789abcdef0'},
  backend_ecr_repository_url:{value:account+'.dkr.ecr.ap-northeast-2.amazonaws.com/orderpage-backend'},
  https_deployment:{value:{
    api_domain:'api-devops.auctionbid.shop',
    certificate_arn:'arn:aws:acm:ap-northeast-2:'+account+':certificate/00000000-0000-0000-0000-000000000001',
    controller_role_arn:'arn:aws:iam::'+account+':role/orderpage-dev-alb-controller'
  }},
  product_images:{value:{bucket_name:'orderpage-dev-product-images-'+account,backend_role_arn:'arn:aws:iam::'+account+':role/orderpage-dev-backend-upload'}},
  data_endpoints:{value:{db_host:'orderpage-dev.abcdef.ap-northeast-2.rds.amazonaws.com',db_port:3306,
    redis_host:'orderpage-dev.abcdef.ng.0001.apn2.cache.amazonaws.com',redis_port:6379,
    rabbitmq_host:'b-00000000-0000-0000-0000-000000000001.mq.ap-northeast-2.amazonaws.com',rabbitmq_port:5671}}
};
const settings = {imageDigest:'sha256:'+'a'.repeat(64),frontendOrigin:'https://devops.auctionbid.shop',adminEmail:'admin@example.test'};
const config = deploymentConfig(tf, settings);
const out = createOverlay(config, path.join(repoRoot, '.local/deploy', 'validation-'+Date.now()));
const docs = renderDeployment(out);
const get = kind => docs.find(doc => doc.kind === kind);
test('고정 이미지/HTTPS/인증서와 Actuator 외부 차단', () => {
  const ingress=get('Ingress');
  assert.equal(ingress.spec.rules[0].host,config.apiDomain);
  assert.equal(ingress.metadata.annotations['alb.ingress.kubernetes.io/ssl-redirect'],'443');
  assert.equal(ingress.metadata.annotations['alb.ingress.kubernetes.io/certificate-arn'],config.certificateArn);
  assert.equal(ingress.spec.rules[0].http.paths[0].path,'/actuator');
  assert.equal(JSON.parse(ingress.metadata.annotations['alb.ingress.kubernetes.io/actions.deny-actuator']).fixedResponseConfig.statusCode,'404');
  assert.equal(get('Deployment').spec.template.spec.containers[0].image,config.imageRepository+'@'+config.imageDigest);
});
test('기본 고정 Replica / Secret 부재 / Probe와 ALB readiness gate', () => {
  const deployment=get('Deployment');
  assert.equal(deployment.spec.replicas,2);
  assert.equal(deployment.spec.strategy.rollingUpdate.maxUnavailable,0);
  assert.equal(get('Namespace').metadata.labels['elbv2.k8s.aws/pod-readiness-gate-inject'],'enabled');
  assert.ok(!docs.some(doc=>['Secret','HorizontalPodAutoscaler'].includes(doc.kind)));
  const container=deployment.spec.template.spec.containers[0];
  assert.equal(container.readinessProbe.httpGet.path,'/actuator/health/readiness');
  assert.equal(container.livenessProbe.httpGet.path,'/actuator/health/liveness');
  assert.equal(container.envFrom[1].secretRef.name,'orderpage-backend-secret');
  assert.equal(deployment.spec.template.spec.automountServiceAccountToken,false);
});
test('TLS 설정 및 CA 내용/hash/volume 참조 연결', () => {
  const env=docs.find(doc=>doc.kind==='ConfigMap' && doc.metadata.name.startsWith('orderpage-backend-config-'));
  assert.equal(env.data.REDIS_SSL_ENABLED,'true');
  assert.equal(env.data.RABBITMQ_SSL_ENABLED,'true');
  assert.match(env.data.DB_URL,/sslMode=verify-full&serverSslCert=/);
  assert.equal(env.data.CORS_ALLOWED_ORIGINS,settings.frontendOrigin);
  assert.equal(env.data.MANAGEMENT_METRICS_DISTRIBUTION_PERCENTILES_HISTOGRAM_HTTP_SERVER_REQUESTS,'true');
  const ca=docs.find(doc=>doc.kind==='ConfigMap' && doc.metadata.name.startsWith('orderpage-rds-ca-'));
  const certs=ca.data['ap-northeast-2-bundle.pem'].match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  assert.ok(certs.length>=3);
  for(const pem of certs) assert.ok(Date.parse(new X509Certificate(pem).validTo)>Date.now());
  const pod=get('Deployment').spec.template.spec;
  assert.equal(pod.volumes[0].configMap.name,ca.metadata.name);
  assert.equal(pod.containers[0].envFrom[0].configMapRef.name,env.metadata.name);
  assert.equal(pod.containers[0].volumeMounts[0].readOnly,true);
});
test('다른 계정 인증서/태그 이미지/HTTP origin/비밀 입력 거부', () => {
  const changed=structuredClone(tf);
  changed.https_deployment.value.certificate_arn=changed.https_deployment.value.certificate_arn.replace(account,'999999999999');
  assert.throws(()=>deploymentConfig(changed,settings));
  assert.throws(()=>deploymentConfig(tf,{...settings,imageDigest:'latest'}));
  assert.throws(()=>deploymentConfig(tf,{...settings,frontendOrigin:'http://devops.auctionbid.shop'}));
  assert.throws(()=>deploymentConfig(tf,{...settings,DB_PASSWORD:'do-not-accept'}));
  assert.throws(()=>createOverlay(config,repoRoot));
});
test('HPA는 비교 overlay에서만 CPU 기준 2~4', () => {
  const render = dir => YAML.parseAllDocuments(execFileSync(process.env.KUBECTL || 'kubectl',['kustomize',path.join(repoRoot,dir)],{encoding:'utf8'})).map(doc=>doc.toJSON()).filter(Boolean);
  const before=render('k8s/benchmarks/hpa/fixed-replicas');
  const after=render('k8s/benchmarks/hpa/hpa-enabled');
  assert.equal(before.filter(doc=>doc.kind==='HorizontalPodAutoscaler').length,0);
  const hpa=after.find(doc=>doc.kind==='HorizontalPodAutoscaler');
  assert.equal(hpa.spec.minReplicas,2);assert.equal(hpa.spec.maxReplicas,4);
  assert.equal(hpa.spec.metrics.length,1);assert.equal(hpa.spec.metrics[0].resource.name,'cpu');
});
test('Controller 고정 chart Helm template과 IRSA/리전 설정', () => {
  assert.ok(process.env.LBC_CHART,'LBC_CHART에 내려받은 공식 chart tgz 경로를 지정해야 합니다.');
  const rendered=execFileSync(process.env.HELM || 'helm',['template','aws-load-balancer-controller',process.env.LBC_CHART,'--namespace','kube-system','--kube-version','1.35.0','--include-crds','-f',path.join(out,'controller-values.yaml')],{encoding:'utf8',maxBuffer:8*1024*1024});
  const helmDocs=YAML.parseAllDocuments(rendered).map(doc=>doc.toJSON()).filter(Boolean);
  const sa=helmDocs.find(doc=>doc.kind==='ServiceAccount');
  assert.equal(sa.metadata.annotations['eks.amazonaws.com/role-arn'],config.controllerRoleArn);
  const controller=helmDocs.find(doc=>doc.kind==='Deployment').spec.template.spec.containers[0];
  assert.match(controller.image,/:v3\.6\.2$/);
  assert.ok(controller.args.includes('--aws-region=ap-northeast-2'));
  assert.ok(controller.args.includes('--aws-vpc-id='+config.vpcId));
  assert.ok(helmDocs.some(doc=>doc.kind==='CustomResourceDefinition' && doc.metadata.name==='targetgroupbindings.elbv2.k8s.aws'));
});
const secret = [
  'DB_USERNAME=orderapp','DB_PASSWORD=Abcd1234'.repeat(1)+'Abcd1234'.repeat(3),
  'REDIS_PASSWORD=Efgh5678'.repeat(1)+'Efgh5678'.repeat(3),
  'RABBITMQ_USERNAME=orderapp','RABBITMQ_PASSWORD=Ijkl9012'.repeat(1)+'Ijkl9012'.repeat(3),
  'JWT_SECRET_KEY='+'a1B2'.repeat(16),'JWT_SECRET_KEY_RT='+'c3D4'.repeat(16)
].join('\n');
test('Secret은 값 출력 없이 앱 계정/필수키/예시와 약한 값 검사', () => {
  assert.equal(validateSecret(secret),true);
  assert.throws(()=>validateSecret(secret.replace('DB_USERNAME=orderapp','DB_USERNAME=orderadmin')));
  assert.throws(()=>validateSecret(secret.replace(/REDIS_PASSWORD=[^\n]+/,'REDIS_PASSWORD=change-me')));
  assert.throws(()=>validateSecret(secret+'\nAWS_SECRET_ACCESS_KEY=not-allowed'));
  assert.throws(()=>validateSecret(secret.replace(/JWT_SECRET_KEY_RT=[^\n]+/,'JWT_SECRET_KEY_RT='+'a1B2'.repeat(16))));
});
