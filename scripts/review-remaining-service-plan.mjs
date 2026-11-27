import {apiDomain,alarmNames,logNames} from './prepare-remaining-service-permissions.mjs';

// 알려진 설정만 검증한다. ARN에 의존한 정책/알림 목적지가 unknown이면 통과로 위장하지 않는다.
export function reviewRemainingServicePlan(plan,{accountId,email}) {
  if(!Array.isArray(plan?.resource_changes))throw Error('plan이 필요합니다.');
  const counts={aws_ecr_repository:1,aws_ecr_lifecycle_policy:1,aws_s3_bucket:1,aws_s3_bucket_ownership_controls:1,aws_s3_bucket_public_access_block:1,aws_s3_bucket_server_side_encryption_configuration:1,aws_s3_bucket_policy:1,aws_acm_certificate:1,aws_cloudwatch_log_group:5,aws_sns_topic:1,aws_sns_topic_policy:1,aws_sns_topic_subscription:1,aws_cloudwatch_metric_alarm:7,aws_cloudwatch_dashboard:1};
  const selected=plan.resource_changes.filter(r=>r.mode==='managed'&&/^(aws_ecr_|aws_s3_|aws_acm_|aws_cloudwatch_|aws_sns_|aws_budgets_)/.test(r.type));
  const rows=t=>selected.filter(r=>r.type===t),value=t=>rows(t)[0]?.change?.after||{};
  const checks=[],deferred=[];const check=(name,ok)=>checks.push({name,passed:Boolean(ok)});
  check('reviewed-resource-count',selected.length===24&&Object.entries(counts).every(([t,n])=>rows(t).length===n));
  check('no-delete-replacement',selected.every(r=>r.change.actions.length===1&&['create','no-op','update'].includes(r.change.actions[0])));
  const bucket=`arn:aws:s3:::orderpage-dev-product-images-${accountId}`,topic=`arn:aws:sns:ap-northeast-2:${accountId}:orderpage-dev-operations`;
  const ecr=value('aws_ecr_repository');
  check('ecr-immutable-encrypted-scanned',ecr.name==='orderpage-backend'&&ecr.image_tag_mutability==='IMMUTABLE'&&ecr.encryption_configuration?.length===1&&ecr.encryption_configuration[0].encryption_type==='AES256'&&ecr.image_scanning_configuration?.[0]?.scan_on_push===true&&ecr.force_delete===false);
  let lifecycle;try{lifecycle=JSON.parse(value('aws_ecr_lifecycle_policy').policy);}catch{}
  check('ecr-keep-thirty-images',lifecycle?.rules?.length===1&&lifecycle.rules[0].selection?.tagStatus==='any'&&lifecycle.rules[0].selection?.countType==='imageCountMoreThan'&&lifecycle.rules[0].selection?.countNumber===30&&lifecycle.rules[0].action?.type==='expire');
  check('dedicated-product-bucket',value('aws_s3_bucket').bucket===bucket.slice(13)&&value('aws_s3_bucket').force_destroy===false);
  const bpa=value('aws_s3_bucket_public_access_block');
  check('product-public-read-design',bpa.block_public_acls===true&&bpa.ignore_public_acls===true&&bpa.block_public_policy===false&&bpa.restrict_public_buckets===false&&value('aws_s3_bucket_ownership_controls').rule?.[0]?.object_ownership==='BucketOwnerEnforced');
  check('product-aes256',value('aws_s3_bucket_server_side_encryption_configuration').rule?.[0]?.apply_server_side_encryption_by_default?.[0]?.sse_algorithm==='AES256');
  const cert=value('aws_acm_certificate');
  check('api-domain-dns-validation',cert.domain_name===apiDomain&&cert.validation_method==='DNS'&&(cert.subject_alternative_names||[]).every(n=>n===apiDomain)&&!cert.certificate_authority_arn&&!cert.private_key&&!cert.certificate_body);
  check('five-named-three-day-logs',rows('aws_cloudwatch_log_group').every(r=>logNames.includes(r.change.after.name)&&r.change.after.retention_in_days===3&&r.change.after.skip_destroy===false)&&new Set(rows('aws_cloudwatch_log_group').map(r=>r.change.after.name)).size===5);
  check('named-operations-topic',value('aws_sns_topic').name==='orderpage-dev-operations');
  const sub=value('aws_sns_topic_subscription');
  check('email-requires-owner-confirmation',sub.protocol==='email'&&sub.endpoint===email&&sub.endpoint_auto_confirms===false);
  check('named-initial-alarms',rows('aws_cloudwatch_metric_alarm').every(r=>alarmNames.slice(0,7).includes(r.change.after.alarm_name?.replace('orderpage-dev-',''))));
  check('alarm-evaluation-windows',rows('aws_cloudwatch_metric_alarm').every(r=>{const a=r.change.after;return a.actions_enabled===true&&a.period===(a.alarm_name.endsWith('jenkins-status')?300:60)&&a.evaluation_periods===(a.period===300?2:3)&&a.datapoints_to_alarm===2;}));
  check('named-dashboard',value('aws_cloudwatch_dashboard').dashboard_name==='orderpage-dev-operations');
  check('budget-not-yet-enabled',rows('aws_budgets_budget').length===0);
  for(const r of selected) {
    const fields=r.type==='aws_cloudwatch_metric_alarm'?['alarm_actions','ok_actions','insufficient_data_actions']:r.type==='aws_sns_topic_subscription'?['topic_arn']:['aws_s3_bucket_policy','aws_sns_topic_policy'].includes(r.type)?['policy']:[];
    for(const field of fields){
      const v=r.change.after[field],unknown=r.change.after_unknown?.[field];
      const hasUnknown=v=>v===true||(v&&typeof v==='object'&&Object.values(v).some(hasUnknown));
      if(v===undefined||hasUnknown(unknown)){deferred.push({address:r.address,field});continue;}
      if(field==='policy') {
        let policy;try{policy=JSON.parse(v);}catch{}
        if(r.type==='aws_s3_bucket_policy') {
          const expected=[{Sid:'PublicImageReadOverHttps',Effect:'Allow',Principal:'*',Action:'s3:GetObject',Resource:bucket+'/*',Condition:{Bool:{'aws:SecureTransport':'true'}}},{Sid:'DenyInsecureTransport',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[bucket,bucket+'/*'],Condition:{Bool:{'aws:SecureTransport':'false'}}}];
          const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort()):x);
          check('product-policy-exact',canonical(policy)===canonical({Version:'2012-10-17',Statement:expected}));
        }else deferred.push({address:r.address,field:'policy-body-manual-review'});
      }else check('destination-'+r.address+'-'+field,field==='topic_arn'?v===topic:Array.isArray(v)&&v.every(x=>x===topic));
    }
  }
  return {resourceCount:selected.length,checks,knownSettingsPassed:checks.every(c=>c.passed),deferred,readyForApply:false,
    pending:['Budget/runtime unset; not a spending cap.','Review computed policy bodies, alarm destinations and DNS validation after resource IDs resolve.','Live IAM authorization, SNS email confirmation and alarm delivery remain untested.']};
}
