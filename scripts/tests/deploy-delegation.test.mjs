import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderDeployDelegation, writeDeployDelegation} from '../prepare-deploy-delegation.mjs';
import {renderServicePlanIam} from '../prepare-service-plan-iam.mjs';
import {oidcProviderArn, readOidcCluster, serviceLinkedRoles} from '../deploy-identity-scope.mjs';
import {evaluate} from './helpers/delegation-policy-evaluator.mjs';

const account = '123456789012';
const files = renderDeployDelegation(account);
const documents = Object.entries(files).filter(([name]) => name !== 'manifest.json').map(([, text]) => JSON.parse(text));
const role = suffix => `arn:aws:iam::${account}:role/${suffix}`;
const policy = suffix => `arn:aws:iam::${account}:policy/${suffix}`;
const cluster = `arn:aws:eks:ap-northeast-2:${account}:cluster/orderpage-dev`;
const clusterResponse = {name: 'orderpage-dev', arn: cluster, status: 'ACTIVE', identity: {oidc: {issuer: 'https://oidc.eks.ap-northeast-2.amazonaws.com/id/' + 'A'.repeat(32)}}};
const boundFiles = renderDeployDelegation(account, clusterResponse);
const boundDocuments = Object.entries(boundFiles).filter(([name]) => name !== 'manifest.json').map(([, text]) => JSON.parse(text));
const provider = oidcProviderArn(account, clusterResponse);
const entry = `arn:aws:eks:ap-northeast-2:${account}:access-entry/orderpage-dev/role/${account}/orderpage-eks-operator/uuid-example`;
const admin = 'arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy';
const tags = {'aws:RequestTag/Project': 'orderpage', 'aws:RequestTag/Environment': 'dev', 'aws:RequestTag/ManagedBy': 'terraform'};
const broad = {Version: '2012-10-17', Statement: [{Effect: 'Allow', Action: ['iam:*', 'eks:*', 'sts:*'], Resource: '*'}]};
const run = (action, resource, context = {}, extra = []) => evaluate([...documents, ...extra], {action, resource, context});

test('검토한 경계와 태그를 넣은 Role 생성·삭제는 허용하고 누락·교차 경계는 거부한다', () => {
  for (const [name, kind] of [['cluster-role', 'cluster'], ['node-role', 'node'], ['jenkins', 'jenkins'], ['backend-upload', 'backend-upload'], ['alb-controller', 'alb-controller']]) {
    const resource = role('orderpage-dev-' + name);
    const cap = {'iam:PermissionsBoundary': policy('orderpage-dev-boundary-' + kind)};
    assert.equal(run('iam:CreateRole', resource, {...tags, ...cap}), 'allowed');
    assert.equal(run('iam:DeleteRole', resource, cap), 'allowed');
    assert.equal(run('iam:CreateRole', resource, tags, [broad]), 'explicitDeny');
    assert.equal(run('iam:CreateRole', resource, {...tags, 'iam:PermissionsBoundary': 'arn:aws:iam::aws:policy/AdministratorAccess'}, [broad]), 'explicitDeny');
    assert.equal(run('iam:CreateRole', resource, cap), 'implicitDeny');
    assert.equal(run('iam:PutRolePermissionsBoundary', resource, {'iam:PermissionsBoundary': policy('orderpage-dev-boundary-not-this-role')}, [broad]), 'explicitDeny');
  }
  assert.equal(run('iam:CreateRole', role('other-project'), tags, [broad]), 'explicitDeny');
});

