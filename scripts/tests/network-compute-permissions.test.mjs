import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderNetworkComputePermissions, writeNetworkComputePermissions, networkTags} from '../prepare-network-compute-permissions.mjs';
import {renderDeployDelegation} from '../prepare-deploy-delegation.mjs';
import {renderEksServicePermissions} from '../prepare-eks-service-permissions.mjs';
import {reviewNetworkComputePlan, networkResourceCounts} from '../review-network-compute-plan.mjs';
import {evaluate} from './helpers/delegation-policy-evaluator.mjs';

const account = '123456789012', ami = 'ami-0123456789abcdef0';
const files = renderNetworkComputePermissions(account, ami);
const documents = f => Object.entries(f).filter(([n]) => n !== 'manifest.json').map(([, t]) => JSON.parse(t));
const ownPolicies = documents(files);
const policies = [...ownPolicies, ...documents(renderDeployDelegation(account)), ...documents(renderEksServicePermissions(account, '1.35'))];
const arn = type => `arn:aws:ec2:ap-northeast-2:${account}:${type}/example`;
const global = {'aws:RequestedRegion': 'ap-northeast-2', 'aws:PrincipalAccount': account};
const request = Object.fromEntries(Object.entries(networkTags).map(([k,v]) => ['aws:RequestTag/' + k, v]));
const owned = Object.fromEntries(Object.entries(networkTags).map(([k,v]) => ['aws:ResourceTag/' + k, v]));
const run = (action, resource, context, extra = []) => evaluate([...policies, ...extra], {action: 'ec2:' + action, resource, context: {...global, ...context}});
// 실제 IAM 엔진을 흉내 낸다고 주장하지 않는다. 이 테스트에서는 명시한 모든 대상 ARN이 허용돼야 한다.
const requestAllowed = (action, resources) => resources.every(([r,c]) => run(action, r, c) === 'allowed');
const broad = {Statement: [{Effect: 'Allow', Action: 'ec2:*', Resource: '*'}]};

test('새 subnet 요청 태그와 기존 VPC 소유 태그를 분리하며 부모가 다르면 요청 전체를 거부한다', () => {
  const resources = [[arn('subnet'), request], [arn('vpc'), owned]];
  assert.equal(requestAllowed('CreateSubnet', resources), true);
  assert.equal(requestAllowed('CreateSubnet', [[arn('subnet'), owned], [arn('vpc'), request]]), false);
  assert.equal(requestAllowed('CreateSubnet', [[arn('subnet'), request], [arn('vpc'), {...owned, 'aws:ResourceTag/Project': 'other'}]]), false);
  for (const key of Object.keys(request)) {const c = {...request}; delete c[key]; assert.equal(run('CreateSubnet', arn('subnet'), c), 'implicitDeny');}
  assert.equal(run('CreateVpc', arn('vpc'), {...request, 'aws:PrincipalAccount': '111122223333'}), 'implicitDeny');
  assert.equal(run('CreateVpc', arn('vpc').replace(account, '111122223333'), request), 'implicitDeny');
});

test('NAT와 S3 Gateway endpoint는 새 자원과 모든 지정 부모를 함께 허용한다', () => {
  const nat = [[arn('natgateway'), request], ...['elastic-ip', 'subnet', 'vpc'].map(t => [arn(t), owned])];
  assert.equal(requestAllowed('CreateNatGateway', nat), true);
  for (let i = 1; i < nat.length; i++) {const changed = structuredClone(nat); changed[i][1] = {}; assert.equal(requestAllowed('CreateNatGateway', changed), false);}
  const endpoint = [[arn('vpc-endpoint'), {...request, 'ec2:VpceServiceName': 'com.amazonaws.ap-northeast-2.s3'}], [arn('vpc'), owned], [arn('route-table'), owned]];
  assert.equal(requestAllowed('CreateVpcEndpoint', endpoint), true);
  assert.equal(run('CreateVpcEndpoint', arn('vpc-endpoint'), {...request, 'ec2:VpceServiceName': 'com.amazonaws.ap-northeast-2.ec2'}), 'implicitDeny');
  assert.equal(run('CreateVpcEndpoint', arn('subnet'), owned), 'implicitDeny');
});

