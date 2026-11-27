import {execFileSync} from 'node:child_process';

// 서비스가 정하는 기본 이름이다. 임의 suffix나 다른 서비스 Role로 확장하지 않는다.
export const serviceLinkedRoles = [
  ['eks.amazonaws.com', 'AWSServiceRoleForAmazonEKS'],
  ['eks-nodegroup.amazonaws.com', 'AWSServiceRoleForAmazonEKSNodegroup'],
  ['autoscaling.amazonaws.com', 'AWSServiceRoleForAutoScaling'],
  ['rds.amazonaws.com', 'AWSServiceRoleForRDS'],
  ['elasticache.amazonaws.com', 'AWSServiceRoleForElastiCache'],
  ['mq.amazonaws.com', 'AWSServiceRoleForAmazonMQ'],
  ['elasticloadbalancing.amazonaws.com', 'AWSServiceRoleForElasticLoadBalancing']
];

export function validateAccount(accountId) {
  if (typeof accountId !== 'string' || !/^[0-9]{12}$/.test(accountId) || accountId.length !== 12 || /^0{12}$/.test(accountId)) throw Error('12자리 계정 ID가 필요합니다.');
}

// ARN의 issuer ID를 추측하지 않고, 지정 계정의 ACTIVE 클러스터 조회 결과에만 묶는다.
export function oidcProviderArn(accountId, cluster) {
  validateAccount(accountId);
  const issuer = cluster?.identity?.oidc?.issuer;
  if (cluster?.name !== 'orderpage-dev' || cluster?.arn !== `arn:aws:eks:ap-northeast-2:${accountId}:cluster/orderpage-dev` || cluster?.status !== 'ACTIVE' || typeof issuer !== 'string' || !/^https:\/\/oidc\.eks\.ap-northeast-2\.amazonaws\.com\/id\/[A-Fa-f0-9]{32}(?![\s\S])/.test(issuer)) {
    throw Error('OIDC 연결 중단: 지정 계정·서울·orderpage-dev·ACTIVE·issuer 형식을 확인하세요.');
  }
  return `arn:aws:iam::${accountId}:oidc-provider/${issuer.slice('https://'.length)}`;
}

// 읽기 전용. 토큰이나 AWS 오류 원문을 출력하지 않는다. 정책 생성/연결 API는 없다.
export function readOidcCluster(accountId, run = execFileSync, environment = process.env) {
  validateAccount(accountId);
  const blocked = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_ROLE_ARN'];
  if (Object.keys(environment).some(key => (blocked.includes(key.toUpperCase()) || key.toUpperCase().startsWith('AWS_ENDPOINT_URL')) && environment[key])) throw Error('AWS 자격증명/endpoint 환경 변수 덮어쓰기를 제거한 후 재시도하세요.');
  const query = args => {
    try {
      return JSON.parse(run('aws', [...args, '--profile', 'orderpage-deploy', '--region', 'ap-northeast-2', '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '10', '--cli-read-timeout', '30'], {encoding: 'utf8', timeout: 45000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...environment, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off'}}));
    } catch {
      throw Error('AWS 조회 실패: orderpage-deploy 로그인·조회 권한·클러스터 존재 여부를 확인하세요. 비공개 출력 파일은 생성하지 않았습니다.');
    }
  };
  const identity = query(['sts', 'get-caller-identity']);
  if (identity.Account !== accountId || typeof identity.Arn !== 'string' || !identity.Arn.startsWith(`arn:aws:sts::${accountId}:assumed-role/orderpage-terraform-deploy/`) || identity.Arn.split('/').length !== 3 || !identity.Arn.split('/')[2]) throw Error('AWS 조회 중단: 지정 계정의 Terraform 배포 Role이 아닙니다.');
  const cluster = query(['eks', 'describe-cluster', '--name', 'orderpage-dev']).cluster;
  oidcProviderArn(accountId, cluster);
  return cluster;
}