test('경계 제거·상한 정책 편집·실행자 권한 수정은 추가 Allow에도 명시적으로 거부한다', () => {
  const cases = [
    ['iam:DeleteRolePermissionsBoundary', role('orderpage-dev-jenkins')],
    ['iam:CreatePolicyVersion', policy('orderpage-dev-boundary-cluster')],
    ['iam:DeletePolicy', policy('OrderPageServicePlanRead')],
    ['iam:PutRolePolicy', role('orderpage-terraform-deploy')],
    ['iam:UpdateAssumeRolePolicy', role('orderpage-eks-operator')],
    ['iam:AttachRolePolicy', role('orderpage-terraform-bootstrap')],
    ['iam:CreateAccessKey', `arn:aws:iam::${account}:user/orderpage-operator`],
    ['iam:AttachGroupPolicy', `arn:aws:iam::${account}:group/SignInLocalDevelopmentAccess`],
    ['sts:AssumeRole', role('orderpage-eks-operator')]
  ];
  for (const [action, resource] of cases) assert.equal(run(action, resource, {}, [broad]), 'explicitDeny', action);
  // 경계 본문 조회는 기존 plan-read 정책과 함께 계속 허용된다.
  const read = JSON.parse(renderServicePlanIam(account)['plan-read.json']);
  assert.equal(run('iam:GetPolicyVersion', policy('orderpage-dev-boundary-cluster'), {}, [read]), 'allowed');
});

test('PassRole은 세 Role과 전달 서비스 조합만 허용한다', () => {
  for (const [name, service] of [['cluster-role', 'eks.amazonaws.com'], ['node-role', 'eks.amazonaws.com'], ['jenkins', 'ec2.amazonaws.com']]) {
    assert.equal(run('iam:PassRole', role('orderpage-dev-' + name), {'iam:PassedToService': service}), 'allowed');
    assert.equal(run('iam:PassRole', role('orderpage-dev-' + name), {}, [broad]), 'explicitDeny');
    assert.equal(run('iam:PassRole', role('orderpage-dev-' + name), {'iam:PassedToService': 'lambda.amazonaws.com'}, [broad]), 'explicitDeny');
  }
  assert.equal(run('iam:PassRole', role('orderpage-dev-node-role'), {'iam:PassedToService': 'ec2.amazonaws.com'}, [broad]), 'explicitDeny');
  assert.equal(run('iam:PassRole', role('orderpage-dev-backend-upload'), {'iam:PassedToService': 'ec2.amazonaws.com'}, [broad]), 'explicitDeny');
});

test('관리형 정책 연결과 inline 권한은 정해진 역할·경계 아래로 제한된다', () => {
  const cap = {'iam:PermissionsBoundary': policy('orderpage-dev-boundary-node')};
  assert.equal(run('iam:AttachRolePolicy', role('orderpage-dev-node-role'), {...cap, 'iam:PolicyARN': 'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy'}), 'allowed');
  assert.equal(run('iam:AttachRolePolicy', role('orderpage-dev-node-role'), {...cap, 'iam:PolicyARN': 'arn:aws:iam::aws:policy/AdministratorAccess'}), 'implicitDeny');
  assert.equal(run('iam:PutRolePolicy', role('orderpage-dev-node-role'), cap), 'implicitDeny');
  assert.equal(run('iam:PutRolePolicy', role('orderpage-dev-jenkins'), {'iam:PermissionsBoundary': policy('orderpage-dev-boundary-jenkins')}), 'allowed');
  assert.equal(run('iam:PutRolePolicy', role('orderpage-dev-jenkins')), 'implicitDeny');
});

test('EKS 운영자 하나만 등록하며 다른 계정·클러스터·username·group은 거부한다', () => {
  const context = {...tags, 'eks:principalArn': role('orderpage-eks-operator'), 'eks:accessEntryType': 'STANDARD'};
  assert.equal(run('eks:CreateAccessEntry', cluster, context), 'allowed');
  assert.equal(run('eks:CreateAccessEntry', cluster.replace('orderpage-dev', 'other'), context, [broad]), 'explicitDeny');
  for (const change of [
    {'eks:principalArn': role('orderpage-terraform-deploy')},
    {'eks:principalArn': role('orderpage-eks-operator').replace(account, '111122223333')},
    {'eks:accessEntryType': 'EC2_LINUX'},
    {'eks:username': 'custom-user'},
    {'eks:kubernetesGroups': ['system:masters']}
  ]) assert.equal(run('eks:CreateAccessEntry', cluster, {...context, ...change}, [broad]), 'explicitDeny');
  assert.equal(run('eks:UpdateAccessEntry', entry, {}, [broad]), 'explicitDeny');
});

