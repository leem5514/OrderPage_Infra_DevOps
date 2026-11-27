import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderDataServicePermissions,writeDataServicePermissions,dataTags} from '../prepare-data-service-permissions.mjs';
import {renderDeployDelegation} from '../prepare-deploy-delegation.mjs';
import {renderEksServicePermissions} from '../prepare-eks-service-permissions.mjs';
import {renderNetworkComputePermissions} from '../prepare-network-compute-permissions.mjs';
import {reviewDataServicePlan} from '../review-data-service-plan.mjs';
import {evaluate} from './helpers/delegation-policy-evaluator.mjs';
const account='123456789012',version='10.11.19',files=renderDataServicePermissions(account);
const docs=f=>Object.entries(f).filter(([n])=>n!=='manifest.json').map(([,s])=>JSON.parse(s));
const own=docs(files),policies=[...own,...docs(renderDeployDelegation(account)),...docs(renderEksServicePermissions(account,'1.35')),...docs(renderNetworkComputePermissions(account,'ami-0123456789abcdef0'))];
const arn=(s,t)=>`arn:aws:${s}:ap-northeast-2:${account}:${t}`;
const db=arn('rds','db:orderpage-dev-mariadb'),pg=arn('rds','pg:orderpage-dev-mariadb-parameter-group'),sub=arn('rds','subgrp:orderpage-dev-mariadb-subnet-group');
const redis=arn('elasticache','replicationgroup:orderpage-dev-redis'),broker=arn('mq','broker:orderpage-dev-rabbitmq:test-id');
const global={'aws:RequestedRegion':'ap-northeast-2','aws:PrincipalAccount':account};
const request=Object.fromEntries(Object.entries(dataTags).map(([k,v])=>['aws:RequestTag/'+k,v]));
const owned=Object.fromEntries(Object.entries(dataTags).map(([k,v])=>['aws:ResourceTag/'+k,v]));
const run=(action,resource,context={},extra=[])=>evaluate([...policies,...extra],{action,resource,context:{...global,...context}});
const broad={Statement:[{Effect:'Allow',Action:['rds:*','elasticache:*','mq:*'],Resource:'*'}]};
const dbCreate={...request,'rds:DatabaseEngine':'mariadb','rds:DatabaseClass':'db.t4g.micro','rds:DatabaseName':'ordersystem','rds:StorageEncrypted':true,'rds:MultiAz':false,'rds:PubliclyAccessible':false,'rds:StorageSize':20};
const cacheCreate={...request,'elasticache:CacheNodeType':'cache.t4g.micro','elasticache:CacheParameterGroupName':'default.redis7','elasticache:EngineType':'redis','elasticache:EngineVersion':'7.1','elasticache:AtRestEncryptionEnabled':true,'elasticache:AuthTokenEnabled':true,'elasticache:TransitEncryptionEnabled':true,'elasticache:AutomaticFailoverEnabled':false,'elasticache:MultiAZEnabled':false,'elasticache:ClusterModeEnabled':false,'elasticache:SnapshotRetentionLimit':1};

