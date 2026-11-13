import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const queries={
  apiRps:'sum(rate(http_server_requests_seconds_count{application="ordersystem",uri!~"/actuator.*"}[5m]))',
  api5xxRps:'sum(rate(http_server_requests_seconds_count{application="ordersystem",status=~"5..",uri!~"/actuator.*"}[5m]))',
  apiP95Seconds:'histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket{application="ordersystem",uri!~"/actuator.*"}[5m])))',
  backendCpuCores:'sum(rate(container_cpu_usage_seconds_total{namespace="orderpage",container="orderpage-backend"}[5m]))',
  backendMemoryBytes:'sum(container_memory_working_set_bytes{namespace="orderpage",container="orderpage-backend"})',
  availableReplicas:'kube_deployment_status_replicas_available{namespace="orderpage",deployment="orderpage-backend"}',
  hpaCurrentReplicas:'kube_horizontalpodautoscaler_status_current_replicas{namespace="orderpage",horizontalpodautoscaler="orderpage-backend"}'
};
const assert=(ok,message)=>{if(!ok)throw Error(message);};
export function validateWindow(settings,now=new Date()) {
  assert(settings && Object.keys(settings).every(key=>['scenario','phase','start','end'].includes(key)),'알 수 없는 측정 설정입니다.');
  assert(/^[a-z0-9-]{2,64}$/.test(settings.scenario) && ['baseline','after'].includes(settings.phase),'scenario와 baseline/after를 지정하세요.');
  const start=Date.parse(settings.start),end=Date.parse(settings.end);
  assert(Number.isFinite(start)&&Number.isFinite(end)&&new Date(start).toISOString()===settings.start&&new Date(end).toISOString()===settings.end,'UTC ISO 시각이 필요합니다.');
  assert(end-start>=10*60*1000 && end-start<=6*60*60*1000 && end<=now.getTime() && now.getTime()-start<3*86400000,'10분~6시간 범위, 현재 이전 및 보관 3일 이내만 조회합니다.');
  return {start,end};
}
export async function collectPrometheus(settings,request=fetch,now=new Date()) {
  const {start,end}=validateWindow(settings,now);
  const metrics={};
  for(const [name,query] of Object.entries(queries)) {
    const url=new URL('http://127.0.0.1:19090/api/v1/query_range');
    url.search=new URLSearchParams({query,start:String(start/1000),end:String(end/1000),step:'30'}).toString();
    const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
    assert(response.ok,'Prometheus HTTP '+response.status+' ('+name+')');
    const body=await response.json();
    assert(body.status==='success' && body.data?.resultType==='matrix' && Array.isArray(body.data.result),'Prometheus 응답이 유효하지 않습니다: '+name);
    metrics[name]={query,series:body.data.result,seriesCount:body.data.result.length,status:body.data.result.length?'data-returned':'no-data'};
  }
  return {scenario:settings.scenario,phase:settings.phase,start:settings.start,end:settings.end,collectedAt:now.toISOString(),stepSeconds:30,source:'localhost port-forward /api/v1/query_range',metrics};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length===3,'사용법: node scripts/export-prometheus-evidence.mjs .local/metric-window.json');
    const report=await collectPrometheus(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
    const dest=path.join(root,'.local/metrics',report.scenario,report.phase+'-'+report.end.replaceAll(':','-')+'.json');
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log('지표 원본 보관: '+dest+'. no-data 항목은 개선율 계산에 사용하지 않습니다.');
  } catch(error){console.error(error.message);process.exitCode=1;}
}
