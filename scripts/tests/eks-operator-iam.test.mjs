import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {renderEksOperatorIam, writeEksOperatorIam} from '../prepare-eks-operator-iam.mjs';

const files = renderEksOperatorIam('123456789012');
const statement = name => JSON.parse(files[name + '.json']).Statement[0];

test('운영 Role은 한 클러스터 조회만 허용하며 IAM/state/인프라 변경 권한이 없다', () => {
  const read = statement('cluster-read');
  assert.equal(read.Effect, 'Allow');
  assert.equal(read.Action, 'eks:DescribeCluster');
  assert.equal(read.Resource, 'arn:aws:eks:ap-northeast-2:123456789012:cluster/orderpage-dev');
  assert.deepEqual(read.Condition, {StringEquals: {'aws:RequestedRegion': 'ap-northeast-2'}});
  assert.equal(JSON.parse(files['cluster-read.json']).Statement.length, 1);
});

test('신뢰 주체와 전환 대상에 root·wildcard·배포 Role을 넣지 않는다', () => {
  assert.deepEqual(statement('trust').Principal, {AWS: 'arn:aws:iam::123456789012:user/orderpage-operator'});
  assert.equal(statement('trust').Action, 'sts:AssumeRole');
  assert.equal(statement('operator-assume').Resource, 'arn:aws:iam::123456789012:role/orderpage-eks-operator');
  assert.equal(statement('operator-assume').Action, 'sts:AssumeRole');
  for (const value of Object.values(files)) assert.doesNotMatch(value, /\*|:root|terraform-deploy|aws_access_key_id|aws_secret_access_key|aws_session_token/);
  assert.match(files['profile.example.ini'], /source_profile = orderpage-lab/);
});

test('비정상 계정 입력과 미치환 표시를 거부하고 정책 크기를 제한한다', () => {
  for (const input of [null, 123456789012, '', '000000000000', '123456789012\n', '../outside', '{{ACCOUNT_ID}}']) {
    assert.throws(() => renderEksOperatorIam(input));
  }
  for (const [name, value] of Object.entries(files)) {
    assert.doesNotMatch(value, /\{\{|<account-id>/);
    if (name.endsWith('.json')) assert.ok(JSON.stringify(JSON.parse(value)).length < 6144);
  }
});

test('계정별 출력은 .local에만 만들고 기존 산출물을 덮어쓰지 않는다', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orderpage-eks-iam-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  assert.equal(writeEksOperatorIam('123456789012', temp).length, 4);
  const output = path.join(temp, '.local/iam-eks-operator/trust.json');
  const before = fs.readFileSync(output, 'utf8');
  assert.throws(() => writeEksOperatorIam('111122223333', temp));
  assert.equal(fs.readFileSync(output, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(temp), ['.local']);
});
