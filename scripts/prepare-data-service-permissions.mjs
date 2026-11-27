import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateAccount} from './deploy-identity-scope.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const dataTags = {Project: 'orderpage', Environment: 'dev', ManagedBy: 'terraform'};
export function renderDataServicePermissions(accountId) {
  validateAccount(accountId);
  const arn = (service, tail) => `arn:aws:${service}:ap-northeast-2:${accountId}:${tail}`;
  const db = arn('rds', 'db:orderpage-dev-mariadb');
  const pg = arn('rds', 'pg:orderpage-dev-mariadb-parameter-group');
  const sub = arn('rds', 'subgrp:orderpage-dev-mariadb-subnet-group');
  const og = arn('rds', 'og:default:mariadb-10-11');
  const redis = arn('elasticache', 'replicationgroup:orderpage-dev-redis');
  const child = arn('elasticache', 'cluster:orderpage-dev-redis-*');
  const redisSub = arn('elasticache', 'subnetgroup:orderpage-dev-redis-subnet-group');
  const redisPg = arn('elasticache', 'parametergroup:default.redis7');
  const broker = arn('mq', 'broker:orderpage-dev-rabbitmq:*');
  const request = Object.fromEntries(Object.entries(dataTags).map(([k,v]) => ['aws:RequestTag/' + k,v]));
  const owned = Object.fromEntries(Object.entries(dataTags).map(([k,v]) => ['aws:ResourceTag/' + k,v]));
  const global = {'aws:RequestedRegion':'ap-northeast-2','aws:PrincipalAccount':accountId};
  const allow = (Sid, Action, Resource, condition = {}) => ({Sid,Effect:'Allow',Action,Resource,Condition:{...condition,StringEquals:{...global,...condition.StringEquals}}});
  const rds = [
    allow('CreatePrivateSmallMariaDb',['rds:CreateDBInstance'],[db],{StringEquals:{...request,'rds:DatabaseEngine':'mariadb','rds:DatabaseClass':'db.t4g.micro','rds:DatabaseName':'ordersystem'},Bool:{'rds:StorageEncrypted':'true','rds:MultiAz':'false','rds:PubliclyAccessible':'false'},NumericLessThanEquals:{'rds:StorageSize':'20'}}),
    // 생성할 DB의 설정 조건을 기존 parameter/subnet/option group에 적용하지 않는다.
    allow('DbProjectParents',['rds:CreateDBInstance','rds:ModifyDBInstance'],[pg,sub]),
    allow('DefaultMariaDbOptionGroup',['rds:CreateDBInstance','rds:ModifyDBInstance'],[og]),
    allow('CreateDbSubnetGroup',['rds:CreateDBSubnetGroup'],[sub],{StringEquals:request}),
    allow('CreateDbParameterGroup',['rds:CreateDBParameterGroup'],[pg],{StringEquals:request}),
    allow('ManageDbSubnetGroup',['rds:ModifyDBSubnetGroup','rds:DeleteDBSubnetGroup'],[sub]),
    allow('ManageDbParameterGroup',['rds:ModifyDBParameterGroup','rds:ResetDBParameterGroup','rds:DeleteDBParameterGroup'],[pg]),
    // PubliclyAccessible은 ModifyDBInstance의 지원 조건 키가 아니다. 공개 전환 방지는 plan에서 검사한다.
    allow('ModifySmallMariaDb',['rds:ModifyDBInstance'],[db],{StringEqualsIfExists:{'rds:DatabaseClass':'db.t4g.micro'},NumericLessThanEqualsIfExists:{'rds:StorageSize':'20'},BoolIfExists:{'rds:MultiAz':'false','rds:StorageEncrypted':'true'}}),
    allow('RebootOrDeleteMariaDb',['rds:RebootDBInstance','rds:DeleteDBInstance'],[db])
  ];
  const cache = [
    allow('CreateRedisSubnet',['elasticache:CreateCacheSubnetGroup'],[redisSub],{StringEquals:request}),
    allow('ManageRedisSubnet',['elasticache:ModifyCacheSubnetGroup','elasticache:DeleteCacheSubnetGroup'],[redisSub]),
    allow('CreateSmallEncryptedRedis',['elasticache:CreateReplicationGroup'],[redis],{StringEquals:request,StringEqualsIgnoreCase:{'elasticache:CacheNodeType':'cache.t4g.micro','elasticache:CacheParameterGroupName':'default.redis7','elasticache:EngineType':'redis','elasticache:EngineVersion':'7.1'},Bool:{'elasticache:AtRestEncryptionEnabled':'true','elasticache:AuthTokenEnabled':'true','elasticache:TransitEncryptionEnabled':'true','elasticache:AutomaticFailoverEnabled':'false','elasticache:MultiAZEnabled':'false','elasticache:ClusterModeEnabled':'false'},NumericLessThanEquals:{'elasticache:SnapshotRetentionLimit':'1'}}),
    // 자식 cluster ARN은 AWS가 붙이는 접미사만 허용. 실제 수량은 plan에서 1개로 검사한다.
    allow('RedisCreateDependencies',['elasticache:CreateReplicationGroup'],[child,redisSub,redisPg]),
    // AuthTokenEnabled는 토큰을 보내지 않은 부분 요청에도 false일 수 있다. 갱신 인증/TLS는 plan 재검토 대상이다.
    allow('ModifyNamedSmallRedis',['elasticache:ModifyReplicationGroup'],[redis],{StringEqualsIgnoreCaseIfExists:{'elasticache:CacheNodeType':'cache.t4g.micro','elasticache:CacheParameterGroupName':'default.redis7'},NumericLessThanEqualsIfExists:{'elasticache:SnapshotRetentionLimit':'1'}}),
    allow('RedisModifyDefaultParameter',['elasticache:ModifyReplicationGroup'],[redisPg]),
    allow('DeleteRedis',['elasticache:DeleteReplicationGroup'],[redis])
  ];
  const mq = [
    // CreateBroker는 resource-level 제한 미지원. 가짜 broker ARN이나 비지원 instance 조건을 넣지 않는다.
    allow('CreateTaggedBroker',['mq:CreateBroker'],'*',{StringEquals:request}),
    allow('ManageNamedRabbitBroker',['mq:UpdateBroker','mq:RebootBroker','mq:DeleteBroker'],[broker])
  ];
  const scopes = [
    {statements:rds, resources:[db,pg,sub],add:'rds:AddTagsToResource',remove:'rds:RemoveTagsFromResource'},
    {statements:cache, resources:[redis,child,redisSub],add:'elasticache:AddTagsToResource',remove:'elasticache:RemoveTagsFromResource'},
    {statements:mq, resources:[broker],add:'mq:CreateTags',remove:'mq:DeleteTags'}
  ];
  scopes.forEach(({statements,resources,add,remove},i) => {
    // 생성 의존 태깅은 ResourceTag가 없을 수 있다. 명명 범위 + 요청 태그로 허용한다.
    statements.push(allow('TagNewNamedResources'+i,[add],resources,{StringEquals:request}));
    statements.push(allow('TagExistingOwnedResources'+i,[add,remove],resources,{StringEquals:owned}));
  });
  const resources = scopes.flatMap(s=>s.resources), add = scopes.map(s=>s.add), remove=scopes.map(s=>s.remove);
  const guard = [
    {Sid:'KeepOwnerKeys',Effect:'Deny',Action:remove,Resource:resources,Condition:{'ForAnyValue:StringEqualsIgnoreCase':{'aws:TagKeys':Object.keys(dataTags)}}},
    {Sid:'RequireDeleteKeys',Effect:'Deny',Action:remove,Resource:resources,Condition:{Null:{'aws:TagKeys':'true'}}}
  ];
  for(const [key,value] of Object.entries(dataTags)) guard.push({Sid:'Keep'+key,Effect:'Deny',Action:add,Resource:resources,Condition:{Null:{['aws:RequestTag/'+key]:'false'},StringNotEquals:{['aws:RequestTag/'+key]:value}}});
  guard.push({Sid:'NoUnplannedDataProducts',Effect:'Deny',Action:['rds:CreateDBCluster','rds:CreateDBInstanceReadReplica','rds:RestoreDBInstanceFromDBSnapshot','rds:RestoreDBInstanceToPointInTime','elasticache:CreateCacheCluster','elasticache:CreateServerlessCache','elasticache:CreateGlobalReplicationGroup','elasticache:IncreaseReplicaCount','elasticache:DecreaseReplicaCount','elasticache:ModifyReplicationGroupShardConfiguration','mq:CreateConfiguration','mq:CreateReplicaBroker','mq:UpdateBrokerAccessConfiguration'],Resource:'*'});
  guard.push({Sid:'SeoulDataWritesOnly',Effect:'Deny',Action:[...new Set([...rds,...cache,...mq].flatMap(s=>s.Action))],Resource:'*',Condition:{StringNotEquals:{'aws:RequestedRegion':'ap-northeast-2'}}});
  const files={},policies=[];
  for(const [name,Statement] of Object.entries({OrderPageMariaDbLifecycle:rds,OrderPageRedisLifecycle:cache,OrderPageRabbitMqLifecycle:mq,OrderPageDataGuardrails:guard})) {
    const document={Version:'2012-10-17',Statement},compact=JSON.stringify(document);
    if(compact.length>6144||compact.includes('{{'))throw Error('정책 크기·치환 검사 실패');
    files[name+'.json']=JSON.stringify(document,null,2)+'\n';
    policies.push({name,characters:compact.length,sha256:createHash('sha256').update(compact).digest('hex')});
  }
  files['manifest.json']=JSON.stringify({status:'REVIEW_ONLY_DO_NOT_ATTACH',readyForApply:false,policies,
    limitations:['Requires existing read, IAM/SLR, network and future logging permissions; not standalone.','MQ creation has Resource=*; name/type/mode/public access are plan checks, not IAM limits.','RDS and Redis partial updates do not enforce every security setting; parameter contents and user changes require review.','No spending cap or proof of effective AWS permissions. Named-resource tagging does not establish exclusive ownership.'],
    pending:['Logging delivery, storage, certificates, monitoring and cost permissions','Actual policy validation and attachment quota review','Budget/runtime, refreshed plan, create/cleanup verification']},null,2)+'\n';
  return files;
}

export function writeDataServicePermissions(accountId,repoRoot=root) {
  const files=renderDataServicePermissions(accountId),local=path.join(repoRoot,'.local');
  if(fs.existsSync(local)&&fs.lstatSync(local).isSymbolicLink())throw Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local,{recursive:true});const output=path.join(local,'iam-data-service-review');fs.mkdirSync(output);
  for(const [name,content] of Object.entries(files))fs.writeFileSync(path.join(output,name),content,{flag:'wx',mode:0o600});
  return Object.keys(files);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {if(process.argv.length!==3)throw Error('사용법: node scripts/prepare-data-service-permissions.mjs <12자리 계정 ID>');console.log(`검토 파일 ${writeDataServicePermissions(process.argv[2]).length}개 생성. AWS 변경 없음. 아직 연결하지 마세요.`);}
  catch(error){console.error(error.code?'파일 생성 실패: 기존 출력 폴더 또는 경로 권한을 확인하세요.':error.message);process.exitCode=1;}
}
