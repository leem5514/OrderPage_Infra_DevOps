import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {renderServicePlanIam} from './prepare-service-plan-iam.mjs';
import {renderDeployDelegation} from './prepare-deploy-delegation.mjs';
import {renderEksServicePermissions} from './prepare-eks-service-permissions.mjs';
import {renderNetworkComputePermissions} from './prepare-network-compute-permissions.mjs';
import {renderDataServicePermissions} from './prepare-data-service-permissions.mjs';
import {renderRemainingServicePermissions} from './prepare-remaining-service-permissions.mjs';
import {readOidcCluster} from './deploy-identity-scope.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const document=Statement=>({Version:'2012-10-17',Statement});
export const statementBody = ({Sid,...body}) => body;
export function collectDeploySources({accountId,email,kubernetesVersion,jenkinsAmi,oidcCluster=null}) {
  const read=renderServicePlanIam(accountId);
  const files={'state-access.json':read['state-access.json'],'plan-read.json':read['plan-read.json'],
    ...renderDeployDelegation(accountId,oidcCluster),...renderEksServicePermissions(accountId,kubernetesVersion),
    ...renderNetworkComputePermissions(accountId,jenkinsAmi),...renderDataServicePermissions(accountId),...renderRemainingServicePermissions(accountId,email)};
  return Object.fromEntries(Object.entries(files).filter(([name])=>name!=='manifest.json').map(([name,text])=>[name,JSON.parse(text)]));
}

// IAM은 같은 identity의 정책 Statement를 합쳐 평가한다. 문장 자체는 수정하지 않고 파일 경계만 바꾼다.
// Action/Resource 목록을 합치면 의도하지 않은 조합이 생길 수 있으므로 절대 합치지 않는다.
export function packPolicies(sources) {
  const entries=Object.entries(sources).flatMap(([source,doc])=>doc.Statement.map((s,index)=>({source,index,body:statementBody(s),originalSid:s.Sid})));
  const unique=new Map();
  for(const entry of entries) {
    const key=JSON.stringify(entry.body);
    if(!unique.has(key)) unique.set(key,{body:entry.body,origins:[]});
    unique.get(key).origins.push({source:entry.source,index:entry.index,sid:entry.originalSid});
  }
  const rows=[...unique.values()].map((e,i)=>({...e,statement:{Sid:'S'+String(i+1).padStart(4,'0'),...e.body}}));
  rows.sort((a,b)=>JSON.stringify(b.statement).length-JSON.stringify(a.statement).length||a.statement.Sid.localeCompare(b.statement.Sid));
  const bins=[];
  for(const row of rows) {
    if(JSON.stringify(document([row.statement])).length>6144)throw Error('단일 문장이 IAM 크기 제한을 초과합니다.');
    let bin=bins.find(b=>JSON.stringify(document([...b.map(r=>r.statement),row.statement])).length<=6144);
    if(!bin){bin=[];bins.push(bin);}bin.push(row);
  }
  const files={},mapping=[];
  bins.forEach((bin,i)=>{
    const name='OrderPageDeployBundle'+String(i+1).padStart(2,'0')+'.json';
    files[name]=document(bin.map(r=>r.statement));
    mapping.push(...bin.map(r=>({policy:name,sid:r.statement.Sid,origins:r.origins})));
  });
  // 파일 수가 줄어도 모든 원본 문장이 남아 있어야 한다. 공백·Sid 외 권한 표현은 그대로 보존한다.
  const before=[...unique.keys()].sort(),after=Object.values(files).flatMap(d=>d.Statement.map(s=>JSON.stringify(statementBody(s)))).sort();
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('정책 통합 중 권한 문장이 변경되었습니다.');
  return {files,mapping,sourceCount:Object.keys(sources).length,sourceStatements:entries.length,uniqueStatements:unique.size};
}

export function renderIntegratedPermissions(input) {
  const sources=collectDeploySources(input),packed=packPolicies(sources);
  // 실제 계정 quota는 별도 조회해야 한다. 20은 설계 상한이며 권한 연결 성공을 보장하지 않는다.
  if(Object.keys(packed.files).length>20)throw Error('통합 정책 수가 설계 상한 20개를 초과합니다.');
  const manifest={status:'REVIEW_ONLY_DO_NOT_ATTACH',readyForApply:false,phase:input.oidcCluster?'OIDC_BOUND':'OIDC_UNBOUND',
    sourceCount:packed.sourceCount,sourceStatements:packed.sourceStatements,uniqueStatements:packed.uniqueStatements,
    attachedPolicyCount:Object.keys(packed.files).length,actualAccountQuotaVerified:false,
    policies:Object.entries(packed.files).map(([name,doc])=>({name,characters:JSON.stringify(doc).length,sha256:hash(doc)})),
    sources:Object.entries(sources).map(([name,doc])=>({name,sha256:hash(doc)})),mapping:packed.mapping,
    limitations:['Statement preservation is not AWS effective authorization simulation.','Unbound OIDC writes remain denied until actual ACTIVE cluster issuer binding.','Regional log delivery and resource-policy mutation require Resource=*; this can affect other log delivery in Seoul.','IAM cannot constrain all policy bodies, public access settings, service sizes or charges.','Cost Anomaly writes are denied; Cost Explorer reads are not run by this tool.','No image/object purge permissions. Nonempty ECR/S3 require separately reviewed cleanup.'],
    pending:['Actual account policy quota and AWS ValidatePolicy/effective permissions','Budget/runtime and refreshed plan approval','Review exact attachment replacement from old state/read policies; never append all legacy candidates','Live creation, alarm delivery and cleanup verification']};
  return {...Object.fromEntries(Object.entries(packed.files).map(([n,d])=>[n,JSON.stringify(d,null,2)+'\n'])),'manifest.json':JSON.stringify(manifest,null,2)+'\n'};
}

export function writeIntegratedPermissions(input,repoRoot=root) {
  const files=renderIntegratedPermissions(input),local=path.join(repoRoot,'.local');
  if(fs.existsSync(local)&&fs.lstatSync(local).isSymbolicLink())throw Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local,{recursive:true});const output=path.join(local,input.oidcCluster?'iam-integrated-deploy-bound-review':'iam-integrated-deploy-review');fs.mkdirSync(output);
  for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(output,name),text,{flag:'wx',mode:0o600});
  return Object.keys(files).length;
}

// 실제 입력은 이미 Git에서 제외한 tfvars에서 읽는다. 비밀번호나 이메일을 콘솔에 표시하지 않는다.
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {
    if(process.argv.length>3||(process.argv.length===3&&process.argv[2]!=='--bind-existing-eks'))throw Error('args');
    const vars=JSON.parse(fs.readFileSync(path.join(root,'terraform/envs/dev/terraform.tfvars.json'),'utf8'));
    const accountId=vars.eks_admin_principal_arn?.match(/^arn:aws:iam::([0-9]{12}):role\/orderpage-eks-operator$/)?.[1];
    const oidcCluster=process.argv[2]?readOidcCluster(accountId):null;
    const count=writeIntegratedPermissions({accountId,email:vars.operations_email,kubernetesVersion:vars.kubernetes_version,jenkinsAmi:vars.jenkins_ami_id,oidcCluster});
    console.log(`검토 파일 ${count}개 생성. AWS 변경·정책 연결 없음. .local의 iam-integrated-deploy${oidcCluster?'-bound':''}-review에서 검토하세요.`);
  }catch{console.error('통합 정책 생성 실패. 로컬 tfvars 필수값과 기존 출력 폴더·링크 여부를 확인하세요. 입력 원문은 출력하지 않습니다.');process.exitCode=1;}
}