test('태그 없는 inline 규칙은 소유 SG와 함께 허용하고 연결·정리는 프로젝트 자원으로 제한한다', () => {
  for (const action of ['AuthorizeSecurityGroupIngress', 'AuthorizeSecurityGroupEgress']) {
    assert.equal(requestAllowed(action, [[arn('security-group'), owned], [arn('security-group-rule'), {}]]), true);
    assert.equal(requestAllowed(action, [[arn('security-group'), {}], [arn('security-group-rule'), {}]]), false);
  }
  for (const [action, types] of [
    ['AttachInternetGateway', ['vpc', 'internet-gateway']], ['DetachInternetGateway', ['vpc', 'internet-gateway']],
    ['AssociateRouteTable', ['subnet', 'route-table']], ['DisassociateRouteTable', ['subnet', 'route-table']],
    ['ModifyVpcEndpoint', ['vpc-endpoint', 'route-table']],
    ...Object.entries({DeleteVpc:'vpc', DeleteSubnet:'subnet', DeleteInternetGateway:'internet-gateway', ReleaseAddress:'elastic-ip', DeleteNatGateway:'natgateway', DeleteRouteTable:'route-table', DeleteRoute:'route-table', DeleteVpcEndpoints:'vpc-endpoint', DeleteSecurityGroup:'security-group'}).map(([a,t]) => [a,[t]])
  ]) for (const type of types) {
    assert.equal(run(action, arn(type), owned), 'allowed', action);
    assert.equal(run(action, arn(type), {}), 'implicitDeny', action);
  }
});

function launchRequest() {
  return structuredClone([[`arn:aws:ec2:ap-northeast-2::image/${ami}`, {}],
    [arn('instance'), {...request, 'aws:RequestTag/Name':'orderpage-dev-jenkins', 'ec2:InstanceType':'m6i.large', 'ec2:InstanceProfile':`arn:aws:iam::${account}:instance-profile/orderpage-dev-jenkins`, 'ec2:MetadataHttpTokens':'required', 'ec2:Tenancy':'default'}],
    [arn('volume'), {...request, 'ec2:VolumeType':'gp3', 'ec2:VolumeSize':'30', 'ec2:Encrypted':'true'}],
    [arn('network-interface'), {'ec2:AssociatePublicIpAddress':'false'}],
    [arn('subnet'), {...owned, 'aws:ResourceTag/Tier':'private'}], [arn('security-group'), owned]]);
}
test('Jenkins 시작 요청의 여섯 자원과 PassRole을 함께 검토하고 고가·공개·다른 profile을 거부한다', () => {
  assert.equal(requestAllowed('RunInstances', launchRequest()), true);
  for (const [index, key, value] of [[1,'ec2:InstanceType','m6i.24xlarge'],[1,'ec2:MetadataHttpTokens','optional'],[1,'ec2:InstanceProfile',`arn:aws:iam::${account}:instance-profile/admin`],[2,'ec2:VolumeSize','500'],[2,'ec2:VolumeSize','NaN'],[2,'ec2:Encrypted',false],[3,'ec2:AssociatePublicIpAddress',true],[4,'aws:ResourceTag/Tier','public'],[5,'aws:ResourceTag/Project','other']]) {
    const r = launchRequest(); r[index][1][key] = value; assert.equal(requestAllowed('RunInstances', r), false, key);
  }
  const otherImage = launchRequest(); otherImage[0][0] = otherImage[0][0].replace(ami, 'ami-11111111111111111');
  assert.equal(requestAllowed('RunInstances', otherImage), false);
  assert.equal(evaluate(policies, {action:'iam:PassRole',resource:`arn:aws:iam::${account}:role/orderpage-dev-jenkins`,context:{'iam:PassedToService':'ec2.amazonaws.com'}}), 'allowed');
  assert.equal(run('RunInstances', arn('key-pair'), {}), 'implicitDeny');
  assert.equal(run('CreateNetworkInterface', arn('network-interface'), request), 'implicitDeny');
});

test('launch template와 Jenkins 정리는 허용하되 무관한 인스턴스와 임의 수정은 허용하지 않는다', () => {
  assert.equal(run('CreateLaunchTemplate', arn('launch-template'), request), 'allowed');
  for (const a of ['CreateLaunchTemplateVersion','ModifyLaunchTemplate','DeleteLaunchTemplate']) {
    assert.equal(run(a, arn('launch-template'), owned), 'allowed');
    assert.equal(run(a, arn('launch-template'), {}), 'implicitDeny');
  }
  for (const a of ['StartInstances','StopInstances','TerminateInstances','UnmonitorInstances']) {
    assert.equal(run(a, arn('instance'), {...owned,'aws:ResourceTag/Name':'orderpage-dev-jenkins'}), 'allowed');
    assert.equal(run(a, arn('instance'), owned), 'implicitDeny');
  }
  for (const a of ['ModifyInstanceAttribute','ModifyVolume','AssociateIamInstanceProfile','MonitorInstances']) assert.equal(run(a, arn('instance'), owned), 'implicitDeny');
});