test('EKS admin 연결과 해제의 입력 차이를 반영하고 다른 entry·policy를 거부한다', () => {
  assert.equal(run('eks:AssociateAccessPolicy', entry, {'eks:policyArn': admin, 'eks:accessScope': 'cluster'}), 'allowed');
  assert.equal(run('eks:DisassociateAccessPolicy', entry, {'eks:policyArn': admin}), 'allowed');
  assert.equal(run('eks:DeleteAccessEntry', entry), 'allowed');
  assert.equal(run('eks:AssociateAccessPolicy', entry, {'eks:policyArn': admin, 'eks:accessScope': 'namespace'}, [broad]), 'explicitDeny');
  for (const action of ['eks:AssociateAccessPolicy', 'eks:DisassociateAccessPolicy', 'eks:DeleteAccessEntry']) {
    assert.equal(run(action, entry.replace('orderpage-eks-operator', 'orderpage-terraform-deploy'), {'eks:policyArn': admin, 'eks:accessScope': 'cluster'}, [broad]), 'explicitDeny');
  }
  assert.equal(run('eks:DisassociateAccessPolicy', entry, {'eks:policyArn': admin.replace('Admin', 'View')}, [broad]), 'explicitDeny');
});

test('현재 Terraform의 태그 없는 instance-profile 생성·정리와 전용 controller 정책만 허용한다', () => {
  const profile = `arn:aws:iam::${account}:instance-profile/orderpage-dev-jenkins`;
  for (const action of ['iam:CreateInstanceProfile', 'iam:AddRoleToInstanceProfile', 'iam:RemoveRoleFromInstanceProfile', 'iam:DeleteInstanceProfile']) assert.equal(run(action, profile), 'allowed');
  assert.equal(run('iam:CreateInstanceProfile', profile + '-other', {}, [broad]), 'explicitDeny');
  assert.equal(run('iam:CreatePolicy', policy('orderpage-dev-alb-controller-policy'), tags), 'allowed');
  assert.equal(run('iam:CreatePolicyVersion', policy('orderpage-dev-alb-controller-policy')), 'allowed');
  assert.equal(run('iam:CreatePolicy', policy('other-policy'), tags, [broad]), 'explicitDeny');
  assert.equal(run('ec2:RunInstances', '*'), 'implicitDeny');
});

test('공식 Action·Resource·Condition 지원 범위와 PassRole 의존 조건을 대조한다', () => {
  const reference = JSON.parse(fs.readFileSync(new URL('../../iam/deploy-delegation/authorization-reference.json', import.meta.url), 'utf8')).services;
  const keyMatch = (template, key) => template === key || (template.includes('${TagKey}') && key.startsWith(template.split('${TagKey}')[0]));
  for (const document of [...documents, ...boundDocuments]) for (const s of document.Statement) for (const fullAction of s.Action) {
    const [service, name] = fullAction.split(':');
    if (name === '*') { assert.equal(s.Effect, 'Deny'); assert.ok(!s.Condition); continue; }
    const action = reference[service].actions.find(a => a.name === name);
    assert.ok(action, 'unknown action ' + fullAction);
    const keys = [...action.conditionKeys, ...reference[service].resources.filter(r => action.resources.includes(r.name)).flatMap(r => r.conditionKeys)];
    for (const condition of Object.values(s.Condition || {})) for (const key of Object.keys(condition)) assert.ok(keys.some(k => keyMatch(k, key)), `${fullAction} unsupported condition ${key}`);
    for (const resource of [s.Resource || s.NotResource].flat()) {
      if (resource === '*') { assert.equal(s.Effect, 'Deny'); continue; }
      assert.ok(action.resources.some(type => reference[service].resources.find(r => r.name === type).arnFormats.some(format => {
        const tail = format.split(':').slice(5).join(':').split('${')[0];
        return resource.startsWith('arn:aws:' + service + ':') && resource.split(':').slice(5).join(':').startsWith(tail);
      })), `${fullAction} unsupported resource type`);
    }
  }
  const nodegroup = reference.eks.operations.find(o => o.name === 'CreateNodegroup').authorizedActions.find(a => a.Name === 'PassRole');
  const profile = reference.iam.operations.find(o => o.name === 'AddRoleToInstanceProfile').authorizedActions.find(a => a.Name === 'PassRole');
  assert.deepEqual(nodegroup.Context['iam:PassedToService'], ['eks.amazonaws.com']);
  assert.deepEqual(profile.Context['iam:PassedToService'], ['ec2.amazonaws.com']);
  const linked = reference.iam.operations.find(o => o.name === 'CreateServiceLinkedRole');
  assert.ok(linked.authorizedActions.some(a => a.Name === 'PutRolePolicy'));
});

