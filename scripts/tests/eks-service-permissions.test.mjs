import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {renderEksServicePermissions, writeEksServicePermissions, eksTags} from '../prepare-eks-service-permissions.mjs';
import {renderDeployDelegation} from '../prepare-deploy-delegation.mjs';
import {reviewEksServicePlan} from '../review-eks-service-plan.mjs';
import {evaluate} from './helpers/delegation-policy-evaluator.mjs';

const account = '123456789012', version = '1.35';
const files = renderEksServicePermissions(account, version);
const documents = f => Object.entries(f).filter(([n]) => n !== 'manifest.json').map(([, t]) => JSON.parse(t));
const policies = documents(files);
const combined = [...policies, ...documents(renderDeployDelegation(account))];
const arn = s => `arn:aws:eks:ap-northeast-2:${account}:${s}`;
const cluster = arn('cluster/orderpage-dev');
const node = arn('nodegroup/orderpage-dev/orderpage-dev-default/uuid');
const addon = arn('addon/orderpage-dev/vpc-cni/uuid');
const global = {'aws:RequestedRegion': 'ap-northeast-2', 'aws:PrincipalAccount': account};
const tags = Object.fromEntries(Object.entries(eksTags).map(([k,v]) => ['aws:RequestTag/' + k, v]));
const create = {...global, ...tags, 'eks:authenticationMode': 'API', 'eks:supportType': 'STANDARD', 'eks:kubernetesVersion': version, 'eks:bootstrapClusterCreatorAdminPermissions': 'false', 'eks:endpointPrivateAccess': 'true', 'eks:loggingType/api': 'true', 'eks:loggingType/audit': 'true', 'eks:loggingType/authenticator': 'true'};
const broad = {Statement: [{Effect: 'Allow', Action: ['eks:*', 'iam:*'], Resource: '*'}]};
const run = (action, resource, context = global, extra = []) => evaluate([...combined, ...extra], {action, resource, context});

test('클러스터 생성은 필수 설정과 서울·계정·태그가 있을 때만 허용한다', () => {
  assert.equal(run('eks:CreateCluster', '*', create), 'allowed');
  for (const key of ['aws:PrincipalAccount', 'aws:RequestTag/Project', 'eks:authenticationMode', 'eks:supportType', 'eks:kubernetesVersion', 'eks:bootstrapClusterCreatorAdminPermissions', 'eks:endpointPrivateAccess', 'eks:loggingType/audit']) {
    const c = {...create}; delete c[key];
    assert.equal(run('eks:CreateCluster', '*', c), 'implicitDeny', key);
  }
  assert.equal(run('eks:CreateCluster', '*', {...create, 'aws:PrincipalAccount': '111122223333'}), 'implicitDeny');
  assert.equal(run('eks:CreateCluster', '*', {...create, 'aws:RequestedRegion': 'us-east-1'}, [broad]), 'explicitDeny');
  assert.equal(run('eks:CreateCluster', '*', {...create, 'eks:kubernetesVersion': '1.34'}), 'implicitDeny');
});

test('생성과 부분 갱신에서 Auto Mode·연장 지원·인증 변경을 거부한다', () => {
  for (const action of ['eks:CreateCluster', 'eks:UpdateClusterConfig']) {
    const resource = action === 'eks:CreateCluster' ? '*' : cluster;
    for (const key of ['eks:computeConfigEnabled', 'eks:blockStorageEnabled', 'eks:elasticLoadBalancingEnabled']) assert.equal(run(action, resource, {...create, [key]: true}, [broad]), 'explicitDeny');
    for (const [key, value] of [['eks:supportType', 'EXTENDED'], ['eks:authenticationMode', 'CONFIG_MAP']]) assert.equal(run(action, resource, {...create, [key]: value}, [broad]), 'explicitDeny');
  }
  assert.equal(run('eks:CreateCluster', '*', {...create, 'eks:bootstrapClusterCreatorAdminPermissions': true}, [broad]), 'explicitDeny');
  assert.equal(run('eks:UpdateClusterConfig', cluster), 'allowed'); // 부분 갱신에는 다른 설정 키가 없다.
  assert.equal(run('eks:UpdateClusterConfig', cluster, {...global, 'eks:endpointPrivateAccess': false}), 'implicitDeny');
  assert.equal(run('eks:UpdateClusterConfig', cluster, {...global, 'eks:loggingType/audit': false}), 'implicitDeny');
  assert.equal(run('eks:UpdateClusterVersion', cluster, {...global, 'eks:kubernetesVersion': version}), 'allowed');
  assert.equal(run('eks:UpdateClusterVersion', cluster, {...global, 'eks:kubernetesVersion': '1.34'}), 'implicitDeny');
});