test('생성 태그는 허용하고 소유 태그 삭제·변경·다른 자원 탈취·다른 리전 쓰기는 명시적으로 거부한다', () => {
  assert.equal(run('CreateTags', arn('volume'), {...request,'ec2:CreateAction':'RunInstances'}), 'allowed');
  assert.equal(run('CreateTags', arn('subnet'), {...request,'ec2:CreateAction':'CreateSubnet'}), 'allowed');
  assert.equal(run('CreateTags', arn('subnet'), request, [broad]), 'explicitDeny');
  assert.equal(run('CreateTags', arn('subnet'), {...owned,'aws:RequestTag/Name':'new-name'}), 'allowed');
  assert.equal(run('DeleteTags', arn('subnet'), {...owned,'aws:TagKeys':['Name']}), 'allowed');
  assert.equal(run('DeleteTags', arn('subnet'), owned, [broad]), 'explicitDeny');
  assert.equal(run('DeleteTags', arn('subnet'), {...owned,'aws:TagKeys':[]}, [broad]), 'explicitDeny');
  for (const key of Object.keys(networkTags)) {
    assert.equal(run('DeleteTags', arn('subnet'), {...owned,'aws:TagKeys':['Name',key]}, [broad]), 'explicitDeny');
    assert.equal(run('DeleteTags', arn('subnet'), {...owned,'aws:TagKeys':[key.toLowerCase()]}, [broad]), 'explicitDeny');
    assert.equal(run('CreateTags', arn('subnet'), {...owned,['aws:RequestTag/'+key]:'other'}, [broad]), 'explicitDeny');
  }
  assert.equal(run('CreateVpc', arn('vpc'), {...request,'aws:RequestedRegion':'us-east-1'}, [broad]), 'explicitDeny');
});

test('공식 권한표의 Action별 Resource별 Condition 지원 범위를 검사한다', () => {
  const ref = JSON.parse(fs.readFileSync(new URL('../../iam/network-compute/authorization-reference.json', import.meta.url)));
  const keyMatches = (p,k) => p === k || (p.includes('${') && k.startsWith(p.split('${')[0]));
  for (const doc of ownPolicies) for (const s of doc.Statement) for (const action of s.Action) {
    const a = ref.actions.find(a => 'ec2:' + a.name === action);
    assert.ok(a, action);
    if (s.Effect !== 'Allow') continue;
    for (const resource of s.Resource) {
      const type = resource.split(':')[5].split('/')[0];
      const r = a.resources.find(r => r.name === type);
      assert.ok(r, action + ':' + type);
      const keys = [...a.conditionKeys, ...r.conditionKeys, 'aws:RequestedRegion', 'aws:PrincipalAccount'];
      for (const values of Object.values(s.Condition || {})) for (const key of Object.keys(values)) assert.ok(keys.some(p => keyMatches(p,key)), action + ':' + type + ':' + key);
    }
  }
});

