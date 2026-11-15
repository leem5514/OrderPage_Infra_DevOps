import { readFile } from 'node:fs/promises';

// 저장한 공식 단가로 다시 계산한다. 실행 중 AWS 호출이나 리소스 생성은 없다.
// 실행: node docs/restart/pricing-evidence/estimate.mjs
const evidence = JSON.parse(await readFile(new URL('seoul-2026-11-06.json',import.meta.url),'utf8'));
const jenkinsEvidence = JSON.parse((await readFile(new URL('jenkins-seoul-2026-11-08.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const jenkinsRate = Number(jenkinsEvidence.rows.find(row=>row.sku==='YNF8U8R6NK3DHPTM').pricePerUnit.USD);
const rows = evidence.catalogs.flatMap(c=>c.rows);
function rate(sku) {
  const matches = rows.filter(r=>r.sku===sku);
  if(matches.length!==1) throw new Error(`Missing/ambiguous SKU: ${sku}`);
  const value = Number(matches[0].pricePerUnit.USD);
  if(!Number.isFinite(value)) throw new Error(`Invalid price: ${sku}`);
  return value;
}
const eks = evidence.websiteRates.find(r=>r.key==='eks').rate;
const ip = evidence.websiteRates.find(r=>r.key==='ipv4').rate;
const scenarios = [12,24,48,72].map(hours=>{
  const costs = {
    eks:eks*hours,
    workers:rate('YNF8U8R6NK3DHPTM')*2*hours,
    rds:rate('QT9S5MUGTQZ7NNWZ')*hours,
    redis:rate('DGSDTRJPVT6GES4T')*hours,
    mq:rate('VNRE2UB57F9ZNK3Q')*hours,
    alb:rate('VUV9M7PZ543S2SC9')*hours,
    nat:rate('P63FHTYZXQBC6HX5')*hours,
    baseIpv4:ip*3*hours,
    // 별도 중지 자동화가 없으므로 Jenkins도 전체 가동시간으로 계산한다.
    jenkins:jenkinsRate*hours,
    // k6는 기존 로컬 PC에서 실행한다. 별도 EC2 발생기는 현재 Terraform에 없다.
    ebs:rate('MTK7D9SGKGYR3JD6')*70*hours/730,
    rdsStorage:rate('3TZJNNJAT7WAYW56')*20*hours/730,
    mqStorage:rate('7V99YDCKWQACRR4R')*200*hours/730
  };
  const round=value=>Math.round(value*100)/100;
  return {hours, costs:Object.fromEntries(Object.entries(costs).map(([k,v])=>[k,round(v)])), totalUSD:round(Object.values(costs).reduce((a,b)=>a+b,0))};
});
console.log(JSON.stringify({currency:'USD',notice:'Historical 2026-11-06/08 rates, not a live quote or spending cap. Jenkins enabled for the full scenario; 40 GiB workers + 30 GiB Jenkins EBS; local k6, no extra load-generator EC2. Variable usage, monitoring charges, taxes and Vercel fees excluded.',scenarios},null,2));