test('생성 API는 부모 cluster를 사용하고 갱신·삭제는 이름이 정해진 자원만 허용한다', () => {
  for (const action of ['eks:CreateNodegroup', 'eks:CreateAddon']) {
    assert.equal(run(action, cluster, {...global, ...tags}), 'allowed');
    assert.equal(run(action, cluster, global), 'implicitDeny');
    assert.equal(run(action, node, {...global, ...tags}, [broad]), 'explicitDeny');
    assert.equal(run(action, cluster + '-other', {...global, ...tags}, [broad]), 'explicitDeny');
  }
  for (const [actions, resource] of [
    [['eks:DeleteCluster', 'eks:UpdateClusterConfig'], cluster],
    [['eks:UpdateNodegroupConfig', 'eks:UpdateNodegroupVersion', 'eks:DeleteNodegroup'], node],
    [['eks:UpdateAddon', 'eks:DeleteAddon'], addon]
  ]) for (const action of actions) {
    assert.equal(run(action, resource), 'allowed');
    for (const other of [resource.replace(account, '111122223333'), resource.replace('orderpage-dev', 'other'), resource.replace('ap-northeast-2', 'us-east-1')]) assert.equal(run(action, other, global, [broad]), 'explicitDeny');
  }
  assert.equal(run('eks:DeleteNodegroup', node.replace('orderpage-dev-default', 'extra'), global, [broad]), 'explicitDeny');
  assert.equal(run('eks:DeleteAddon', addon.replace('vpc-cni', 'aws-ebs-csi-driver'), global, [broad]), 'explicitDeny');
});

test('업데이트 대기·태그와 기존 EKS 운영자·PassRole 경로를 함께 평가한다', () => {
  for (const resource of [cluster, node, addon]) for (const action of ['eks:DescribeUpdate', 'eks:ListTagsForResource', 'eks:TagResource', 'eks:UntagResource']) assert.equal(run(action, resource), 'allowed');
  const entry = arn(`access-entry/orderpage-dev/role/${account}/orderpage-eks-operator/uuid`);
  assert.equal(run('eks:TagResource', entry, {...global, ...tags}), 'allowed');
  assert.equal(run('eks:UntagResource', entry), 'allowed');
  assert.equal(run('eks:TagResource', entry.replace('orderpage-eks-operator', 'other'), global, [broad]), 'explicitDeny');
  assert.equal(run('eks:CreateAccessEntry', cluster, {...global, ...tags, 'eks:principalArn': `arn:aws:iam::${account}:role/orderpage-eks-operator`, 'eks:accessEntryType': 'STANDARD'}), 'allowed');
  assert.equal(run('iam:PassRole', `arn:aws:iam::${account}:role/orderpage-dev-node-role`, {'iam:PassedToService': 'eks.amazonaws.com'}), 'allowed');
  assert.equal(run('iam:PassRole', `arn:aws:iam::${account}:role/orderpage-terraform-deploy`, {'iam:PassedToService': 'eks.amazonaws.com'}, [broad]), 'explicitDeny');
});

test('Fargate·외부 클러스터·추가 Pod Identity는 별도 Allow가 있어도 거부한다', () => {
  for (const action of ['eks:CreateFargateProfile', 'eks:RegisterCluster', 'eks:AssociateIdentityProviderConfig', 'eks:CreatePodIdentityAssociation', 'eks:UpdatePodIdentityAssociation', 'eks:DeletePodIdentityAssociation']) assert.equal(run(action, cluster, global, [broad]), 'explicitDeny');
  assert.equal(run('ec2:RunInstances', '*'), 'implicitDeny');
});

