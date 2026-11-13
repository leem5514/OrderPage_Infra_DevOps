import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {collectCosts,validateCostSettings,awsRead} from '../export-costs.mjs';
const settings={accountId:'123456789012',start:'2026-11-06',end:'2026-11-09',projectTagValue:'orderpage'};
const now=new Date('2026-11-08T12:00:00Z');
const page=(service,amount)=>({ResultsByTime:[{TimePeriod:{Start:settings.start,End:settings.end},Estimated:true,Groups:[{Keys:[service],Metrics:{UnblendedCost:{Amount:amount,Unit:'USD'}}}]}]});
test('실제 날짜/계정/7일 제한 검사, 잘못된 설정은 AWS 호출 전 거부',async()=>{
  for(const bad of [{end:'2026-11-06'},{end:'2026-11-14'},{start:'2026-02-30'},{accountId:'wrong'},{secret:'forbidden'}]){
    let calls=0;await assert.rejects(()=>collectCosts({...settings,...bad},()=>{calls++;},now));assert.equal(calls,0);
  }
  assert.equal(validateCostSettings(settings,now),settings);
});
test('다른 계정 인증이면 유료 CE 호출 전에 중단',async()=>{
  const calls=[];await assert.rejects(()=>collectCosts(settings,(service)=>{calls.push(service);return {Account:'999999999999'};},now));assert.deepEqual(calls,['sts']);
});
test('account와 tag 결과를 분리하고 pagination/예상치/원본 소수를 보존',async()=>{
  const calls=[];
  const read=(service,op,input,region)=>{
    calls.push({service,op,input,region});if(service==='sts')return {Account:settings.accountId};
    assert.equal(region,'us-east-1');assert.equal(input.Granularity,'DAILY');
    if(input.Filter.And)return page('Amazon S3','0.0000012345');
    if(input.NextPageToken)return page('Amazon RDS','2.34567890');
    return {...page('Amazon EKS','1.23456789'),NextPageToken:'next'};
  };
  const result=await collectCosts(settings,read,now);
  assert.equal(result.ceRequests,3);assert.equal(result.scopes.account.rows.length,2);
  assert.equal(result.scopes.projectTagged.rows[0].amount,'0.0000012345');
  assert.ok(result.scopes.account.rows[0].estimated);
  assert.equal(calls[1].input.Filter.Dimensions.Key,'LINKED_ACCOUNT');
});
test('조회 결과 없음은 0 USD로 변환하지 않음',async()=>{
  const result=await collectCosts({...settings,projectTagValue:null},(s)=>s==='sts'?{Account:settings.accountId}:{ResultsByTime:[]},now);
  assert.equal(result.scopes.account.status,'no-data');assert.equal(result.scopes.account.rows.length,0);assert.equal(result.ceRequests,1);
});
test('반복 pagination/10페이지 초과/중간 오류를 성공으로 취급하지 않음',async()=>{
  for(const mode of ['repeat','limit','error']){
    let calls=0;
    await assert.rejects(()=>collectCosts(settings,(s)=>{
      if(s==='sts')return {Account:settings.accountId};calls++;
      if(mode==='error')throw Error('mock API failure');
      return {...page('Amazon S3','1'),NextPageToken:mode==='repeat'?'same':String(calls)};
    },now));
    assert.ok(calls<=10);
  }
});
test('CLI는 shell 없이 지역/읽기 요청만 전달하고 자동 pagination을 끔',()=>{
  let captured;
  awsRead('ce','get-cost-and-usage',{Filter:{Tags:{Values:['literal $() `text`']}}},'us-east-1',(command,args,options)=>{captured={command,args,options};return '{}';});
  assert.equal(captured.command,'aws');assert.ok(captured.args.includes('--no-paginate'));
  assert.equal(captured.options.shell,undefined);assert.ok(!captured.args.includes('--access-key'));
});
test('Cost Anomaly 예시는 전부 주석이며 실제 생성 리소스 없음',()=>{
  const text=fs.readFileSync(new URL('../../terraform/envs/dev/cost-anomaly.disabled.tf',import.meta.url),'utf8');
  assert.ok(text.split(/\r?\n/).every(line=>!line.trim()||line.trim().startsWith('#')));
});
