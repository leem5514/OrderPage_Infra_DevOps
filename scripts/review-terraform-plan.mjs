import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const costTypes=new Set([
  'aws_eks_cluster','aws_eks_node_group','aws_instance','aws_db_instance',
  'aws_elasticache_replication_group','aws_mq_broker','aws_nat_gateway',
  'aws_lb','aws_cloudwatch_metric_alarm','aws_cloudwatch_dashboard',
  'aws_ebs_volume','aws_eip'
]);
const assert=(condition,message)=>{if(!condition)throw Error(message);};
export function classifyActions(actions) {
  assert(Array.isArray(actions)&&actions.length>0&&actions.every(a=>['no-op','read','create','update','delete'].includes(a)),'알 수 없는 Terraform action입니다.');
  if(actions.includes('create')&&actions.includes('delete'))return 'replace';
  assert(actions.length===1,'예상하지 못한 Terraform action 조합입니다.');
  return actions[0];
}
export function reviewPlan(plan) {
  assert(plan && /^1\./.test(plan.format_version) && Array.isArray(plan.resource_changes),'terraform show -json의 plan이 필요합니다.');
  const counts={create:0,update:0,delete:0,replace:0,read:0,'no-op':0};
  const changes=[];
  for(const item of plan.resource_changes) {
    assert(typeof item.address==='string' && typeof item.type==='string' && ['managed','data'].includes(item.mode),'resource_changes 형식이 올바르지 않습니다.');
    const action=classifyActions(item.change?.actions);
    counts[action]++;
    if(action!=='no-op')changes.push({address:item.address,type:item.type,mode:item.mode,action,costDriver:item.mode==='managed'&&costTypes.has(item.type)});
  }
  return {
    formatVersion:plan.format_version,
    terraformVersion:plan.terraform_version||null,
    counts,
    destructive:counts.delete+counts.replace>0,
    costDrivers:changes.filter(x=>x.costDriver),
    changes,
    warning:'이 요약은 resource_changes만 포함합니다. 실제 계정, 권한, 금액, 비밀값 및 서비스 기동은 검증하지 않습니다.'
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length===3,'사용법: node scripts/review-terraform-plan.mjs terraform/envs/dev/foundation.tfplan');
    const input=path.resolve(process.argv[2]);
    const devRoot=path.join(root,'terraform','envs','dev');
    assert(path.dirname(input)===devRoot && path.extname(input)==='.tfplan','dev 환경의 .tfplan 파일만 검토합니다.');
    assert(fs.statSync(input).isFile(),'plan 파일이 필요합니다.');
    const show=spawnSync('terraform',['-chdir=terraform/envs/dev','show','-json',path.basename(input)],{
      cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,windowsHide:true
    });
    assert(!show.error && show.status===0 && show.stdout,'terraform show -json 실패: plan 파일과 Terraform 설치/버전을 확인하세요.');
    const raw=show.stdout;
    const summary=reviewPlan(JSON.parse(raw));
    const digest=createHash('sha256').update(raw).digest('hex');
    const output=path.join(root,'.local/plan-reviews',digest.slice(0,16)+'.json');
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({sourceSha256:digest,reviewedAt:new Date().toISOString(),...summary},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({counts:summary.counts,costDriverCount:summary.costDrivers.length,destructive:summary.destructive,reviewFile:output},null,2));
    if(summary.destructive)process.exitCode=2;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
