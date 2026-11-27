import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const templates = ['trust', 'operator-assume', 'permissions'];

// 계정별 값은 추적 중인 템플릿 대신 Git 제외된 .local 아래에만 쓴다.
// AWS API/로그인/권한 부여는 실행하지 않는다. 계정 ID는 자격증명이 아니다.
export function renderBootstrapIam(accountId) {
  if (typeof accountId !== 'string' || accountId.length !== 12 || !/^[0-9]{12}$/.test(accountId) || /^0{12}$/.test(accountId)) {
    throw new Error('12자리 AWS 계정 ID가 필요합니다. 키·비밀번호를 입력하지 마세요.');
  }
  const files = {};
  for (const name of templates) {
    const input = fs.readFileSync(path.join(root, 'iam/bootstrap', `${name}.template.json`), 'utf8');
    const policy = JSON.parse(input.replaceAll('{{ACCOUNT_ID}}', accountId));
    const compact = JSON.stringify(policy);
    if (compact.includes('{{') || compact.length > 6144) throw new Error('정책 치환 또는 크기 검증 실패');
    files[`${name}.json`] = JSON.stringify(policy, null, 2) + '\n';
  }
  files['profile.example.ini'] = `[profile orderpage-bootstrap]\nregion = ap-northeast-2\nrole_arn = arn:aws:iam::${accountId}:role/orderpage-terraform-bootstrap\nsource_profile = orderpage-lab\nrole_session_name = orderpage-bootstrap\nduration_seconds = 3600\n`;
  return files;
}

export function writeBootstrapIam(accountId, repoRoot = root) {
  const files = renderBootstrapIam(accountId);
  const local = path.join(repoRoot, '.local');
  if (fs.existsSync(local) && fs.lstatSync(local).isSymbolicLink()) throw new Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local, {recursive: true});
  // 기존 산출물을 묵시적으로 바꾸지 않으며, 하위 링크 경로도 따라가지 않는다.
  const output = path.join(local, 'iam-bootstrap');
  fs.mkdirSync(output);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(output, name), content, {flag: 'wx', mode: 0o600});
  }
  return Object.keys(files);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error('사용법: node scripts/prepare-bootstrap-iam.mjs <12자리 계정 ID>');
    const names = writeBootstrapIam(process.argv[2]);
    console.log(`.local/iam-bootstrap에 ${names.length}개 파일 준비 완료. AWS 변경은 실행하지 않았습니다.`);
  } catch (error) {
    // 경로/계정이 포함될 수 있는 OS 오류 원문은 출력하지 않는다.
    console.error(error.code ? '파일 생성 실패: 기존 .local/iam-bootstrap 또는 경로 권한을 확인하세요.' : error.message);
    process.exitCode = 1;
  }
}
