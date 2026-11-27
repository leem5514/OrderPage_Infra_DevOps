import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const awsPolicy = name => `arn:aws:iam::aws:policy/${name}`;
const roles = {
  cluster: {name: 'orderpage-dev-cluster-role', policies: [awsPolicy('AmazonEKSClusterPolicy')]},
  node: {name: 'orderpage-dev-node-role', policies: ['AmazonEKSWorkerNodePolicy', 'AmazonEKS_CNI_Policy', 'AmazonEC2ContainerRegistryPullOnly'].map(awsPolicy)},
  jenkins: {name: 'orderpage-dev-jenkins', policies: [awsPolicy('AmazonSSMManagedInstanceCore')], inline: true},
  'backend-upload': {name: 'orderpage-dev-backend-upload', policies: [], inline: true},
  'alb-controller': {name: 'orderpage-dev-alb-controller', policies: ['controller']}
};
const statement = (Sid, Effect, Action, Resource, Condition) => ({Sid, Effect, Action, Resource, ...(Condition ? {Condition} : {})});
const allow = (sid, actions, resources, condition) => statement(sid, 'Allow', actions, resources, condition);
const deny = (sid, actions, resources, condition) => statement(sid, 'Deny', actions, resources, condition);
const denyElsewhere = (sid, actions, resources) => ({Sid: sid, Effect: 'Deny', Action: actions, NotResource: resources});
const equals = values => ({StringEquals: values});

