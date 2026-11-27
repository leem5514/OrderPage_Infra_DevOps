import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// IAM은 클러스터 주소 조회와 역할 전환만 허용한다.
// kubectl/Helm 권한은 이후 Terraform의 EKS Access Entry에서 별도로 부여한다.
export function renderEksOperatorIam(accountId) {
  if (typeof accountId !== 'string' || !/^[0-9]{12}$/.test(accountId) || accountId.length !== 12 || /^0{12}$/.test(accountId)) {
    throw new Error('12자리 계정 ID가 필요합니다. 키나 비밀번호를 입력하지 마세요.');
  }
  const role = `arn:aws:iam::${accountId}:role/orderpage-eks-operator`;
  const json = statement => JSON.stringify({Version: '2012-10-17', Statement: [statement]}, null, 2) + '\n';
  return {
    'trust.json': json({
      Sid: 'OnlyProjectOperator', Effect: 'Allow',
      Principal: {AWS: `arn:aws:iam::${accountId}:user/orderpage-operator`}, Action: 'sts:AssumeRole'
    }),
    'cluster-read.json': json({
      Sid: 'DescribeOnlyProjectCluster', Effect: 'Allow', Action: 'eks:DescribeCluster',
      Resource: `arn:aws:eks:ap-northeast-2:${accountId}:cluster/orderpage-dev`,
      Condition: {StringEquals: {'aws:RequestedRegion': 'ap-northeast-2'}}
    }),
    'operator-assume.json': json({
      Sid: 'AssumeOnlyEksOperator', Effect: 'Allow', Action: 'sts:AssumeRole', Resource: role
    }),
    'profile.example.ini': `[profile orderpage-eks]\nregion = ap-northeast-2\nrole_arn = ${role}\nsource_profile = orderpage-lab\nrole_session_name = orderpage-eks\nduration_seconds = 3600\n`
  };
}

export function writeEksOperatorIam(accountId, repoRoot = root) {
  const files = renderEksOperatorIam(accountId);
  const local = path.join(repoRoot, '.local');
  if (fs.existsSync(local) && fs.lstatSync(local).isSymbolicLink()) throw new Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local, {recursive: true});
  const output = path.join(local, 'iam-eks-operator');
  fs.mkdirSync(output); // 기존 출력·링크를 덮어쓰지 않는다. AWS API도 호출하지 않는다.
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(output, name), value, {flag: 'wx', mode: 0o600});
  return Object.keys(files);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error('사용법: node scripts/prepare-eks-operator-iam.mjs <12자리 계정 ID>');
    console.log(`.local/iam-eks-operator에 ${writeEksOperatorIam(process.argv[2]).length}개 파일 생성. AWS 및 프로필 변경 없음.`);
  } catch (error) {
    console.error(error.code ? '기존 출력 폴더 또는 경로 권한을 확인하세요.' : error.message);
    process.exitCode = 1;
  }
}