test('Bool·IfExists는 실제 부분 요청의 누락·거짓·참을 구분하며 모르는 연산자는 실패한다', () => {
  const check = (op, value, context) => evaluate([{Statement: [{Effect: 'Allow', Action: ['x:Test'], Resource: '*', Condition: {[op]: {key: value}}}]}], {action: 'x:Test', resource: '*', context});
  assert.equal(check('Bool', 'false', {}), 'implicitDeny');
  assert.equal(check('BoolIfExists', 'false', {}), 'allowed');
  assert.equal(check('BoolIfExists', 'false', {key: false}), 'allowed');
  assert.equal(check('BoolIfExists', 'false', {key: 'true'}), 'implicitDeny');
  assert.equal(check('Bool', 'false', {key: 0}), 'implicitDeny');
  assert.equal(check('StringEqualsIfExists', 'STANDARD', {}), 'allowed');
  assert.equal(check('StringEqualsIfExists', 'STANDARD', {key: 'EXTENDED'}), 'implicitDeny');
  assert.throws(() => check('UnknownIfExists', 'x', {}));
});

test('공식 Action·Resource·Condition 참조와 생성 API의 실제 한계를 대조한다', () => {
  const ref = JSON.parse(fs.readFileSync(new URL('../../iam/eks-service/authorization-reference.json', import.meta.url)));
  const matchesKey = (pattern, key) => pattern === key || (pattern.includes('${') && key.startsWith(pattern.split('${')[0]));
  for (const doc of policies) for (const s of doc.Statement) for (const actionName of s.Action) {
    const action = ref.actions.find(a => 'eks:' + a.name === actionName);
    assert.ok(action, actionName);
    const keys = [...action.conditionKeys, ...ref.resources.filter(r => action.resources.includes(r.name)).flatMap(r => r.conditionKeys), 'aws:RequestedRegion', 'aws:PrincipalAccount'];
    for (const conditions of Object.values(s.Condition || {})) for (const key of Object.keys(conditions)) assert.ok(keys.some(k => matchesKey(k, key)), `${actionName}: ${key}`);
    for (const resource of [s.Resource || s.NotResource].flat()) {
      if (resource === '*') {if (s.Effect === 'Allow') assert.equal(action.resources.length, 0); continue;}
      assert.ok(action.resources.some(type => ref.resources.find(r => r.name === type).arnFormats.some(format => resource.split(':').slice(5).join(':').startsWith(format.split(':').slice(5).join(':').split('${')[0]))), `${actionName} resource type`);
    }
  }
  assert.deepEqual(ref.actions.find(a => a.name === 'CreateCluster').resources, []);
  assert.deepEqual(ref.actions.find(a => a.name === 'CreateNodegroup').resources, ['cluster']);
  assert.ok(!ref.actions.find(a => a.name === 'CreateNodegroup').conditionKeys.some(k => /nodegroupName|instanceType|desiredSize/.test(k)));
  assert.ok(ref.operations.find(o => o.name === 'CreateNodegroup').authorizedActions.some(a => a.Name === 'PassRole'));
  for (const source of ref.providerSources) for (const action of source.directApiCalls.filter(a => a !== 'AssociateEncryptionConfig')) assert.ok(ref.actions.some(a => a.name === action));
});

test('정책 크기·입력·검토 상태와 개인 파일 덮어쓰기 방지를 확인한다', t => {
  for (const doc of policies) assert.ok(JSON.stringify(doc).length <= 6144);
  assert.equal(JSON.parse(files['manifest.json']).readyForApply, false);
  for (const bad of ['', 'latest', '1.35\n', '1.35.1', null]) assert.throws(() => renderEksServicePermissions(account, bad));
  assert.throws(() => renderEksServicePermissions('000000000000', version));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orderpage-eks-permissions-'));
  t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
  assert.equal(writeEksServicePermissions(account, version, temp).length, 3);
  const manifest = path.join(temp, '.local/iam-eks-service-review/manifest.json');
  const before = fs.readFileSync(manifest, 'utf8');
  assert.throws(() => writeEksServicePermissions(account, '1.36', temp));
  assert.equal(fs.readFileSync(manifest, 'utf8'), before);
});

