import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import {collectPrometheus,validateWindow} from '../export-prometheus-evidence.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>YAML.parse(fs.readFileSync(path.join(root,file),'utf8'));
const helm=process.env.HELM || 'helm';
function render(chart,release,namespace,values) {
  assert.ok(process.env[chart],'고정한 공식 chart 경로를 환경변수에 지정하세요: '+chart);
  const output=execFileSync(helm,['template',release,process.env[chart],'--namespace',namespace,'--kube-version','1.35.0','--skip-crds','-f',path.join(root,values)],{encoding:'utf8',maxBuffer:16*1024*1024});
  return YAML.parseAllDocuments(output).map(d=>d.toJSON()).filter(Boolean);
}
test('공식 stack 렌더: 내부 UI·짧은 보관·필수 exporter와 제한된 ServiceMonitor 선택',()=>{
  const docs=render('MONITORING_CHART','orderpage-observe','observability','monitoring/prometheus/values.dev.yaml');
  const prom=docs.find(d=>d.kind==='Prometheus');assert.ok(prom);
  assert.equal(prom.spec.retention,'3d');assert.equal(prom.spec.retentionSize,'2GB');assert.equal(prom.spec.replicas,1);
  assert.deepEqual(prom.spec.serviceMonitorSelector.matchLabels,{release:'orderpage-observe'});
  assert.deepEqual(prom.spec.serviceMonitorNamespaceSelector.matchLabels,{'kubernetes.io/metadata.name':'observability'});
  assert.equal(prom.spec.storage,undefined,'이번 짧은 실험에서는 PVC를 자동 만들지 않는다');
  assert.ok(docs.some(d=>d.kind==='DaemonSet'&&d.metadata.name.includes('node-exporter')));
  assert.ok(docs.some(d=>d.kind==='Deployment'&&d.metadata.name.includes('kube-state-metrics')));
  assert.ok(!docs.some(d=>d.kind==='Alertmanager'||d.kind==='PrometheusRule'||d.kind==='Ingress'));
  assert.ok(docs.filter(d=>d.kind==='Service'&&/prometheus|grafana/.test(d.metadata.name)).every(d=>d.spec.type==='ClusterIP'));
  assert.ok(docs.some(d=>d.kind==='Role'&&d.metadata.name.includes('grafana')));
  assert.ok(!docs.some(d=>d.kind==='ClusterRole'&&d.metadata.name.includes('grafana')));
  const grafana=docs.find(d=>d.kind==='Deployment'&&d.metadata.name.includes('grafana'));
  assert.ok(grafana.spec.template.spec.containers.some(c=>c.env?.some(e=>e.name==='NAMESPACE'&&e.value==='observability')));
  assert.ok(grafana.spec.template.spec.containers.some(c=>c.env?.some(e=>e.valueFrom?.secretKeyRef?.name==='orderpage-grafana-admin')));
});
test('Metrics Server는 HPA Metrics API를 제공하고 무단 TLS 우회를 하지 않음',()=>{
  const docs=render('METRICS_SERVER_CHART','metrics-server','kube-system','monitoring/prometheus/metrics-server-values.dev.yaml');
  const api=docs.find(d=>d.kind==='APIService');assert.ok(api);
  assert.equal(api.spec.group,'metrics.k8s.io');
  const deploy=docs.find(d=>d.kind==='Deployment');assert.equal(deploy.spec.replicas,1);
  assert.ok(!deploy.spec.template.spec.containers[0].args.some(a=>a.includes('insecure-tls')));
});
test('백엔드 수집 대상과 Dashboard 경로가 공개 Ingress 차단과 충돌하지 않음',()=>{
  const monitor=read('monitoring/prometheus/backend-servicemonitor.yaml');
  assert.equal(monitor.metadata.labels.release,'orderpage-observe');
  assert.deepEqual(monitor.spec.namespaceSelector.matchNames,['orderpage']);
  assert.equal(monitor.spec.endpoints[0].port,'http');assert.equal(monitor.spec.endpoints[0].path,'/actuator/prometheus');
  assert.equal(monitor.spec.selector.matchLabels['app.kubernetes.io/name'],'orderpage-backend');
  const ingress=read('k8s/base/ingress.yaml');
  assert.equal(ingress.spec.rules[0].http.paths[0].path,'/actuator');
  assert.ok(ingress.metadata.annotations['alb.ingress.kubernetes.io/actions.deny-actuator'].includes('404'));
  const dashboard=JSON.parse(read('monitoring/grafana/orderpage-dashboard.yaml').data['orderpage-observability.json']);
  assert.equal(dashboard.panels.length,6);assert.ok(dashboard.panels.some(p=>p.targets[0].expr.includes('histogram_quantile(0.95')));
  assert.ok(dashboard.panels.every(p=>p.targets[0].datasource.uid==='prometheus'));
});
test('측정 창과 localhost 고정, 빈 지표와 실패를 구분',async()=>{
  const now=new Date('2026-11-13T03:00:00.000Z');
  const settings={scenario:'rolling-deploy',phase:'baseline',start:'2026-11-13T01:00:00.000Z',end:'2026-11-13T01:30:00.000Z'};
  assert.equal(validateWindow(settings,now).end,Date.parse(settings.end));
  await assert.rejects(()=>collectPrometheus({...settings,end:'2026-11-14T01:30:00.000Z'},()=>{throw Error('should not fetch')},now));
  let count=0;const report=await collectPrometheus(settings,(url)=>{
    count++;assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'19090');
    return {ok:true,json:async()=>({status:'success',data:{resultType:'matrix',result:[]}})};
  },now);
  assert.equal(count,7);assert.ok(Object.values(report.metrics).every(m=>m.status==='no-data'));
  await assert.rejects(()=>collectPrometheus(settings,()=>({ok:false,status:503}),now));
});