function planFixture() {
  const resources = [];
  for (const [type,count] of Object.entries(networkResourceCounts)) for (let i=0;i<count;i++) resources.push({mode:'managed',address:`module.vpc.${type}.test${i}`,type,change:{actions:['create'],after:{tags_all:{...networkTags}},after_unknown:{}}});
  const list = t => resources.filter(r => r.type===t), set = (t,v) => Object.assign(list(t)[0].change.after,v);
  set('aws_vpc',{enable_dns_support:true,enable_dns_hostnames:true,instance_tenancy:'default'});
  list('aws_subnet').forEach((r,i) => Object.assign(r.change.after,{map_public_ip_on_launch:false,assign_ipv6_address_on_creation:false,availability_zone:'ap-northeast-2'+(i%2?'c':'a'),tags_all:{...networkTags,Tier:i<2?'public':'private'}}));
  set('aws_eip',{domain:'vpc'});set('aws_nat_gateway',{connectivity_type:'public'});
  set('aws_vpc_endpoint',{vpc_endpoint_type:'Gateway',service_name:'com.amazonaws.ap-northeast-2.s3'});
  list('aws_route_table').forEach(r => r.change.after.route=[{cidr_block:'0.0.0.0/0'}]);
  const groups=list('aws_security_group');
  ['jenkins[0]','mariadb','redis','rabbitmq'].forEach((m,i) => {groups[i].address=`module.${m}.aws_security_group.this`;groups[i].change.after.ingress=i?[{protocol:'tcp',from_port:[0,3306,6379,5671][i],to_port:[0,3306,6379,5671][i],cidr_blocks:[],ipv6_cidr_blocks:[],prefix_list_ids:[],self:false}]:[];});
  const metadata=[{http_tokens:'required',http_put_response_hop_limit:1}];
  const disk=size=>({volume_type:'gp3',volume_size:size,encrypted:true,delete_on_termination:true});
  set('aws_instance',{ami,instance_type:'m6i.large',associate_public_ip_address:false,iam_instance_profile:'orderpage-dev-jenkins',metadata_options:structuredClone(metadata),root_block_device:[disk(30)],tags_all:{...networkTags,Name:'orderpage-dev-jenkins'}});
  set('aws_launch_template',{name_prefix:'orderpage-dev-node-',metadata_options:structuredClone(metadata),block_device_mappings:[{device_name:'/dev/xvda',ebs:[{...disk(20),encrypted:'true',delete_on_termination:'true'}]}],iam_instance_profile:[],network_interfaces:[],instance_market_options:[],instance_requirements:[]});
  return {resource_changes:resources};
}
test('plan은 21개 구성의 알려진 설정과 미확정 AMI를 구분한다', () => {
  const p=planFixture(); assert.equal(reviewNetworkComputePlan(p,ami).passed,true);
  const j=p.resource_changes.find(r=>r.type==='aws_instance');delete j.change.after.ami;j.change.after_unknown.ami=true;
  const result=reviewNetworkComputePlan(p,ami);assert.equal(result.passed,true);assert.equal(result.readyForApply,false);assert.match(result.unresolved[0],/AMI/);
  j.change.after_unknown.ami=false;assert.equal(reviewNetworkComputePlan(p,ami).passed,false);
});
test('plan 변형에서 추가 NAT·공개 DB·큰 디스크·IMDSv1·삭제를 검출한다', () => {
  const changes=[p=>p.resource_changes.push(structuredClone(p.resource_changes.find(r=>r.type==='aws_nat_gateway'))),
    p=>p.resource_changes.find(r=>r.address==='module.mariadb.aws_security_group.this').change.after.ingress[0].cidr_blocks=['0.0.0.0/0'],
    p=>p.resource_changes.find(r=>r.type==='aws_instance').change.after.root_block_device[0].volume_size=500,
    p=>p.resource_changes.find(r=>r.type==='aws_instance').change.after.metadata_options[0].http_tokens='optional',
    p=>p.resource_changes.find(r=>r.type==='aws_vpc_endpoint').change.after.vpc_endpoint_type='Interface',
    p=>p.resource_changes.find(r=>r.type==='aws_subnet').change.after.map_public_ip_on_launch=true,
    p=>p.resource_changes.find(r=>r.type==='aws_launch_template').change.after.block_device_mappings[0].ebs[0].encrypted='false',
    p=>p.resource_changes.find(r=>r.type==='aws_launch_template').change.after_unknown.image_id=true,
    p=>p.resource_changes[0].change.actions=['delete','create']];
  for (const mutate of changes) {const p=planFixture();mutate(p);assert.equal(reviewNetworkComputePlan(p,ami).passed,false);}
});
test('정책은 정돈된 JSON·크기 제한·검토 상태를 유지하며 비정상 입력과 덮어쓰기를 거부한다', () => {
  for (const [n,s] of Object.entries(files)) {assert.equal(s,JSON.stringify(JSON.parse(s),null,2)+'\n');if(n!=='manifest.json')assert.ok(JSON.stringify(JSON.parse(s)).length<=6144);}
  assert.equal(JSON.parse(files['manifest.json']).readyForApply,false);
  for(const value of [ami+'\n','ami-*','ami-short'])assert.throws(()=>renderNetworkComputePermissions(account,value));
  assert.throws(()=>renderNetworkComputePermissions(account+'\n',ami));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'order-network-test-'));
  try {assert.equal(writeNetworkComputePermissions(account,ami,dir).length,5);assert.throws(()=>writeNetworkComputePermissions(account,ami,dir));}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
});
