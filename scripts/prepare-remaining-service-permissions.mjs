import {validateAccount} from './deploy-identity-scope.mjs';

export const apiDomain = 'api-devops.auctionbid.shop';
export const logNames = [
  '/aws/eks/orderpage-dev/cluster',
  '/aws/rds/instance/orderpage-dev-mariadb/error',
  '/aws/rds/instance/orderpage-dev-mariadb/slowquery',
  '/aws/elasticache/orderpage-dev-redis/engine-log',
  '/aws/elasticache/orderpage-dev-redis/slow-log'
];
export const alarmNames = ['rds-cpu','rds-memory','rds-storage','redis-memory','redis-cpu','mq-ready','jenkins-status','api-healthy-hosts','api-alb-5xx','api-target-5xx'];

// 이메일이 들어간 결과는 .local에만 저장한다. 이 함수에는 AWS 호출이 없다.
export function renderRemainingServicePermissions(accountId, email) {
  validateAccount(accountId);
  if (typeof email !== 'string' || !/^[A-Za-z0-9.!#$%&'+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\s\S])/.test(email) || email.length > 254) throw Error('알림 이메일 형식을 확인하세요.');
  const arn = (service, tail) => `arn:aws:${service}:ap-northeast-2:${accountId}:${tail}`;
  const tags = {Project:'orderpage',Environment:'dev',ManagedBy:'terraform'};
  const request = Object.fromEntries(Object.entries(tags).map(([k,v])=>['aws:RequestTag/'+k,v]));
  const owned = Object.fromEntries(Object.entries(tags).map(([k,v])=>['aws:ResourceTag/'+k,v]));
  const allow = (Sid,Action,Resource,condition={},region='ap-northeast-2') => ({Sid,Effect:'Allow',Action,Resource,Condition:{...condition,StringEquals:{'aws:PrincipalAccount':accountId,...(region?{'aws:RequestedRegion':region}:{}),...condition.StringEquals}}});
  const bucket = `arn:aws:s3:::orderpage-dev-product-images-${accountId}`;
  const repository = arn('ecr','repository/orderpage-backend');
  const cert = arn('acm','certificate/*');
  const topic = arn('sns','orderpage-dev-operations');
  const alarms = alarmNames.map(n=>arn('cloudwatch','alarm:orderpage-dev-'+n));
  const dashboard = `arn:aws:cloudwatch::${accountId}:dashboard/orderpage-dev-operations`;
  const budget = `arn:aws:budgets::${accountId}:budget/orderpage-dev-account-monthly`;
  const logs = logNames.map(n=>arn('logs','log-group:'+n));
  const storage = [
    // provider 5.100.0은 버킷 생성 후 태깅한다. CreateBucket에 RequestTag를 요구하면 생성이 막힌다.
    allow('CreateProductBucket',['s3:CreateBucket'],bucket,{StringEquals:{'s3:locationconstraint':'ap-northeast-2'},Bool:{'aws:SecureTransport':'true'}}),
    allow('ManageProductBucket',['s3:DeleteBucket','s3:PutBucketTagging','s3:PutBucketPolicy','s3:DeleteBucketPolicy','s3:PutBucketPublicAccessBlock','s3:PutBucketOwnershipControls','s3:PutEncryptionConfiguration'],bucket,{StringEquals:{'s3:ResourceAccount':accountId},Bool:{'aws:SecureTransport':'true'}}),
    allow('CreateBackendRepository',['ecr:CreateRepository'],repository,{StringEquals:request}),
    allow('ManageBackendRepository',['ecr:DeleteRepository','ecr:PutLifecyclePolicy','ecr:DeleteLifecyclePolicy','ecr:PutImageTagMutability','ecr:PutImageScanningConfiguration','ecr:TagResource','ecr:UntagResource'],repository),
    // RequestCertificate는 ARN 제한 미지원. SAN을 포함한 모든 도메인을 한 주소로 한정한다.
    allow('RequestApiCertificate',['acm:RequestCertificate'],'*',{StringEquals:{...request,'acm:ValidationMethod':'DNS'},'ForAllValues:StringEquals':{'acm:DomainNames':[apiDomain]},Null:{'acm:DomainNames':'false'},StringEqualsIfExists:{'acm:Export':'DISABLED'}}),
    allow('ManageOwnedCertificates',['acm:DeleteCertificate','acm:UpdateCertificateOptions','acm:AddTagsToCertificate','acm:RemoveTagsFromCertificate'],cert,{StringEquals:owned}),
    allow('InitialCertificateTags',['acm:AddTagsToCertificate'],cert,{StringEquals:request})
  ];
  const monitoring = [
    allow('CreateOperationsTopic',['sns:CreateTopic'],topic,{StringEquals:request}),
    allow('ManageOperationsTopic',['sns:SetTopicAttributes','sns:DeleteTopic','sns:TagResource','sns:UntagResource','sns:GetSubscriptionAttributes','sns:SetSubscriptionAttributes','sns:Unsubscribe'],topic),
    // Subscription API도 IAM에서는 topic ARN을 사용한다. 구독 생성은 지정 이메일만 허용한다.
    allow('SubscribeOperationsEmail',['sns:Subscribe'],topic,{StringEquals:{'sns:Protocol':'email','sns:Endpoint':email}}),
    allow('WriteOperationsAlarms',['cloudwatch:PutMetricAlarm'],alarms,{'ForAllValues:StringEquals':{'cloudwatch:AlarmActions':[topic]},Null:{'cloudwatch:AlarmActions':'false'}}),
    allow('ManageOperationsAlarms',['cloudwatch:DeleteAlarms','cloudwatch:TagResource','cloudwatch:UntagResource'],alarms),
    allow('ManageOperationsDashboard',['cloudwatch:PutDashboard','cloudwatch:DeleteDashboards'],dashboard),
    allow('ReadOperationalMetrics',['cloudwatch:GetMetricData','cloudwatch:GetMetricStatistics','cloudwatch:ListMetrics'],'*')
  ];
  const logging = [
    allow('CreateProjectLogs',['logs:CreateLogGroup'],logs.map(a=>a+':*'),{StringEquals:request}),
    allow('ManageProjectLogs',['logs:DeleteLogGroup','logs:PutRetentionPolicy','logs:DeleteRetentionPolicy','logs:TagLogGroup','logs:UntagLogGroup'],logs.map(a=>a+':*')),
    // 새 TagResource API에는 :* 없는 ARN, 기존 LogGroup API에는 :* ARN을 사용한다.
    allow('TagProjectLogs',['logs:TagResource','logs:UntagResource'],logs),
    allow('SetManagedBrokerLogRetention',['logs:PutRetentionPolicy'],arn('logs','log-group:/aws/amazonmq/broker/b-*/general:*')),
    // Redis 로그 전달에 AWS가 요구하는 계정·리전 범위 권한. log-group ARN으로 제한할 수 없다.
    allow('ConfigureRegionalLogDelivery',['logs:CreateLogDelivery','logs:GetLogDelivery','logs:UpdateLogDelivery','logs:DeleteLogDelivery','logs:ListLogDeliveries','logs:PutResourcePolicy','logs:DescribeResourcePolicies','logs:DescribeLogGroups'],'*')
  ];
  const costs = [
    // Budgets API의 Create/Update/Delete/notification/subscriber는 IAM의 ModifyBudget으로 평가된다.
    allow('ManageSingleMonthlyBudget',['budgets:ModifyBudget','budgets:TagResource','budgets:UntagResource'],budget,{},null),
    // Cost Explorer는 us-east-1 endpoint. 실행 시 API 조회 요금이 발생할 수 있으며 자동 호출하지 않는다.
    allow('ReadCostReport',['ce:GetCostAndUsage'],'*',{},'us-east-1'),
    {Sid:'NoExportableCertificates',Effect:'Deny',Action:'acm:RequestCertificate',Resource:'*',Condition:{StringEquals:{'acm:Export':'ENABLED'}}},
    {Sid:'NoUnplannedBillingAutomation',Effect:'Deny',Action:['ce:CreateAnomalyMonitor','ce:UpdateAnomalyMonitor','ce:DeleteAnomalyMonitor','ce:CreateAnomalySubscription','ce:UpdateAnomalySubscription','ce:DeleteAnomalySubscription','budgets:CreateBudgetAction','budgets:UpdateBudgetAction','budgets:ExecuteBudgetAction'],Resource:'*'},
    {Sid:'ProductBucketRequiresTls',Effect:'Deny',Action:'s3:*',Resource:[bucket,bucket+'/*'],Condition:{Bool:{'aws:SecureTransport':'false'}}},
    {Sid:'PreserveCertificateOwnerKeys',Effect:'Deny',Action:'acm:RemoveTagsFromCertificate',Resource:cert,Condition:{'ForAnyValue:StringEqualsIgnoreCase':{'aws:TagKeys':Object.keys(tags)}}}
  ];
  for(const [key,value] of Object.entries(tags)) costs.push({Sid:'PreserveCertificate'+key,Effect:'Deny',Action:'acm:AddTagsToCertificate',Resource:cert,Condition:{Null:{['aws:RequestTag/'+key]:'false'},StringNotEquals:{['aws:RequestTag/'+key]:value}}});
  const files={};
  for(const [name,Statement] of Object.entries({OrderPageStorageCertificateLifecycle:storage,OrderPageOperationsLifecycle:monitoring,OrderPageLogDeliveryLifecycle:logging,OrderPageCostAndRemainingGuards:costs})) files[name+'.json']=JSON.stringify({Version:'2012-10-17',Statement},null,2)+'\n';
  return files;
}