// 검토용 생성기다. AWS에 정책을 생성/연결하거나 배포하지 않는다.
// 이 묶음만으로는 서비스 apply 권한이 완성되지 않는다. manifest의 pending을 확인한다.
export function renderDeployDelegation(accountId) {
  if (typeof accountId !== 'string' || !/^[0-9]{12}$/.test(accountId) || accountId.length !== 12 || /^0{12}$/.test(accountId)) throw Error('12자리 계정 ID가 필요합니다.');
  const iam = suffix => `arn:aws:iam::${accountId}:${suffix}`;
  const role = kind => iam(`role/${roles[kind].name}`);
  const boundary = kind => iam(`policy/orderpage-dev-boundary-${kind}`);
  const controllerPolicy = iam('policy/orderpage-dev-alb-controller-policy');
  const profile = iam('instance-profile/orderpage-dev-jenkins');
  const operator = iam('role/orderpage-eks-operator');
  const cluster = `arn:aws:eks:ap-northeast-2:${accountId}:cluster/orderpage-dev`;
  // 마지막 UUID만 AWS가 생성한다. 클러스터·IAM 계정·Role 이름은 고정한다.
  const entry = `arn:aws:eks:ap-northeast-2:${accountId}:access-entry/orderpage-dev/role/${accountId}/orderpage-eks-operator/*`;
  const adminPolicy = 'arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy';
  const requestTags = {'aws:RequestTag/Project': 'orderpage', 'aws:RequestTag/Environment': 'dev', 'aws:RequestTag/ManagedBy': 'terraform'};
  const roleArns = Object.keys(roles).map(role);
  const lifecycle = [];
  const permissions = [];
  const guards = [];
  let index = 0;
  for (const [kind, settings] of Object.entries(roles)) {
    const id = ++index;
    const bound = {'iam:PermissionsBoundary': boundary(kind)};
    lifecycle.push(allow(`CreateRole${id}`, ['iam:CreateRole'], role(kind), equals({...bound, ...requestTags})));
    // 현재 경계/새 경계는 정확히 같은 역할의 상한이어야 한다.
    lifecycle.push(allow(`MaintainRole${id}`, ['iam:PutRolePermissionsBoundary', 'iam:DeleteRole', 'iam:UpdateRole', 'iam:UpdateRoleDescription', 'iam:UpdateAssumeRolePolicy'], role(kind), equals(bound)));
    guards.push(deny(`RejectWrongBoundary${id}`, ['iam:CreateRole', 'iam:PutRolePermissionsBoundary'], role(kind), {StringNotEquals: bound}));
    if (settings.policies.length) {
      permissions.push(allow(`AttachApprovedPolicy${id}`, ['iam:AttachRolePolicy', 'iam:DetachRolePolicy'], role(kind), equals({...bound, 'iam:PolicyARN': settings.policies.map(p => p === 'controller' ? controllerPolicy : p)})));
    }
    if (settings.inline) permissions.push(allow(`InlineUnderBoundary${id}`, ['iam:PutRolePolicy', 'iam:DeleteRolePolicy'], role(kind), equals(bound)));
  }
  lifecycle.push(allow('TagWorkloadRoles', ['iam:TagRole', 'iam:UntagRole'], roleArns));
  permissions.push(allow('PassClusterAndNodeToEks', ['iam:PassRole'], [role('cluster'), role('node')], equals({'iam:PassedToService': 'eks.amazonaws.com'})));
  permissions.push(allow('PassJenkinsToEc2', ['iam:PassRole'], role('jenkins'), equals({'iam:PassedToService': 'ec2.amazonaws.com'})));

  const roleWrites = ['iam:CreateRole', 'iam:DeleteRole', 'iam:UpdateRole', 'iam:UpdateRoleDescription', 'iam:UpdateAssumeRolePolicy', 'iam:PutRolePermissionsBoundary', 'iam:TagRole', 'iam:UntagRole', 'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy'];
  const policyWrites = ['iam:CreatePolicy', 'iam:DeletePolicy', 'iam:CreatePolicyVersion', 'iam:DeletePolicyVersion', 'iam:SetDefaultPolicyVersion', 'iam:TagPolicy', 'iam:UntagPolicy'];
  const profileWrites = ['iam:CreateInstanceProfile', 'iam:DeleteInstanceProfile', 'iam:AddRoleToInstanceProfile', 'iam:RemoveRoleFromInstanceProfile', 'iam:TagInstanceProfile', 'iam:UntagInstanceProfile'];
  guards.push(
    deny('NeverRemoveBoundary', ['iam:DeleteRolePermissionsBoundary'], '*'),
    denyElsewhere('OnlyWorkloadRoleMutations', roleWrites, roleArns),
    // 상한과 배포 정책의 새 버전 생성도 여기서 명시적으로 거부한다.
    denyElsewhere('OnlyControllerPolicyMutations', policyWrites, controllerPolicy),
    denyElsewhere('OnlyJenkinsProfileMutations', profileWrites, profile),
    denyElsewhere('OnlyThreePassRoles', ['iam:PassRole'], [role('cluster'), role('node'), role('jenkins')]),
    deny('RejectWrongEksPassService', ['iam:PassRole'], [role('cluster'), role('node')], {StringNotEquals: {'iam:PassedToService': 'eks.amazonaws.com'}}),
    deny('RejectWrongEc2PassService', ['iam:PassRole'], role('jenkins'), {StringNotEquals: {'iam:PassedToService': 'ec2.amazonaws.com'}}),
    deny('ProtectHumanAndExecutionIdentities', ['iam:*'], [iam('role/orderpage-terraform-deploy'), iam('role/orderpage-terraform-bootstrap'), operator, iam('user/orderpage-operator'), iam('group/SignInLocalDevelopmentAccess')]),
    deny('NoChainedAssumeRole', ['sts:AssumeRole'], '*')
  );
  const resources = [
    allow('CreateControllerPolicy', ['iam:CreatePolicy'], controllerPolicy, equals(requestTags)),
    allow('MaintainControllerPolicy', policyWrites.filter(a => a !== 'iam:CreatePolicy'), controllerPolicy),
    // 현재 Terraform instance-profile에는 tags가 없다. 정확한 ARN으로 제한한다.
    allow('CreateJenkinsProfile', ['iam:CreateInstanceProfile'], profile),
    allow('MaintainJenkinsProfile', profileWrites.filter(a => a !== 'iam:CreateInstanceProfile'), profile)
  ];
  const access = [
    allow('CreateOnlyOperatorEntry', ['eks:CreateAccessEntry'], cluster, {StringEquals: {...requestTags, 'eks:principalArn': operator, 'eks:accessEntryType': 'STANDARD'}, Null: {'eks:username': 'true', 'eks:kubernetesGroups': 'true'}}),
    allow('AssociateOnlyOperatorAdmin', ['eks:AssociateAccessPolicy'], entry, equals({'eks:policyArn': adminPolicy, 'eks:accessScope': 'cluster'})),
    // 해제 요청에는 accessScope가 없다. 연결 조건을 그대로 복사하면 정리가 막힌다.
    allow('DisassociateOnlyOperatorAdmin', ['eks:DisassociateAccessPolicy'], entry, equals({'eks:policyArn': adminPolicy})),
    allow('DeleteAndTagOperatorEntry', ['eks:DeleteAccessEntry', 'eks:TagResource', 'eks:UntagResource'], entry),
    denyElsewhere('NoOtherEntryCreation', ['eks:CreateAccessEntry'], cluster),
    deny('NoOtherOperatorPrincipal', ['eks:CreateAccessEntry'], '*', {StringNotEquals: {'eks:principalArn': operator}}),
    deny('NoOtherEntryType', ['eks:CreateAccessEntry'], '*', {StringNotEquals: {'eks:accessEntryType': 'STANDARD'}}),
    deny('NoCustomKubernetesUsername', ['eks:CreateAccessEntry'], '*', {Null: {'eks:username': 'false'}}),
    deny('NoCustomKubernetesGroups', ['eks:CreateAccessEntry'], '*', {Null: {'eks:kubernetesGroups': 'false'}}),
    deny('NoAccessEntryUpdates', ['eks:UpdateAccessEntry'], '*'),
    denyElsewhere('NoOtherEntryManagement', ['eks:DeleteAccessEntry', 'eks:AssociateAccessPolicy', 'eks:DisassociateAccessPolicy'], entry),
    deny('NoOtherAccessPolicy', ['eks:AssociateAccessPolicy', 'eks:DisassociateAccessPolicy'], '*', {StringNotEquals: {'eks:policyArn': adminPolicy}}),
    deny('NoOtherAccessScope', ['eks:AssociateAccessPolicy'], '*', {StringNotEquals: {'eks:accessScope': 'cluster'}})
  ];
  const documents = {
    OrderPageWorkloadRoleLifecycle: lifecycle,
    OrderPageWorkloadRolePermissions: permissions,
    OrderPageWorkloadIamResources: resources,
    OrderPageDeploymentGuardrails: guards,
    OrderPageEksAccessManagement: access
  };
  const files = {};
  const policies = [];
  for (const [name, Statement] of Object.entries(documents)) {
    const document = {Version: '2012-10-17', Statement};
    const compact = JSON.stringify(document);
    if (compact.length > 6144 || compact.includes('{{')) throw Error('관리형 정책 크기 또는 치환 검사 실패: ' + name);
    files[name + '.json'] = JSON.stringify(document, null, 2) + '\n';
    policies.push({name, characters: compact.length, sha256: createHash('sha256').update(compact).digest('hex')});
  }
  files['manifest.json'] = JSON.stringify({status: 'REVIEW_ONLY_DO_NOT_ATTACH', policies, readyForApply: false, pending: ['OIDC provider and service-linked-role delegation', 'VPC/EC2/EKS/data/storage/observability create-update-delete policies', 'AWS policy validation and combined permission review', 'Runtime, budget and final plan approval']}, null, 2) + '\n';
  return files;
}

export function writeDeployDelegation(accountId, repoRoot = root) {
  const files = renderDeployDelegation(accountId);
  const local = path.join(repoRoot, '.local');
  if (fs.existsSync(local) && fs.lstatSync(local).isSymbolicLink()) throw Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local, {recursive: true});
  const output = path.join(local, 'iam-deploy-delegation-review');
  fs.mkdirSync(output); // 이전 검토 결과는 덮어쓰지 않는다.
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(output, name), content, {flag: 'wx', mode: 0o600});
  return Object.keys(files);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw Error('사용법: node scripts/prepare-deploy-delegation.mjs <12자리 계정 ID>');
    console.log(`검토용 파일 ${writeDeployDelegation(process.argv[2]).length}개 생성. AWS 변경 없음. 아직 연결하지 마세요.`);
  } catch (error) {
    console.error(error.code ? '파일 생성 실패: 기존 출력 폴더 또는 권한을 확인하세요.' : error.message);
    process.exitCode = 1;
  }
}