const resource = (type, after) => ({mode: 'managed', type, change: {actions: ['create'], after: {...after, tags_all: {...eksTags}}}});
const fixture = () => ({resource_changes: [
  resource('aws_eks_cluster', {name:'orderpage-dev', version, access_config:[{authentication_mode:'API', bootstrap_cluster_creator_admin_permissions:false}], upgrade_policy:[{support_type:'STANDARD'}], enabled_cluster_log_types:['api','audit','authenticator'], compute_config:[], storage_config:[], vpc_config:[{endpoint_private_access:true, endpoint_public_access:true, public_access_cidrs:['192.0.2.1/32']}]}),
  resource('aws_eks_node_group', {cluster_name:'orderpage-dev', node_group_name:'orderpage-dev-default', version, instance_types:['m6i.large'], capacity_type:'ON_DEMAND', scaling_config:[{min_size:2,max_size:2,desired_size:2}]}),
  ...['coredns','kube-proxy','vpc-cni'].map(addon_name => resource('aws_eks_addon', {cluster_name:'orderpage-dev', addon_name, addon_version:'v1.2.3-eksbuild.1', service_account_role_arn:null, pod_identity_association:[]}))
]});

test('전체 5개와 최초 클러스터 1개 plan을 구분하고 값을 공개하지 않는다', () => {
  const p = fixture();
  p.resource_changes[0].change.after.private_marker = 'SENSITIVE_FIXTURE_ONLY';
  const report = reviewEksServicePlan(p, version);
  assert.equal(report.passed, true); assert.equal(report.readyForApply, false);
  assert.ok(!JSON.stringify(report).includes('SENSITIVE_FIXTURE_ONLY'));
  assert.ok(!JSON.stringify(report).includes('192.0.2.1'));
  const bootstrap = {resource_changes:[p.resource_changes[0]]};
  assert.equal(reviewEksServicePlan(bootstrap, version, 'bootstrap').passed, true);
  assert.equal(reviewEksServicePlan(bootstrap, version).passed, false);
  assert.equal(reviewEksServicePlan(p, version, 'bootstrap').passed, false);
});

test('과금·공개 접근·임의 이름 변경과 삭제·추가 기능을 plan에서 보류한다', () => {
  const mutations = [
    p => p.resource_changes[0].change.after.name = 'other',
    p => p.resource_changes[0].change.after.upgrade_policy[0].support_type = 'EXTENDED',
    p => p.resource_changes[0].change.after.access_config[0].bootstrap_cluster_creator_admin_permissions = true,
    p => p.resource_changes[0].change.after.vpc_config[0].public_access_cidrs = ['0.0.0.0/0'],
    p => p.resource_changes[0].change.after.vpc_config[0].public_access_cidrs = ['999.0.0.1/32'],
    p => p.resource_changes[0].change.after.compute_config = [{enabled:true}],
    p => p.resource_changes[1].change.after.scaling_config[0].desired_size = 20,
    p => p.resource_changes[1].change.after.instance_types = ['m6i.32xlarge'],
    p => p.resource_changes[1].change.after.node_group_name = 'other',
    p => p.resource_changes[2].change.after.addon_name = 'aws-ebs-csi-driver',
    p => p.resource_changes[2].change.after.service_account_role_arn = 'unapproved',
    p => p.resource_changes[2].change.after.addon_version = null,
    p => p.resource_changes[0].change.actions = ['delete','create'],
    p => p.resource_changes.push(resource('aws_eks_fargate_profile', {})),
    p => delete p.resource_changes[0].change.after.tags_all.Project
  ];
  for (const change of mutations) {const p=fixture(); change(p); assert.equal(reviewEksServicePlan(p, version).passed, false);}
});
