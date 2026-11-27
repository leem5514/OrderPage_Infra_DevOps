import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const templates = ['trust', 'operator-assume', 'state-access', 'plan-read'];

// 배포 Role의 첫 단계는 plan이다. 이 도구는 AWS IAM을 변경하지 않는다.
// 실제 계정이 들어간 파일은 .local에만 만들며 원본 템플릿을 수정하지 않는다.
export function renderServicePlanIam(accountId) {
  if (typeof accountId !== 'string' || !/^[0-9]{12}$/.test(accountId) || accountId.length !== 12 || /^0{12}$/.test(accountId)) {
    throw new Error('12자리 계정 ID가 필요합니다. Access Key나 비밀번호를 넣지 마세요.');
  }
  const files = {};
  for (const name of templates) {
    const template = fs.readFileSync(path.join(root, 'iam/service-plan', `${name}.template.json`), 'utf8');
    const policy = JSON.parse(template.replaceAll('{{ACCOUNT_ID}}', accountId));
    const compact = JSON.stringify(policy);
    if (compact.includes('{{') || compact.length > 6144) throw new Error('정책 치환 또는 6,144자 제한 검사 실패');
    files[`${name}.json`] = JSON.stringify(policy, null, 2) + '\n';
  }
  files['profile.example.ini'] = `[profile orderpage-deploy]\nregion = ap-northeast-2\nrole_arn = arn:aws:iam::${accountId}:role/orderpage-terraform-deploy\nsource_profile = orderpage-lab\nrole_session_name = orderpage-deploy\nduration_seconds = 3600\n`;
  // backend는 default workspace 한 개만 지원한다. 실제 비밀값은 여기에 넣지 않는다.
  files['backend.hcl'] = fs.readFileSync(path.join(root, 'terraform/envs/dev/backend.hcl.example'), 'utf8').replaceAll('<account-id>', accountId);
  return files;
}

export function writeServicePlanIam(accountId, repoRoot = root) {
  const files = renderServicePlanIam(accountId);
  const local = path.join(repoRoot, '.local');
  if (fs.existsSync(local) && fs.lstatSync(local).isSymbolicLink()) throw new Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local, {recursive: true});
  const output = path.join(local, 'iam-service-plan');
  fs.mkdirSync(output); // 기존 결과와 링크 경로는 덮어쓰지 않는다.
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(output, name), content, {flag: 'wx', mode: 0o600});
  return Object.keys(files);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error('사용법: node scripts/prepare-service-plan-iam.mjs <12자리 계정 ID>');
    const files = writeServicePlanIam(process.argv[2]);
    console.log(`.local/iam-service-plan에 ${files.length}개 파일 생성. AWS 및 기존 프로필 변경 없음.`);
  } catch (error) {
    console.error(error.code ? '파일 생성 실패: 기존 출력 폴더 또는 경로 권한을 확인하세요.' : error.message);
    process.exitCode = 1;
  }
}