test('RDS 생성은 지정 DB·작은 타입·20GiB 이하·암호화·private만 허용한다',()=>{
  assert.equal(run('rds:CreateDBInstance',db,dbCreate),'allowed');
  for(const [key,value] of [['rds:DatabaseClass','db.r7g.16xlarge'],['rds:StorageSize',1000],['rds:StorageEncrypted',false],['rds:MultiAz',true],['rds:PubliclyAccessible',true],['rds:DatabaseEngine','postgres']])assert.equal(run('rds:CreateDBInstance',db,{...dbCreate,[key]:value}),'implicitDeny',key);
  for(const key of ['aws:RequestTag/Project','rds:PubliclyAccessible','rds:StorageSize']){const c={...dbCreate};delete c[key];assert.equal(run('rds:CreateDBInstance',db,c),'implicitDeny');}
  assert.equal(run('rds:CreateDBInstance',db+'-other',dbCreate),'implicitDeny');
  assert.equal(run('rds:CreateDBInstance',db.replace(account,'111122223333'),dbCreate),'implicitDeny');
});
test('DB 부모·보조 자원과 부분 갱신·정리 범위를 구분한다',()=>{
  for(const r of [pg,sub,arn('rds','og:default:mariadb-10-11')])for(const a of ['rds:CreateDBInstance','rds:ModifyDBInstance'])assert.equal(run(a,r),'allowed');
  assert.equal(run('rds:CreateDBInstance',arn('rds','pg:default.postgres16')),'implicitDeny');
  assert.equal(run('rds:CreateDBSubnetGroup',sub,request),'allowed');
  assert.equal(run('rds:CreateDBParameterGroup',pg,request),'allowed');
  for(const [a,r] of [['rds:ModifyDBSubnetGroup',sub],['rds:DeleteDBSubnetGroup',sub],['rds:ModifyDBParameterGroup',pg],['rds:ResetDBParameterGroup',pg],['rds:DeleteDBParameterGroup',pg],['rds:RebootDBInstance',db],['rds:DeleteDBInstance',db],['rds:ModifyDBInstance',db]]){assert.equal(run(a,r),'allowed');assert.equal(run(a,r+'-other'),'implicitDeny');}
  assert.equal(run('rds:ModifyDBInstance',db,{'rds:StorageSize':200}),'implicitDeny');
  // 이 IAM 조건으로 공개 전환을 막는다고 주장하지 않는다. 해당 키는 ModifyDBInstance에서 미지원이다.
  assert.equal(run('rds:ModifyDBInstance',db,{'rds:PubliclyAccessible':true}),'allowed');
});
test('Redis 생성과 부모·자식 ARN을 함께 검사하고 타입·암호화·인증 누락을 거부한다',()=>{
  assert.equal(run('elasticache:CreateReplicationGroup',redis,cacheCreate),'allowed');
  for(const tail of ['cluster:orderpage-dev-redis-001','subnetgroup:orderpage-dev-redis-subnet-group','parametergroup:default.redis7'])assert.equal(run('elasticache:CreateReplicationGroup',arn('elasticache',tail)),'allowed');
  assert.equal(run('elasticache:CreateReplicationGroup',arn('elasticache','cluster:other-001')),'implicitDeny');
  for(const [k,v] of [['elasticache:CacheNodeType','cache.r7g.16xlarge'],['elasticache:AuthTokenEnabled',false],['elasticache:AtRestEncryptionEnabled',false],['elasticache:TransitEncryptionEnabled',false],['elasticache:ClusterModeEnabled',true],['elasticache:SnapshotRetentionLimit',30]])assert.equal(run('elasticache:CreateReplicationGroup',redis,{...cacheCreate,[k]:v}),'implicitDeny',k);
  assert.equal(run('elasticache:CreateReplicationGroup',redis,{...cacheCreate,'elasticache:CacheNodeType':'CACHE.T4G.MICRO'}),'allowed');
  assert.equal(run('elasticache:ModifyReplicationGroup',redis),'allowed');
  assert.equal(run('elasticache:ModifyReplicationGroup',redis,{'elasticache:CacheNodeType':'cache.r7g.large'}),'implicitDeny');
  // 토큰을 생략한 정상 부분 갱신과 인증 변경을 IAM만으로 구분하지 못한다. plan 검사로 보완한다.
  assert.equal(run('elasticache:ModifyReplicationGroup',redis,{'elasticache:AuthTokenEnabled':false}),'allowed');
  assert.equal(run('elasticache:DeleteReplicationGroup',redis),'allowed');
});
test('MQ 생성은 전체 Resource가 필요하며 이후 작업은 broker 이름과 계정으로 제한한다',()=>{
  assert.equal(run('mq:CreateBroker','*',request),'allowed');
  assert.equal(run('mq:CreateBroker','*',{}),'implicitDeny');
  for(const a of ['mq:UpdateBroker','mq:RebootBroker','mq:DeleteBroker']){assert.equal(run(a,broker),'allowed');assert.equal(run(a,broker.replace('rabbitmq','other')),'implicitDeny');}
  for(const a of ['mq:CreateUser','mq:UpdateUser','mq:DeleteUser','ec2:CreateNetworkInterface'])assert.equal(run(a,broker),'implicitDeny');
  for(const name of ['rds.amazonaws.com','elasticache.amazonaws.com','mq.amazonaws.com'])assert.equal(run('iam:CreateServiceLinkedRole',`arn:aws:iam::${account}:role/aws-service-role/${name}/AWSServiceRoleFor${({ 'rds.amazonaws.com':'RDS','elasticache.amazonaws.com':'ElastiCache','mq.amazonaws.com':'AmazonMQ'})[name]}`,{'iam:AWSServiceName':name}),'allowed');
});
test('소유 태그 변경·삭제와 다른 리전·추가 제품은 별도 Allow가 있어도 거부한다',()=>{
  for(const [add,remove,r] of [['rds:AddTagsToResource','rds:RemoveTagsFromResource',db],['elasticache:AddTagsToResource','elasticache:RemoveTagsFromResource',redis],['mq:CreateTags','mq:DeleteTags',broker]]){
    assert.equal(run(add,r,request),'allowed');assert.equal(run(add,r,{...owned,'aws:RequestTag/Name':'label'}),'allowed');
    assert.equal(run(remove,r,{...owned,'aws:TagKeys':['Name']}),'allowed');
    for(const key of ['project','Environment','MANAGEDBY'])assert.equal(run(remove,r,{...owned,'aws:TagKeys':[key]},[broad]),'explicitDeny');
    assert.equal(run(remove,r,owned,[broad]),'explicitDeny');
    assert.equal(run(add,r,{...owned,'aws:RequestTag/Project':'other'},[broad]),'explicitDeny');
  }
  assert.equal(run('mq:CreateBroker','*',{...request,'aws:RequestedRegion':'us-east-1'},[broad]),'explicitDeny');
  for(const a of ['rds:CreateDBInstanceReadReplica','rds:CreateDBCluster','elasticache:CreateServerlessCache','elasticache:IncreaseReplicaCount','mq:CreateConfiguration','mq:UpdateBrokerAccessConfiguration'])assert.equal(run(a,'*',request,[broad]),'explicitDeny');
});
test('정책의 Action·Resource·Condition은 공식 서비스 참조와 맞아야 한다',()=>{
  const ref=JSON.parse(fs.readFileSync(new URL('../../iam/data-services/authorization-reference.json',import.meta.url)));
  const matches=(p,k)=>p===k||(p.includes('${')&&k.startsWith(p.split('${')[0]));
  for(const d of own)for(const s of d.Statement)for(const name of s.Action){const [service,action]=name.split(':'),a=ref.services.find(x=>x.service===service)?.actions.find(x=>x.name===action);assert.ok(a,name);if(s.Effect!=='Allow')continue;
    for(const resource of Array.isArray(s.Resource)?s.Resource:[s.Resource]){let keys=[...a.conditionKeys,'aws:RequestedRegion','aws:PrincipalAccount'];if(resource==='*')assert.equal(a.resourceLevelSupported,false,name);else{const type=resource.split(':')[5]==='broker'?'brokers':resource.split(':')[5],r=a.resources.find(x=>x.name===type);assert.ok(r,name+':'+type);keys.push(...r.conditionKeys,...r.resourceConditionKeys);}for(const values of Object.values(s.Condition||{}))for(const key of Object.keys(values))assert.ok(keys.some(p=>matches(p,key)),name+':'+key);}
  }
});

