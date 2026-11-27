import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {boundaryKinds, renderWorkloadBoundaries, writeWorkloadBoundaries} from '../prepare-workload-boundaries.mjs';

const account = '123456789012'; // 테스트용 계정
const files = renderWorkloadBoundaries(account);
const policy = kind => JSON.parse(files[`orderpage-dev-boundary-${kind}.json`]);
const withoutSid = rows => rows.map(({Sid, ...statement}) => statement);
const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const source = name => JSON.parse(read(`iam/workload-boundaries/vendor/${name}.json`)).Statement;

test('cluster/node/controller 상한은 고정 원본의 효과·대상·조건을 그대로 보존한다', () => {
  assert.deepEqual(withoutSid(policy('cluster').Statement), withoutSid(source('AmazonEKSClusterPolicy')));
  assert.deepEqual(withoutSid(policy('node').Statement), withoutSid([...source('AmazonEKSWorkerNodePolicy'), ...source('AmazonEKS_CNI_Policy'), ...source('AmazonEC2ContainerRegistryPullOnly')]));
  assert.deepEqual(withoutSid(policy('alb-controller').Statement), withoutSid(JSON.parse(read('terraform/modules/load-balancer-controller-irsa/vendor/iam_policy.v3.6.2.json')).Statement));
});

test('Jenkins와 이미지 업로드는 실제 inline policy의 Action과 지정 대상만 포함한다', () => {
  const rows = policy('jenkins').Statement;
  assert.deepEqual(withoutSid(rows.slice(0, -2)), withoutSid(source('AmazonSSMManagedInstanceCore')));
  assert.equal(rows.at(-1).Resource, `arn:aws:ecr:ap-northeast-2:${account}:repository/orderpage-backend`);
  const hcl = read('terraform/modules/jenkins/main.tf');
  const actions = [...hcl.matchAll(/"(ecr:[A-Za-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(rows.slice(-2).flatMap(s => s.Action), actions);
  assert.deepEqual(withoutSid(policy('backend-upload').Statement), [{Effect: 'Allow', Action: ['s3:PutObject'], Resource: `arn:aws:s3:::orderpage-dev-product-images-${account}/*`}]);
  assert.doesNotMatch(JSON.stringify(rows), /iam:|eks:|s3:|sts:/);
});

test('5개 상한과 조회 정책은 크기 제한을 지키며 관리자 권한·state 읽기를 추가하지 않는다', () => {
  for (const kind of boundaryKinds) {
    const p = policy(kind);
    assert.ok(JSON.stringify(p).length <= 6144);
    assert.equal(new Set(p.Statement.map(s => s.Sid)).size, p.Statement.length);
    for (const s of p.Statement) {
      for (const action of [s.Action].flat()) {
        assert.notEqual(action, '*');
        assert.doesNotMatch(action, /^sts:/);
        if (action.startsWith('iam:')) assert.ok(['iam:CreateServiceLinkedRole', 'iam:ListServerCertificates', 'iam:GetServerCertificate'].includes(action));
        assert.doesNotMatch(action, /^s3:(GetObject|ListBucket)|^iam:(PassRole|Put|Attach|CreatePolicy)/);
      }
    }
  }
  const readPolicy = JSON.parse(files['plan-read.json']);
  assert.ok(JSON.stringify(readPolicy).length <= 6144);
  const lookup = readPolicy.Statement.find(s => s.Sid === 'ReadProjectPolicies');
  assert.equal(lookup.Resource.length, 6);
  assert.ok(lookup.Action.every(a => /^iam:(Get|List)/.test(a)));
  assert.ok(!JSON.stringify(files).includes('{{'));
});

test('실제 계정 치환은 지정 버킷·repository와 정책 ARN에 반영되며 잘못된 입력은 거부한다', () => {
  const other = renderWorkloadBoundaries('111122223333');
  assert.ok(!JSON.stringify(other).includes(account));
  assert.match(other['orderpage-dev-boundary-backend-upload.json'], /product-images-111122223333/);
  for (const bad of [undefined, null, 123456789012, '', '000000000000', '123456789012\n', '../outside']) assert.throws(() => renderWorkloadBoundaries(bad));
});

test('결과는 .local에만 쓰고 재실행이나 링크 경로로 기존 파일을 덮어쓰지 않는다', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orderpage-boundary-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  assert.equal(writeWorkloadBoundaries(account, temp).length, 7);
  const before = fs.readFileSync(path.join(temp, '.local/iam-workload-boundaries/manifest.json'), 'utf8');
  assert.throws(() => writeWorkloadBoundaries('111122223333', temp));
  assert.equal(fs.readFileSync(path.join(temp, '.local/iam-workload-boundaries/manifest.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(temp), ['.local']);
  const linked = path.join(temp, 'linked');
  fs.mkdirSync(linked);
  fs.symlinkSync(path.join(temp, '.local'), path.join(linked, '.local'), 'junction');
  assert.throws(() => writeWorkloadBoundaries(account, linked), /링크/);
});
