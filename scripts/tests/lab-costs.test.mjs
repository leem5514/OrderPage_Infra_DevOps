import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {estimateLabCosts} from '../estimate-lab-costs.mjs';
const evidence = JSON.parse(fs.readFileSync(new URL('../../docs/restart/pricing-evidence/seoul-2026-11-27.json', import.meta.url), 'utf8'));

test('Jenkins 전체 시간과 worker 2대·고정 스토리지를 포함한다', () => {
  const r = estimateLabCosts(evidence, {hours: 24});
  assert.equal(r.items.workers, 5.66);
  assert.equal(r.items.jenkins, 2.83);
  assert.equal(r.items.mqStorage200GiB, 0.75);
  assert.equal(r.assumptions.alarmCount, 10);
  assert.equal(r.spendingCap, false);
  assert.ok(r.excluded.includes('Vercel'));
});
test('후속 ALB와 2개 IPv4·경보 3개는 foundation과 분리한다', () => {
  const base = estimateLabCosts(evidence, {hours: 24, application: false});
  const full = estimateLabCosts(evidence, {hours: 24});
  assert.equal(base.items.alb, 0);
  assert.equal(base.items.ipv4, 0.12);
  assert.equal(full.items.ipv4, 0.36);
  assert.equal(base.assumptions.alarmCount, 7);
  assert.ok(full.fixedSubtotal > base.fixedSubtotal);
});
test('실측 전 사용량 가정은 기본 금액과 분리하고 총액에 반영한다', () => {
  const base = estimateLabCosts(evidence, {hours: 24});
  const load = estimateLabCosts(evidence, {hours: 24, natGb: 10, logIngestGb: 2, averageLcu: 1});
  assert.equal(load.fixedSubtotal, base.fixedSubtotal);
  assert.equal(load.usageItems.natData, 0.59);
  assert.equal(load.usageItems.logIngest, 1.52);
  assert.equal(load.modeledUsageSubtotal, 2.30);
});
test('범위를 벗어난 시간·사용량과 누락·중복·단위가 다른 단가를 거부한다', () => {
  for (const hours of [0, -1, 73, NaN, Infinity, '24']) assert.throws(() => estimateLabCosts(evidence, {hours}));
  for (const value of [-1, NaN, Infinity]) assert.throws(() => estimateLabCosts(evidence, {hours: 24, natGb: value}));
  assert.throws(() => estimateLabCosts(evidence, {hours: 24, application: false, averageLcu: 1}));
  for (const mutate of [d => d.catalogs[0].rows.shift(), d => d.catalogs[0].rows.push(d.catalogs[0].rows[0]), d => d.catalogs[0].rows[0].unit = 'Monthly']) {
    const copy = structuredClone(evidence); mutate(copy);
    assert.throws(() => estimateLabCosts(copy, {hours: 24}));
  }
});