function fixture(){
  const db={identifier:'orderpage-dev-mariadb',engine:'mariadb',engine_version:version,db_name:'ordersystem',instance_class:'db.t4g.micro',multi_az:false,publicly_accessible:false,port:3306,storage_encrypted:true,storage_type:'gp3',allocated_storage:20,max_allocated_storage:0,backup_retention_period:1,performance_insights_enabled:false,deletion_protection:false,skip_final_snapshot:true,delete_automated_backups:true,db_subnet_group_name:'orderpage-dev-mariadb-subnet-group',parameter_group_name:'orderpage-dev-mariadb-parameter-group',enabled_cloudwatch_logs_exports:['error','slowquery'],auto_minor_version_upgrade:true,password:'x'.repeat(48)};
  const pg={name:'orderpage-dev-mariadb-parameter-group',family:'mariadb10.11',parameter:Object.entries({require_secure_transport:'1',slow_query_log:'1',long_query_time:'1',log_output:'FILE'}).map(([name,value])=>({name,value}))};
  const cache={replication_group_id:'orderpage-dev-redis',engine:'redis',engine_version:'7.1',node_type:'cache.t4g.micro',port:6379,num_cache_clusters:1,cluster_mode:'disabled',automatic_failover_enabled:false,multi_az_enabled:false,at_rest_encryption_enabled:'true',transit_encryption_enabled:true,transit_encryption_mode:'required',auth_token_update_strategy:'SET',subnet_group_name:'orderpage-dev-redis-subnet-group',parameter_group_name:'default.redis7',snapshot_retention_limit:1,auto_minor_version_upgrade:'true',auth_token:'x'.repeat(48),log_delivery_configuration:['engine-log','slow-log'].map(type=>({log_type:type,log_format:'json',destination_type:'cloudwatch-logs',destination:'/aws/elasticache/orderpage-dev-redis/'+type}))};
  const mq={broker_name:'orderpage-dev-rabbitmq',engine_type:'RabbitMQ',engine_version:'4.2',host_instance_type:'mq.m7g.medium',deployment_mode:'SINGLE_INSTANCE',publicly_accessible:false,encryption_options:[{use_aws_owned_key:true}],logs:[{general:true}],auto_minor_version_upgrade:true,user:[{username:'orderadmin',password:'x'.repeat(48)}]};
  return {resource_changes:Object.entries({aws_db_instance:db,aws_db_parameter_group:pg,aws_db_subnet_group:{name:'orderpage-dev-mariadb-subnet-group'},aws_elasticache_replication_group:cache,aws_elasticache_subnet_group:{name:'orderpage-dev-redis-subnet-group'},aws_mq_broker:mq}).map(([type,v])=>({type,mode:'managed',address:'module.test.'+type+'.this',change:{actions:['create'],after:{...v,tags_all:{...dataTags}},after_sensitive:{password:true,auth_token:true,user:[{password:true}]}}}))};
}
test('데이터 plan은 설정 22개를 검사하고 민감값을 결과에 복사하지 않는다',()=>{
  const p=fixture(),r=reviewDataServicePlan(p,version);assert.equal(r.passed,true);assert.equal(r.checks.length,22);assert.equal(r.readyForApply,false);assert.ok(!JSON.stringify(r).includes('x'.repeat(48)));assert.ok(r.unresolved.length>0);
});
test('큰 자원·공개 접근·무인증·클러스터 모드·삭제 및 미확정 보안 설정을 검출한다',()=>{
  for(const [type,key,value] of [['aws_db_instance','allocated_storage',200],['aws_db_instance','publicly_accessible',true],['aws_db_instance','max_allocated_storage',1000],['aws_db_instance','storage_encrypted',undefined],['aws_elasticache_replication_group','num_cache_clusters',3],['aws_elasticache_replication_group','at_rest_encryption_enabled','false'],['aws_elasticache_replication_group','transit_encryption_mode','preferred'],['aws_elasticache_replication_group','auth_token_update_strategy','DELETE'],['aws_elasticache_replication_group','cluster_mode','enabled'],['aws_mq_broker','host_instance_type','mq.m7g.16xlarge'],['aws_mq_broker','publicly_accessible',true],['aws_mq_broker','deployment_mode','CLUSTER_MULTI_AZ']]){const p=fixture();p.resource_changes.find(r=>r.type===type).change.after[key]=value;assert.equal(reviewDataServicePlan(p,version).passed,false,key);}
  const p=fixture();p.resource_changes[0].change.actions=['delete'];assert.equal(reviewDataServicePlan(p,version).passed,false);
  const insecure=fixture();insecure.resource_changes.find(r=>r.type==='aws_db_parameter_group').change.after.parameter[0].value='0';assert.equal(reviewDataServicePlan(insecure,version).passed,false);
  const unmarked=fixture();unmarked.resource_changes[0].change.after_sensitive.password=false;assert.equal(reviewDataServicePlan(unmarked,version).passed,false);
});
test('부분 요청 연산자는 누락·대소문자·잘못된 숫자와 무거운 값을 구분한다',()=>{
  assert.equal(run('elasticache:ModifyReplicationGroup',redis,{'elasticache:CacheNodeType':'CACHE.T4G.MICRO'}),'allowed');
  for(const v of [true,'NaN','',100])assert.equal(run('rds:ModifyDBInstance',db,{'rds:StorageSize':v}),'implicitDeny');
  assert.equal(run('rds:ModifyDBInstance',db,{'rds:StorageSize':'20'}),'allowed');
});
test('정책 크기·JSON 들여쓰기·로컬 저장 및 덮어쓰기 방지를 검증한다',()=>{
  for(const [n,s] of Object.entries(files)){assert.equal(s,JSON.stringify(JSON.parse(s),null,2)+'\n');if(n!=='manifest.json')assert.ok(JSON.stringify(JSON.parse(s)).length<=6144);}
  assert.equal(JSON.parse(files['manifest.json']).status,'REVIEW_ONLY_DO_NOT_ATTACH');assert.throws(()=>renderDataServicePermissions(account+'\n'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'order-data-test-'));try{assert.equal(writeDataServicePermissions(account,dir).length,5);assert.throws(()=>writeDataServicePermissions(account,dir));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
