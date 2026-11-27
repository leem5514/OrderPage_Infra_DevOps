import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewApplyScope} from '../review-apply-scope.mjs';
const make = (type, after = {}, actions = ['create']) => ({address: 'module.test.' + type + '.this', type, mode: 'managed', change: {after, actions}});

test('실제 검토 plan 74개 유형을 빠짐없이 분류한다', () => {
  const evidence = JSON.parse(fs.readFileSync(new URL('../../docs/restart/security-evidence/service-plan-2026-11-27.json', import.meta.url), 'utf8'));
  const rows = Object.entries(evidence.resourceTypes).flatMap(([type, count]) => Array.from({length: count}, () => make(type)));
  const result = reviewApplyScope({resource_changes: rows});
  assert.equal(result.managedResourceCount, 74);
  assert.equal(result.classifiedResourceCount, 74);
  assert.equal(result.unmapped.length, 0);
});
test('새 자원 유형·삭제·권한 상한 누락을 자동 승인하지 않는다', () => {
  const r = reviewApplyScope({resource_changes: [make('aws_unknown_service'), make('aws_iam_role'), make('aws_db_instance', {}, ['delete', 'create'])]});
  assert.equal(r.unmapped.length, 1);
  assert.equal(r.rolesWithoutBoundary.length, 1);
  assert.equal(r.destructive.length, 1);
  assert.equal(r.readyForApply, false);
});
test('state 원문에 있는 암호·ARN·user_data를 요약에 복사하지 않는다', () => {
  const marker = 'PRIVATE_TEST_VALUE_DO_NOT_COPY';
  const r = reviewApplyScope({resource_changes: [make('aws_iam_role', {permissions_boundary: marker, arn: marker}), make('aws_instance', {user_data: marker}), make('aws_db_instance', {password: marker})]});
  assert.equal(r.rolesWithoutBoundary.length, 0);
  assert.ok(!JSON.stringify(r).includes(marker));
  assert.equal(r.readyForApply, false); // boundary ARN 존재만으로 실효 권한이 검증되지는 않는다.
});
