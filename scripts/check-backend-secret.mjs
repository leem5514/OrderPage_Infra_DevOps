import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function validateSecret(text) {
  const keys = ['DB_USERNAME','DB_PASSWORD','REDIS_PASSWORD','RABBITMQ_USERNAME','RABBITMQ_PASSWORD','JWT_SECRET_KEY','JWT_SECRET_KEY_RT'];
  const values = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index);
    if (index < 1 || !keys.includes(key) || key in values) throw new Error('허용되지 않거나 중복된 Secret key입니다. 값은 출력하지 않습니다.');
    const value = line.slice(index+1);
    if (!value || /REPLACE_REQUIRED|change-me|MockOnly/.test(value) || /[\r\n]/.test(value)) throw new Error('비어 있거나 예시인 Secret 값이 있습니다.');
    values[key] = value;
  }
  if (keys.some(key => !(key in values))) throw new Error('필수 Secret key가 누락되었습니다.');
  for (const key of ['DB_USERNAME','RABBITMQ_USERNAME']) {
    if (['root','admin','orderadmin','guest'].includes(values[key].toLowerCase())) throw new Error('앱 전용 DB/MQ 계정을 사용해야 합니다.');
  }
  for (const key of ['DB_PASSWORD','REDIS_PASSWORD','RABBITMQ_PASSWORD']) {
    if (!/^[A-Za-z0-9]{32,64}$/.test(values[key]) || new Set(values[key]).size < 4) throw new Error('데이터 인증값 규칙을 확인하세요.');
  }
  for (const key of ['JWT_SECRET_KEY','JWT_SECRET_KEY_RT']) {
    if (values[key].length < 64 || /\s/.test(values[key])) throw new Error('JWT 서명키는 공백 없는 별도 난수 값 64자 이상을 사용하세요.');
  }
  if (values.JWT_SECRET_KEY === values.JWT_SECRET_KEY_RT) throw new Error('Access/Refresh 서명키는 분리해야 합니다.');
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('사용법: node scripts/check-backend-secret.mjs .local/secrets/backend.env');
    validateSecret(fs.readFileSync(process.argv[2], 'utf8'));
    console.log('Secret 입력 규칙 확인 완료. 실제 서비스 인증 성공은 별도 검증해야 합니다.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
