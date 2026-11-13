import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function matches(value, pattern, label) {
  assert(typeof value === 'string' && pattern.test(value), label + ' 값이 없거나 형식이 잘못되었습니다.');
  assert(!value.includes('REPLACE_REQUIRED'), label + ' 실제 값을 입력하세요.');
  return value;
}
export function deploymentConfig(outputs, settings) {
  const allowed = ['imageDigest', 'frontendOrigin', 'adminEmail'];
  assert(Object.keys(settings).every(key => allowed.includes(key)), '설정에는 이미지 digest, FE origin, 관리자 email만 넣습니다. 비밀번호는 받지 않습니다.');
  const value = key => { assert(outputs[key] && 'value' in outputs[key], 'Terraform output 누락: '+key); return outputs[key].value; };
  const account = matches(value('deployment_account_id'), /^[0-9]{12}$/, 'AWS account');
  const https = value('https_deployment');
  const images = value('product_images');
  const endpoints = value('data_endpoints');
  const rolePattern = new RegExp('^arn:aws:iam::'+account+':role/[A-Za-z0-9+=,.@_/-]+$');
  const certificate = matches(https.certificate_arn, new RegExp('^arn:aws:acm:ap-northeast-2:'+account+':certificate/[0-9a-f-]{36}$'), '서울 ACM ARN');
  const ecr = matches(value('backend_ecr_repository_url'), new RegExp('^'+account+'\\.dkr\\.ecr\\.ap-northeast-2\\.amazonaws\\.com/[a-z0-9/_-]+$'), 'ECR repository');
  matches(settings.imageDigest, /^sha256:[0-9a-f]{64}$/, '불변 이미지 digest');
  matches(settings.frontendOrigin, /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/, '정확한 HTTPS FE origin');
  matches(settings.adminEmail, /^[^\s@,=]+@[^\s@,=]+\.[^\s@,=]+$/, '관리자 email');
  assert(endpoints.db_port === 3306 && endpoints.redis_port === 6379 && endpoints.rabbitmq_port === 5671, '데이터 포트가 배포 계약과 다릅니다.');
  matches(endpoints.db_host, /^[a-z0-9.-]+\.ap-northeast-2\.rds\.amazonaws\.com$/, 'RDS host');
  matches(endpoints.redis_host, /^[a-z0-9.-]+\.apn2\.cache\.amazonaws\.com$/, 'Redis host');
  matches(endpoints.rabbitmq_host, /^[a-z0-9.-]+\.mq\.ap-northeast-2\.amazonaws\.com$/, 'MQ host');
  return {
    accountId: account, region: 'ap-northeast-2',
    clusterName: matches(value('eks_cluster_name'), /^[A-Za-z0-9][A-Za-z0-9_-]+$/, 'EKS cluster'),
    vpcId: matches(value('vpc_id'), /^vpc-([a-f0-9]{8}|[a-f0-9]{17})$/, 'VPC ID'),
    apiDomain: matches(https.api_domain, /^[a-z0-9-]+\.auctionbid\.shop$/, 'API domain'),
    certificateArn: certificate,
    controllerRoleArn: matches(https.controller_role_arn, rolePattern, 'Controller Role'),
    backendRoleArn: matches(images.backend_role_arn, rolePattern, 'Backend Role'),
    imageBucket: matches(images.bucket_name, /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, '전용 image bucket'),
    imageRepository: ecr, imageDigest: settings.imageDigest,
    frontendOrigin: settings.frontendOrigin, adminEmail: settings.adminEmail,
    dbHost: endpoints.db_host, redisHost: endpoints.redis_host, rabbitmqHost: endpoints.rabbitmq_host
  };
}
export function createOverlay(config, outputDir) {
  const out = path.resolve(outputDir);
  const localRoot = path.join(repoRoot, '.local', 'deploy');
  const rel = path.relative(localRoot, out);
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel), '출력은 저장소 .local/deploy/<환경> 아래에 생성해야 합니다.');
  assert(!fs.existsSync(out) || fs.readdirSync(out).length === 0, '이전 산출물과 섞이지 않도록 새 출력 디렉터리를 지정하세요.');
  fs.mkdirSync(out, { recursive: true });
  const kustomization = {
    apiVersion: 'kustomize.config.k8s.io/v1beta1', kind: 'Kustomization',
    resources: [path.relative(out, path.join(repoRoot, 'k8s/base')).replaceAll('\\', '/')],
    images: [{ name: 'REPLACE_REQUIRED_IMAGE', newName: config.imageRepository, digest: config.imageDigest }],
    configMapGenerator: [{
      name: 'orderpage-backend-config', namespace: 'orderpage', behavior: 'merge',
      literals: [
        'DB_URL=jdbc:mariadb://'+config.dbHost+':3306/ordersystem?sslMode=verify-full&serverSslCert=/etc/rds-ca/ap-northeast-2-bundle.pem',
        'REDIS_HOST='+config.redisHost, 'RABBITMQ_HOST='+config.rabbitmqHost,
        'AWS_S3_BUCKET='+config.imageBucket, 'CORS_ALLOWED_ORIGINS='+config.frontendOrigin, 'ADMIN_EMAIL='+config.adminEmail,
        'MANAGEMENT_METRICS_DISTRIBUTION_PERCENTILES_HISTOGRAM_HTTP_SERVER_REQUESTS=true'
      ]
    }],
    patches: [
      { target: { kind: 'ServiceAccount', name: 'orderpage-backend' }, patch: JSON.stringify([
        { op: 'replace', path: '/metadata/annotations/eks.amazonaws.com~1role-arn', value: config.backendRoleArn }
      ]) },
      { target: { kind: 'Ingress', name: 'orderpage-backend' }, patch: JSON.stringify([
        { op: 'replace', path: '/metadata/annotations/alb.ingress.kubernetes.io~1certificate-arn', value: config.certificateArn },
        { op: 'replace', path: '/spec/rules/0/host', value: config.apiDomain }
      ]) }
    ]
  };
  fs.writeFileSync(path.join(out, 'kustomization.yaml'), YAML.stringify(kustomization));
  const values = YAML.parse(fs.readFileSync(path.join(repoRoot, 'k8s/controllers/aws-load-balancer-controller/values.dev.yaml'), 'utf8'));
  values.clusterName = config.clusterName;
  values.vpcId = config.vpcId;
  values.serviceAccount.annotations['eks.amazonaws.com/role-arn'] = config.controllerRoleArn;
  fs.writeFileSync(path.join(out, 'controller-values.yaml'), YAML.stringify(values));
  fs.writeFileSync(path.join(out, 'environment.json'), JSON.stringify({
    accountId: config.accountId, region: config.region, clusterName: config.clusterName,
    certificateArn: config.certificateArn, apiDomain: config.apiDomain, chartVersion: '3.6.2'
  }, null, 2));
  return out;
}
export function renderDeployment(outputDir, kubectl = process.env.KUBECTL || 'kubectl') {
  // kustomize는 로컬 렌더만 한다. 클러스터 조회/apply를 호출하지 않는다.
  const rendered = execFileSync(kubectl, ['kustomize', outputDir], { encoding: 'utf8', timeout: 30000 });
  assert(!rendered.includes('REPLACE_REQUIRED'), '미완성 값이 남아 있습니다. 적용 파일을 만들지 않습니다.');
  const documents = YAML.parseAllDocuments(rendered).map(doc => doc.toJSON()).filter(Boolean);
  assert(!documents.some(doc => ['Secret', 'HorizontalPodAutoscaler'].includes(doc.kind)), '기본 배포에 Secret 또는 HPA가 섞였습니다.');
  const routingKinds = ['Namespace', 'Service', 'Ingress'];
  const save = (name, docs) => fs.writeFileSync(path.join(outputDir, name), docs.map(doc => YAML.stringify(doc)).join('---\n'));
  save('routing.yaml', documents.filter(doc => routingKinds.includes(doc.kind)));
  save('application.yaml', documents.filter(doc => !routingKinds.includes(doc.kind)));
  fs.writeFileSync(path.join(outputDir, 'manifests.yaml'), rendered);
  return documents;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flags = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2+i*2], process.argv[3+i*2]]));
    assert(flags['--terraform-outputs'] && flags['--settings'] && flags['--out'], '사용법: node scripts/prepare-deployment.mjs --terraform-outputs FILE --settings FILE --out .local/deploy/dev');
    const config = deploymentConfig(JSON.parse(fs.readFileSync(flags['--terraform-outputs'], 'utf8').replace(/^\uFEFF/, '')), JSON.parse(fs.readFileSync(flags['--settings'], 'utf8').replace(/^\uFEFF/, '')));
    const out = createOverlay(config, flags['--out']);
    const documents = renderDeployment(out);
    console.log('배포 파일 준비 완료: '+out+' ('+documents.length+'개 리소스). AWS/클러스터에는 적용하지 않았습니다.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
