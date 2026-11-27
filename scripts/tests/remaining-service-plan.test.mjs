import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRemainingServicePlan} from '../review-remaining-service-plan.mjs';
import {apiDomain,alarmNames,logNames} from '../prepare-remaining-service-permissions.mjs';
const input={accountId:'123456789012',email:'operator@example.invalid'};
function fixture(){
  const resources=[];
  function add(type,after,unknown={}){resources.push({mode:'managed',type,address:type+'.test'+resources.length,change:{actions:['create'],after,after_unknown:unknown}});}
  add('aws_ecr_repository',{name:'orderpage-backend',image_tag_mutability:'IMMUTABLE',encryption_configuration:[{encryption_type:'AES256'}],image_scanning_configuration:[{scan_on_push:true}],force_delete:false});
  add('aws_ecr_lifecycle_policy',{policy:JSON.stringify({rules:[{selection:{tagStatus:'any',countType:'imageCountMoreThan',countNumber:30},action:{type:'expire'}}]})});
  add('aws_s3_bucket',{bucket:'orderpage-dev-product-images-'+input.accountId,force_destroy:false});
  add('aws_s3_bucket_ownership_controls',{rule:[{object_ownership:'BucketOwnerEnforced'}]});
  add('aws_s3_bucket_public_access_block',{block_public_acls:true,ignore_public_acls:true,block_public_policy:false,restrict_public_buckets:false});
  add('aws_s3_bucket_server_side_encryption_configuration',{rule:[{apply_server_side_encryption_by_default:[{sse_algorithm:'AES256'}]}]});
  add('aws_s3_bucket_policy',{}, {policy:true});
  add('aws_acm_certificate',{domain_name:apiDomain,validation_method:'DNS',subject_alternative_names:[apiDomain]});
  for(const name of logNames)add('aws_cloudwatch_log_group',{name,retention_in_days:3,skip_destroy:false});
  add('aws_sns_topic',{name:'orderpage-dev-operations'});add('aws_sns_topic_policy',{}, {policy:true});
  add('aws_sns_topic_subscription',{protocol:'email',endpoint:input.email,endpoint_auto_confirms:false},{topic_arn:true});
  for(const name of alarmNames.slice(0,7))add('aws_cloudwatch_metric_alarm',{alarm_name:'orderpage-dev-'+name,actions_enabled:true,period:name==='jenkins-status'?300:60,evaluation_periods:name==='jenkins-status'?2:3,datapoints_to_alarm:2},{alarm_actions:[true],ok_actions:[true],insufficient_data_actions:[true]});
  add('aws_cloudwatch_dashboard',{dashboard_name:'orderpage-dev-operations'});
  return {resource_changes:resources};
}
const row=(p,type)=>p.resource_changes.find(r=>r.type===type);
test('알려진 24개 자원은 검사하되 계산 전 목적지·정책 24개는 보류한다',()=>{
  const report=reviewRemainingServicePlan(fixture(),input);
  assert.equal(report.resourceCount,24);assert.equal(report.knownSettingsPassed,true);
  assert.equal(report.deferred.length,24);assert.equal(report.readyForApply,false);
  assert.ok(!JSON.stringify(report).includes(input.email));
});
test('도메인·공개 ACL·암호화·보존 기간·이미지 정리 변경과 새 유료 자원을 감지한다',()=>{
  const cases=[['aws_acm_certificate','domain_name','api.auctionbid.shop'],['aws_s3_bucket_public_access_block','block_public_acls',false],['aws_cloudwatch_log_group','retention_in_days',0],['aws_s3_bucket','force_destroy',true],['aws_ecr_repository','image_tag_mutability','MUTABLE'],['aws_sns_topic_subscription','endpoint','other@example.invalid']];
  for(const [type,key,value] of cases){const p=fixture();row(p,type).change.after[key]=value;assert.equal(reviewRemainingServicePlan(p,input).knownSettingsPassed,false,type);}
  const p=fixture();p.resource_changes.push({mode:'managed',type:'aws_budgets_budget',address:'aws_budgets_budget.extra',change:{actions:['create'],after:{}}});
  assert.equal(reviewRemainingServicePlan(p,input).knownSettingsPassed,false);
});
test('계산 완료된 외부 알림 목적지와 공개 업로드 정책은 실패 처리한다',()=>{
  const p=fixture(),alarm=row(p,'aws_cloudwatch_metric_alarm');
  alarm.change.after.alarm_actions=['arn:aws:sns:ap-northeast-2:123456789012:other'];alarm.change.after_unknown.alarm_actions=false;
  const policy=row(p,'aws_s3_bucket_policy');policy.change.after.policy=JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:'*',Action:'s3:*',Resource:'*'}]});policy.change.after_unknown.policy=false;
  const r=reviewRemainingServicePlan(p,input);assert.equal(r.knownSettingsPassed,false);assert.ok(r.checks.some(c=>c.name==='product-policy-exact'&&!c.passed));
});