test('정책 크기·계정 치환·검토 상태·개인 출력 덮어쓰기 방지를 검사한다', t => {
  for (const document of [...documents, ...boundDocuments]) assert.ok(JSON.stringify(document).length <= 6144);
  assert.equal(JSON.parse(files['manifest.json']).readyForApply, false);
  assert.equal(JSON.parse(files['manifest.json']).status, 'REVIEW_ONLY_DO_NOT_ATTACH');
  assert.ok(!JSON.stringify(renderDeployDelegation('111122223333')).includes(account));
  for (const bad of [null, 123456789012, '', '000000000000', '123456789012\n', '../out']) assert.throws(() => renderDeployDelegation(bad));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orderpage-delegation-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  assert.equal(writeDeployDelegation(account, temp).length, 7);
  const before = fs.readFileSync(path.join(temp, '.local/iam-deploy-foundation-review/manifest.json'), 'utf8');
  assert.throws(() => writeDeployDelegation('111122223333', temp));
  assert.equal(fs.readFileSync(path.join(temp, '.local/iam-deploy-foundation-review/manifest.json'), 'utf8'), before);
  assert.equal(writeDeployDelegation(account, temp, clusterResponse).length, 7);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, '.local/iam-deploy-oidc-bound-review/manifest.json'), 'utf8')).phase, 'OIDC_BOUND');
  assert.throws(() => writeDeployDelegation(account, temp, clusterResponse));
  assert.deepEqual(fs.readdirSync(temp), ['.local']);
});

test('미연결 단계에서는 OIDC 쓰기를 전부 거부하고 연결 후에는 공급자 하나만 허용한다', () => {
  const actions = ['iam:CreateOpenIDConnectProvider', 'iam:DeleteOpenIDConnectProvider', 'iam:TagOpenIDConnectProvider', 'iam:UntagOpenIDConnectProvider', 'iam:UpdateOpenIDConnectProviderThumbprint', 'iam:AddClientIDToOpenIDConnectProvider', 'iam:RemoveClientIDFromOpenIDConnectProvider'];
  for (const action of actions) {
    assert.equal(run(action, provider, tags, [broad]), 'explicitDeny');
    assert.equal(evaluate(boundDocuments, {action, resource: provider, context: tags}), 'allowed');
    for (const other of [provider.replace('A'.repeat(32), 'B'.repeat(32)), provider.replace(account, '111122223333'), provider.replace('ap-northeast-2', 'us-east-1'), provider + '/extra']) {
      assert.equal(evaluate([...boundDocuments, broad], {action, resource: other, context: tags}), 'explicitDeny');
    }
  }
  assert.equal(evaluate(boundDocuments, {action: 'iam:CreateOpenIDConnectProvider', resource: provider}), 'implicitDeny');
  for (const action of ['iam:GetOpenIDConnectProvider', 'iam:ListOpenIDConnectProviderTags']) assert.equal(evaluate(boundDocuments, {action, resource: provider}), 'allowed');
  assert.equal(JSON.parse(files['manifest.json']).phase, 'OIDC_UNBOUND');
});

test('OIDC 연결은 다른 계정·클러스터·리전·비정상 issuer 및 비활성 상태에서 실패한다', () => {
  for (const change of [{arn: cluster.replace(account, '111122223333')}, {name: 'other'}, {arn: cluster + '-other'}, {status: 'CREATING'}, {status: 'DELETING'}]) assert.throws(() => oidcProviderArn(account, {...clusterResponse, ...change}));
  for (const issuer of [null, 'https://example.com/id/' + 'A'.repeat(32), clusterResponse.identity.oidc.issuer + '\n', clusterResponse.identity.oidc.issuer + '?x=1', clusterResponse.identity.oidc.issuer.replace('ap-northeast-2', 'us-east-1'), clusterResponse.identity.oidc.issuer.replace('https:', 'http:'), clusterResponse.identity.oidc.issuer + '/']) {
    assert.throws(() => renderDeployDelegation(account, {...clusterResponse, identity: {oidc: {issuer}}}));
  }
  assert.throws(() => renderDeployDelegation(account, {}));
});

