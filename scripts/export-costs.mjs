import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assert=(ok,message)=>{if(!ok)throw Error(message);};
export function validateCostSettings(settings, now=new Date()) {
  assert(settings && Object.keys(settings).every(k=>['accountId','start','end','projectTagValue'].includes(k)),'알 수 없는 비용 조회 설정');
  assert(/^\d{12}$/.test(settings.accountId),'조회 대상 AWS 계정 12자리가 필요합니다.');
  for(const key of ['start','end']) {
    const value=settings[key];
    assert(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value,'실제 UTC YYYY-MM-DD 날짜가 필요합니다.');
  }
  const days=(Date.parse(settings.end)-Date.parse(settings.start))/86400000;
  assert(days>0 && days<=7,'조회는 시작 포함/종료 제외, 1~7일로 제한합니다.');
  assert(Date.parse(settings.start)<=now.getTime() && Date.parse(settings.end)<=Date.parse(now.toISOString().slice(0,10))+86400000,'미래 비용은 조회하지 않습니다.');
  assert(settings.projectTagValue==null || /^[a-zA-Z0-9_-]{1,64}$/.test(settings.projectTagValue),'Project 태그 값 형식을 확인하세요.');
  return settings;
}
export function awsRead(service, operation, input, region, run=execFileSync) {
  // AWS CLI의 프로필/SSO를 사용한다. 자격증명을 파일/인자로 복사하지 않는다.
  // 자동 pagination을 끄고 각 유료 CE 페이지를 직접 세어 상한을 적용한다.
  const args=[service,operation,'--region',region,'--output','json','--no-cli-pager','--no-paginate'];
  if(input) args.push('--cli-input-json',JSON.stringify(input));
  return JSON.parse(run('aws',args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,windowsHide:true,env:{...process.env,AWS_PAGER:'',AWS_MAX_ATTEMPTS:'1'}}));
}
export async function collectCosts(settings, read=awsRead, now=new Date()) {
  validateCostSettings(settings,now);
  const identity=await read('sts','get-caller-identity',null,'ap-northeast-2');
  assert(identity.Account===settings.accountId,'AWS 로그인 계정이 설정과 다릅니다. CE 조회를 중단합니다.');
  const report={collectedAt:now.toISOString(),accountId:settings.accountId,start:settings.start,endExclusive:settings.end,granularity:'DAILY',metric:'UnblendedCost',ceRequests:0,scopes:{}};
  for(const scope of settings.projectTagValue ? ['account','projectTagged'] : ['account']) {
    // 조직 관리 계정에서도 조회 대상 멤버 계정만 포함한다. 태그 누락은 account 결과로 확인한다.
    const accountFilter={Dimensions:{Key:'LINKED_ACCOUNT',Values:[settings.accountId]}};
    const filter=scope==='account'?accountFilter:{And:[accountFilter,{Tags:{Key:'Project',Values:[settings.projectTagValue],MatchOptions:['EQUALS']}}]};
    const pages=[];const tokens=new Set();let token;
    do {
      assert(pages.length<10,'CE 결과가 10페이지를 초과합니다. 기간을 줄이세요. 부분 결과는 저장하지 않습니다.');
      const input={TimePeriod:{Start:settings.start,End:settings.end},Granularity:'DAILY',Metrics:['UnblendedCost'],GroupBy:[{Type:'DIMENSION',Key:'SERVICE'}],Filter:filter};
      if(token)input.NextPageToken=token;
      const page=await read('ce','get-cost-and-usage',input,'us-east-1');report.ceRequests++;
      assert(Array.isArray(page.ResultsByTime),'CE 응답에 ResultsByTime이 없습니다.');
      pages.push(page);
      token=page.NextPageToken;
      if(token){assert(!tokens.has(token),'CE pagination token 반복.');tokens.add(token);}
    }while(token);
    const rows=[];
    for(const page of pages)for(const day of page.ResultsByTime)for(const group of day.Groups||[]) {
      const cost=group.Metrics?.UnblendedCost;
      assert(cost?.Unit==='USD' && /^-?\d+(\.\d+)?$/.test(cost.Amount),'USD 비용 응답 형식을 확인하세요.');
      rows.push({start:day.TimePeriod.Start,end:day.TimePeriod.End,service:group.Keys[0],amount:cost.Amount,unit:cost.Unit,estimated:day.Estimated===true});
    }
    report.scopes[scope]={filter,coverage:scope==='account'?'지정 계정 전체: 기존 자원 비용 포함':'Project 태그로 잡힌 부분만: 프로젝트 전체 비용으로 단정 금지',status:rows.length?'data-returned':'no-data',rows,pages};
  }
  return report;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length===3,'사용법: node scripts/export-costs.mjs .local/cost-settings.json');
    const report=await collectCosts(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
    const folder=path.join(root,'.local/cost',report.collectedAt.replaceAll(':','-'));
    fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'cost-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log('비용 응답 저장: '+folder+' / CE 요청 '+report.ceRequests+'회. 빈 결과는 비용 0의 증거가 아닙니다.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
