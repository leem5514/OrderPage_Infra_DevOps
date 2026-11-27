import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dataTags} from './prepare-data-service-permissions.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function reviewDataServicePlan(plan,rdsVersion) {
  if(!/^10\.11\.\d+(?![\s\S])/.test(rdsVersion)||!Array.isArray(plan?.resource_changes))throw Error('검토한 MariaDB 버전과 plan이 필요합니다.');
  const counts={aws_db_instance:1,aws_db_parameter_group:1,aws_db_subnet_group:1,aws_elasticache_replication_group:1,aws_elasticache_subnet_group:1,aws_mq_broker:1};
  const selected=plan.resource_changes.filter(r=>r.mode==='managed'&&/^(aws_db_|aws_elasticache_|aws_mq_)/.test(r.type));
  const ofType=t=>selected.filter(r=>r.type===t), value=t=>ofType(t)[0]?.change?.after||{};
  const checks=[],check=(name,ok)=>checks.push({name,passed:Boolean(ok)});
  check('six-reviewed-data-resources',selected.length===6&&Object.entries(counts).every(([t,n])=>ofType(t).length===n));
  check('no-delete-or-replacement',selected.every(r=>r.change?.actions?.length===1&&['create','update','no-op'].includes(r.change.actions[0])));
  check('known-project-tags',selected.every(r=>Object.entries(dataTags).every(([k,v])=>r.change?.after?.tags_all?.[k]===v)));
  const db=value('aws_db_instance'),pg=value('aws_db_parameter_group'),cache=value('aws_elasticache_replication_group'),mq=value('aws_mq_broker');
  check('mariadb-name-engine-version',db.identifier==='orderpage-dev-mariadb'&&db.engine==='mariadb'&&db.engine_version===rdsVersion&&db.db_name==='ordersystem');
  check('mariadb-small-single-private',db.instance_class==='db.t4g.micro'&&db.multi_az===false&&db.publicly_accessible===false&&db.port===3306);
  check('mariadb-encrypted-fixed-storage',db.storage_encrypted===true&&db.storage_type==='gp3'&&db.allocated_storage===20&&db.max_allocated_storage===0);
  check('mariadb-backup-and-insights',db.backup_retention_period===1&&db.performance_insights_enabled===false);
  check('mariadb-lab-cleanup',db.deletion_protection===false&&db.skip_final_snapshot===true&&db.delete_automated_backups===true);
  const expected={require_secure_transport:'1',slow_query_log:'1',long_query_time:'1',log_output:'FILE'};
  check('mariadb-tls-and-log-parameters',pg.name==='orderpage-dev-mariadb-parameter-group'&&pg.family==='mariadb10.11'&&pg.parameter?.length===4&&Object.entries(expected).every(([name,value])=>pg.parameter.filter(p=>p.name===name&&p.value===value).length===1));
  check('mariadb-subnet-and-parameter-names',value('aws_db_subnet_group').name==='orderpage-dev-mariadb-subnet-group'&&db.db_subnet_group_name==='orderpage-dev-mariadb-subnet-group'&&db.parameter_group_name==='orderpage-dev-mariadb-parameter-group');
  check('mariadb-logs',JSON.stringify([...(db.enabled_cloudwatch_logs_exports||[])].sort())==='["error","slowquery"]');
  check('redis-name-engine-type',cache.replication_group_id==='orderpage-dev-redis'&&cache.engine==='redis'&&cache.engine_version==='7.1'&&cache.node_type==='cache.t4g.micro'&&cache.port===6379);
  check('redis-one-node-no-cluster-mode',cache.num_cache_clusters===1&&cache.cluster_mode==='disabled'&&cache.automatic_failover_enabled===false&&cache.multi_az_enabled===false);
  // provider 5.100.0의 nullable bool 두 개는 plan에서 문자열로 표현될 수 있다.
  const nullableTrue=v=>v===true||v==='true';
  check('redis-tls-and-auth-strategy',nullableTrue(cache.at_rest_encryption_enabled)&&cache.transit_encryption_enabled===true&&cache.transit_encryption_mode==='required'&&cache.auth_token_update_strategy==='SET');
  check('redis-subnet-parameter-and-backup',value('aws_elasticache_subnet_group').name==='orderpage-dev-redis-subnet-group'&&cache.subnet_group_name==='orderpage-dev-redis-subnet-group'&&cache.parameter_group_name==='default.redis7'&&cache.snapshot_retention_limit===1);
  check('redis-two-cloudwatch-logs',cache.log_delivery_configuration?.length===2&&['engine-log','slow-log'].every(type=>cache.log_delivery_configuration.some(l=>l.log_type===type&&l.log_format==='json'&&l.destination_type==='cloudwatch-logs'&&l.destination==='/aws/elasticache/orderpage-dev-redis/'+type)));
  check('rabbitmq-name-engine-size',mq.broker_name==='orderpage-dev-rabbitmq'&&mq.engine_type==='RabbitMQ'&&mq.engine_version==='4.2'&&mq.host_instance_type==='mq.m7g.medium');
  check('rabbitmq-private-single-instance',mq.publicly_accessible===false&&mq.deployment_mode==='SINGLE_INSTANCE');
  check('rabbitmq-owned-key-and-general-logs',mq.encryption_options?.length===1&&mq.encryption_options[0].use_aws_owned_key===true&&mq.logs?.length===1&&mq.logs[0].general===true);
  check('automatic-minor-upgrades',db.auto_minor_version_upgrade===true&&nullableTrue(cache.auto_minor_version_upgrade)&&mq.auto_minor_version_upgrade===true);
  // 비밀의 값은 반환하지 않는다. 민감 표기와 값의 존재만 검사하며 강도/회전 검증을 대신하지 않는다.
  const sensitive=t=>ofType(t)[0]?.change?.after_sensitive||{};
  const present=v=>typeof v==='string'&&v.length>=32;
  check('database-and-redis-secrets-marked-sensitive',present(db.password)&&sensitive('aws_db_instance').password===true&&present(cache.auth_token)&&sensitive('aws_elasticache_replication_group').auth_token===true);
  check('broker-secret-marked-sensitive',mq.user?.length===1&&mq.user[0].username==='orderadmin'&&present(mq.user[0].password)&&(sensitive('aws_mq_broker').user===true||sensitive('aws_mq_broker').user?.[0]?.password===true));
  return {resourceCount:selected.length,checks,passed:checks.every(c=>c.passed),readyForApply:false,
    unresolved:['Subnet/SG IDs and exact private-network connections require final plan/state review.','Logging delivery permissions and effective AWS authorization remain unverified.','Versions, regional availability, prices and runtime budget must be checked before apply.'],
    limitations:['Known settings only; not an apply gate or spending cap.','Lab cleanup settings intentionally discard test data; production data needs a separate backup decision.','RabbitMQ users are not fully reconciled by this Terraform provider.']};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{if(process.argv.length!==4)throw Error('usage');const input=path.resolve(process.argv[2]),dev=path.join(root,'terraform/envs/dev');if(path.dirname(input)!==dev||path.extname(input)!=='.tfplan')throw Error('path');const result=spawnSync(process.env.TERRAFORM||'terraform',['-chdir='+dev,'show','-json',path.basename(input)],{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});if(result.error||result.status!==0)throw Error('show');const report=reviewDataServicePlan(JSON.parse(result.stdout),process.argv[3]);console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;}
  catch{console.error('데이터 서비스 plan 검사 실패. 사용법: node scripts/review-data-service-plan.mjs terraform/envs/dev/<파일>.tfplan <검토한 MariaDB 버전>. 원문은 출력하지 않습니다.');process.exitCode=1;}
}
