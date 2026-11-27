import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {renderServicePlanIam} from './prepare-service-plan-iam.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const boundaryKinds = ['cluster', 'node', 'jenkins', 'backend-upload', 'alb-controller'];
const vendor = path.join(root, 'iam/workload-boundaries/vendor');

// AWS 관리형 정책의 현재 버전을 실행 시 내려받지 않는다. 검토한 스냅샷이 상한이다.
function source(name) {
  const manifest = JSON.parse(fs.readFileSync(path.join(vendor, 'sources.json'), 'utf8'));
  const entry = manifest.find(item => item.name === name);
  const content = fs.readFileSync(path.join(vendor, name + '.json'), 'utf8').replaceAll('\r\n', '\n');
  if (!entry || createHash('sha256').update(content).digest('hex') !== entry.sha256) throw Error('원본 정책 해시 불일치');
  return JSON.parse(content).Statement;
}

export function renderWorkloadBoundaries(accountId) {
  // 기존 생성기와 동일한 계정 검증, 조회 전용 정책을 함께 갱신한다.
  const readPolicy = renderServicePlanIam(accountId)['plan-read.json'];
  const controller = JSON.parse(fs.readFileSync(path.join(root, 'terraform/modules/load-balancer-controller-irsa/vendor/iam_policy.v3.6.2.json'), 'utf8'));
  const statements = {
    cluster: source('AmazonEKSClusterPolicy'),
    node: [...source('AmazonEKSWorkerNodePolicy'), ...source('AmazonEKS_CNI_Policy'), ...source('AmazonEC2ContainerRegistryPullOnly')],
    jenkins: [...source('AmazonSSMManagedInstanceCore'),
      {Effect: 'Allow', Action: ['ecr:GetAuthorizationToken'], Resource: '*'},
      {Effect: 'Allow', Action: ['ecr:BatchCheckLayerAvailability', 'ecr:InitiateLayerUpload', 'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload', 'ecr:PutImage', 'ecr:BatchGetImage', 'ecr:DescribeImages', 'ecr:DescribeRepositories'], Resource: `arn:aws:ecr:ap-northeast-2:${accountId}:repository/orderpage-backend`}],
    'backend-upload': [{Effect: 'Allow', Action: ['s3:PutObject'], Resource: `arn:aws:s3:::orderpage-dev-product-images-${accountId}/*`}],
    'alb-controller': controller.Statement
  };
  const files = {};
  const manifest = [];
  for (const kind of boundaryKinds) {
    // 여러 정책을 합칠 때 Sid 중복을 피한다. 효과·조건·대상은 원본 그대로 유지한다.
    const policy = {Version: '2012-10-17', Statement: statements[kind].map((statement, index) => ({...statement, Sid: `Boundary${index + 1}`}))};
    const compact = JSON.stringify(policy);
    if (compact.length > 6144 || compact.includes('{{')) throw Error('정책 크기 또는 치환 검사 실패');
    const name = `orderpage-dev-boundary-${kind}`;
    // 콘솔에서 검토하기 쉽도록 들여쓰기한다. 크기·해시는 서식과 무관한 compact 기준이다.
    files[name + '.json'] = JSON.stringify(policy, null, 2) + '\n';
    manifest.push({name, arn: `arn:aws:iam::${accountId}:policy/${name}`, characters: compact.length, sha256: createHash('sha256').update(compact).digest('hex')});
  }
  files['plan-read.json'] = readPolicy;
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  return files;
}

export function writeWorkloadBoundaries(accountId, repoRoot = root) {
  const files = renderWorkloadBoundaries(accountId);
  const local = path.join(repoRoot, '.local');
  if (fs.existsSync(local) && fs.lstatSync(local).isSymbolicLink()) throw Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local, {recursive: true});
  const output = path.join(local, 'iam-workload-boundaries');
  fs.mkdirSync(output); // 기존 폴더·링크는 덮어쓰지 않는다.
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(output, name), content, {flag: 'wx', mode: 0o600});
  return Object.keys(files);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw Error('사용법: node scripts/prepare-workload-boundaries.mjs <12자리 계정 ID>');
    console.log(`.local/iam-workload-boundaries에 ${writeWorkloadBoundaries(process.argv[2]).length}개 파일 생성. AWS 변경 없음.`);
  } catch (error) {
    console.error(error.code ? '기존 출력 폴더 또는 경로 권한을 확인하세요.' : error.message);
    process.exitCode = 1;
  }
}
