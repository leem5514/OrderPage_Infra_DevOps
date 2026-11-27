import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderBootstrapIam, writeBootstrapIam} from '../prepare-bootstrap-iam.mjs';

const account = '123456789012'; // AWS 문서용 예시 계정. 실제 계정이 아님.
const bucket = `arn:aws:s3:::orderpage-devops-tfstate-${account}-ap-northeast-2`;
const files = renderBootstrapIam(account);
const permissions = JSON.parse(files['permissions.json']);
const asArray = value => Array.isArray(value) ? value : [value];

test('다른 사용자·계정·Role을 신뢰하거나 위임하지 않는다', () => {
  const trust = JSON.parse(files['trust.json']).Statement;
  assert.equal(trust.length, 1);
  assert.deepEqual(trust[0].Principal, {AWS: `arn:aws:iam::${account}:user/orderpage-operator`});
  assert.equal(trust[0].Action, 'sts:AssumeRole');
  const assume = JSON.parse(files['operator-assume.json']).Statement;
  assert.equal(assume.length, 1);
  assert.equal(assume[0].Action, 'sts:AssumeRole');
  assert.equal(assume[0].Resource, `arn:aws:iam::${account}:role/orderpage-terraform-bootstrap`);
});

test('허용은 지정 버킷 설정만: IAM·서버 생성·객체 읽기/삭제 권한이 없다', () => {
  for (const statement of permissions.Statement.filter(s => s.Effect === 'Allow')) {
    assert.equal(statement.Resource, bucket);
    for (const action of asArray(statement.Action)) {
      assert.match(action, /^s3:/);
      assert.ok(!action.includes('*'));
      assert.ok(!['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject', 's3:DeleteObject', 's3:DeleteObjectVersion'].includes(action));
    }
    if (asArray(statement.Action).includes('s3:CreateBucket')) {
      assert.deepEqual(statement.Condition, {StringEquals: {'s3:LocationConstraint': 'ap-northeast-2'}});
    } else {
      assert.deepEqual(statement.Condition, {StringEquals: {'s3:ResourceAccount': account}});
    }
  }
});

test('HTTP 요청은 버킷과 객체 모두 명시적으로 거부한다', () => {
  const deny = permissions.Statement.filter(s => s.Effect === 'Deny');
  assert.equal(deny.length, 1);
  assert.equal(deny[0].Action, 's3:*');
  assert.deepEqual(deny[0].Resource, [bucket, `${bucket}/*`]);
  assert.deepEqual(deny[0].Condition, {Bool: {'aws:SecureTransport': 'false'}});
});

test('인증값·JSON 삽입·미치환 플레이스홀더 입력을 거부한다', () => {
  for (const bad of ['', '{{ACCOUNT_ID}}', '000000000000', '12345678901', '1234567890123', '123456789012\n', '123456789012"', '../outside']) {
    assert.throws(() => renderBootstrapIam(bad));
  }
  for (const [name, content] of Object.entries(files)) {
    assert.ok(!content.includes('{{'));
    if (name.endsWith('.json')) assert.ok(JSON.stringify(JSON.parse(content)).length <= 6144);
  }
});

test('프로필은 기존 임시 인증을 source로 사용하고 키를 저장하지 않는다', () => {
  assert.match(files['profile.example.ini'], /source_profile = orderpage-lab/);
  assert.match(files['profile.example.ini'], /duration_seconds = 3600/);
  assert.doesNotMatch(files['profile.example.ini'], /aws_access_key_id|aws_secret_access_key|aws_session_token|source_profile = orderpage-bootstrap/);
});

test('산출물은 .local에 생성하며 기존 파일을 덮어쓰지 않는다', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orderpage-iam-test-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  assert.equal(writeBootstrapIam(account, temp).length, 4);
  const output = path.join(temp, '.local/iam-bootstrap/permissions.json');
  const original = fs.readFileSync(output, 'utf8');
  assert.throws(() => writeBootstrapIam('111122223333', temp));
  assert.equal(fs.readFileSync(output, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(temp), ['.local']);
});