test('연결 조회는 STS 확인 뒤 지정 프로필·서울 클러스터 읽기만 실행한다', () => {
  const calls = [];
  const identity = {Account: account, Arn: `arn:aws:sts::${account}:assumed-role/orderpage-terraform-deploy/test-session`};
  const result = readOidcCluster(account, (binary, args) => {
    calls.push(args); assert.equal(binary, 'aws');
    assert.equal(args[args.indexOf('--profile') + 1], 'orderpage-deploy');
    assert.equal(args[args.indexOf('--region') + 1], 'ap-northeast-2');
    return JSON.stringify(args[0] === 'sts' ? identity : {cluster: clusterResponse});
  }, {});
  assert.equal(result.arn, cluster);
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [['sts', 'get-caller-identity'], ['eks', 'describe-cluster']]);
  for (const bad of [{...identity, Account: '111122223333'}, {...identity, Arn: `arn:aws:iam::${account}:root`}, {...identity, Arn: identity.Arn.replace('terraform-deploy', 'terraform-bootstrap')}, {...identity, Arn: identity.Arn.replace('/test-session', '/')}]) {
    let count = 0;
    assert.throws(() => readOidcCluster(account, () => {count++; return JSON.stringify(bad);}, {}));
    assert.equal(count, 1);
  }
});

test('자격증명 환경 덮어쓰기와 조회 오류는 출력 없이 중단한다', () => {
  for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_ROLE_ARN', 'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_EKS']) {
    assert.throws(() => readOidcCluster(account, () => assert.fail('AWS 호출 금지'), {[key]: 'test-override'}));
  }
  const marker = 'PRIVATE_ERROR_CONTENT';
  assert.throws(() => readOidcCluster(account, () => {throw Error(marker);}, {}), e => !e.message.includes(marker) && e.message.includes('조회 실패'));
  assert.throws(() => readOidcCluster(account, () => 'invalid json ' + marker, {}), e => !e.message.includes(marker));
});

test('서비스 연결 Role은 기본 이름 7개와 일치하는 서비스만 생성한다', () => {
  assert.equal(serviceLinkedRoles.length, 7);
  for (const [service, name] of serviceLinkedRoles) {
    const resource = role(`aws-service-role/${service}/${name}`);
    const context = {'iam:AWSServiceName': service};
    assert.equal(run('iam:CreateServiceLinkedRole', resource, context), 'allowed');
    for (const action of ['iam:GetRole', 'iam:AttachRolePolicy', 'iam:PutRolePolicy']) assert.equal(run(action, resource), 'allowed');
    assert.equal(run('iam:CreateServiceLinkedRole', resource + '_other', context, [broad]), 'explicitDeny');
    assert.equal(run('iam:CreateServiceLinkedRole', resource.replace(account, '111122223333'), context, [broad]), 'explicitDeny');
    assert.equal(run('iam:CreateServiceLinkedRole', resource, {'iam:AWSServiceName': 'lambda.amazonaws.com'}, [broad]), 'explicitDeny');
    assert.equal(run('iam:CreateServiceLinkedRole', resource, {}, [broad]), 'explicitDeny');
    const differentService = serviceLinkedRoles.find(([s]) => s !== service)[0];
    assert.equal(run('iam:CreateServiceLinkedRole', resource, {'iam:AWSServiceName': differentService}), 'implicitDeny');
    for (const action of ['iam:CreateRole', 'iam:DeleteRole', 'iam:UpdateAssumeRolePolicy', 'iam:TagRole', 'iam:DetachRolePolicy', 'iam:DeleteRolePolicy', 'iam:PassRole', 'iam:DeleteServiceLinkedRole']) assert.equal(run(action, resource, {}, [broad]), 'explicitDeny');
  }
  for (const action of ['iam:AttachRolePolicy', 'iam:PutRolePolicy']) assert.equal(run(action, role('unrelated-role'), {}, [broad]), 'explicitDeny');
});
