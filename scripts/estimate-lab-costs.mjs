import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 계획 비교용 730시간 환산이다. 실제 청구의 월 길이·시간 반올림·무료 구간과는 다르다.
// ALB/LCU는 Terraform 외부에서 생성되는 항목이므로 foundation과 구분한다.
export function estimateLabCosts(evidence, {hours, application = true, natGb = 0, logIngestGb = 0, averageLcu = 0} = {}) {
  if (evidence.region !== 'ap-northeast-2' || evidence.currency !== 'USD') throw Error('서울 USD 근거가 필요합니다.');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 72) throw Error('가동 시간은 0 초과 72 이하입니다.');
  if (typeof application !== 'boolean') throw Error('application은 boolean입니다.');
  for (const value of [natGb, logIngestGb, averageLcu]) if (!Number.isFinite(value) || value < 0) throw Error('사용량은 0 이상 유한수입니다.');
  if (!application && averageLcu !== 0) throw Error('ALB 없이 LCU 사용량을 계산할 수 없습니다.');
  const rows = evidence.catalogs.flatMap(c => c.rows);
  function rate(sku, unit) {
    const matched = rows.filter(r => r.sku === sku);
    if (matched.length !== 1 || matched[0].unit !== unit || matched[0].pricePerUnit?.USD === undefined) throw Error('단가 누락·중복·단위 오류: ' + sku);
    const price = Number(matched[0].pricePerUnit.USD);
    if (!Number.isFinite(price) || price < 0) throw Error('단가 오류: ' + sku);
    return price;
  }
  const month = hours / 730;
  const items = {
    eks: rate('8HAE52ZNS3QC3Q8Q', 'Hours') * hours,
    workers: rate('YNF8U8R6NK3DHPTM', 'Hrs') * 2 * hours,
    jenkins: rate('YNF8U8R6NK3DHPTM', 'Hrs') * hours,
    rds: rate('QT9S5MUGTQZ7NNWZ', 'Hrs') * hours,
    redis: rate('DGSDTRJPVT6GES4T', 'Hrs') * hours,
    mq: rate('VNRE2UB57F9ZNK3Q', 'Hrs') * hours,
    nat: rate('P63FHTYZXQBC6HX5', 'Hrs') * hours,
    // NAT 1개 + 후속 internet-facing ALB의 2 AZ 주소 최소 2개를 가정한다.
    ipv4: rate('ZKBHEVDXYBRCKFQ8', 'Hrs') * (application ? 3 : 1) * hours,
    alb: application ? rate('VUV9M7PZ543S2SC9', 'Hrs') * hours : 0,
    ebs70GiB: rate('MTK7D9SGKGYR3JD6', 'GB-Mo') * 70 * month,
    rdsStorage20GiB: rate('3TZJNNJAT7WAYW56', 'GB-Mo') * 20 * month,
    mqStorage200GiB: rate('7V99YDCKWQACRR4R', 'GB-Mo') * 200 * month,
    alarms: rate('PRDBYUGVEHFG9C2J', 'Alarms') * (application ? 10 : 7) * month,
    dashboard: rate('5P8PBB6MXV325TDC', 'Dashboards') * month
  };
  const usageItems = {
    natData: rate('HC3MBQKUG7PB4BYX', 'GB') * natGb,
    logIngest: rate('5P9Q77R2ADUJCNJ2', 'GB') * logIngestGb,
    albLcu: application ? rate('CX4ZBV2SE6F5HJV3', 'LCU-Hrs') * averageLcu * hours : 0
  };
  const total = values => Object.values(values).reduce((a, b) => a + b, 0);
  const round = n => Math.round(n * 100) / 100;
  return {
    hours, application, currency: 'USD', priceDate: evidence.date,
    fixedSubtotal: round(total(items)), modeledUsageSubtotal: round(total(usageItems)),
    modeledTotal: round(total(items) + total(usageItems)),
    items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, round(v)])),
    usageItems: Object.fromEntries(Object.entries(usageItems).map(([k, v]) => [k, round(v)])),
    assumptions: {monthHours: 730, workers: 2, jenkinsHours: hours, alarmCount: application ? 10 : 7, natGb, logIngestGb, averageLcu},
    excluded: ['tax and FX', 'internet/cross-AZ data transfer', 'S3/ECR storage and requests', 'SNS and billable monitoring APIs', 'log storage and queries', 'RDS CPU credits and excess backup storage', 'Vercel', 'provisioning/teardown time and residual resources'],
    spendingCap: false
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = JSON.parse(fs.readFileSync(new URL('../docs/restart/pricing-evidence/seoul-2026-11-27.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify({notice: '견적 시나리오이며 청구액·지출 상한이 아닙니다. 사용량 0은 무료라는 뜻이 아닙니다.', scenarios: [12, 24, 48, 72].map(hours => ({
    foundation: estimateLabCosts(evidence, {hours, application: false}),
    application: estimateLabCosts(evidence, {hours}),
    usageExample: estimateLabCosts(evidence, {hours, natGb: 5, logIngestGb: 1, averageLcu: 1})
  }))}, null, 2));
}
