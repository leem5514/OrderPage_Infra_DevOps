import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateAccount} from './deploy-identity-scope.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const eksAddons = ['coredns', 'kube-proxy', 'vpc-cni'];
export const eksTags = {Project: 'orderpage', Environment: 'dev', ManagedBy: 'terraform'};
export function validateEksVersion(version) {
  if (typeof version !== 'string' || !/^1\.[0-9]{2}(?![\s\S])/.test(version)) throw Error('검토한 Kubernetes minor 버전(예: 1.35)을 명시하세요. 표준 지원 여부는 별도 확인합니다.');
}
const stmt = (Sid, Effect, Action, Resource, Condition) => ({Sid, Effect, Action, Resource, ...(Condition ? {Condition} : {})});
const denyOutside = (Sid, Action, NotResource) => ({Sid, Effect: 'Deny', Action, NotResource});

// AWS 권한을 연결하지 않는 검토본. IAM 위임 정책과 함께 평가해야 한다.
export function renderEksServicePermissions(accountId, version) {
  validateAccount(accountId); validateEksVersion(version);
  const arn = tail => `arn:aws:eks:ap-northeast-2:${accountId}:${tail}`;
  const cluster = arn('cluster/orderpage-dev');
  const node = arn('nodegroup/orderpage-dev/orderpage-dev-default/*');
  const addons = eksAddons.map(name => arn(`addon/orderpage-dev/${name}/*`));
  const entry = arn(`access-entry/orderpage-dev/role/${accountId}/orderpage-eks-operator/*`);
  const global = {'aws:RequestedRegion': 'ap-northeast-2', 'aws:PrincipalAccount': accountId};
  const tags = Object.fromEntries(Object.entries(eksTags).map(([key, value]) => ['aws:RequestTag/' + key, value]));
  const allow = (sid, actions, resources, condition = {}) => stmt(sid, 'Allow', actions, resources, {...condition, StringEquals: {...global, ...condition.StringEquals}});
  const autoOff = {'eks:computeConfigEnabled': 'false', 'eks:blockStorageEnabled': 'false', 'eks:elasticLoadBalancingEnabled': 'false'};
  const logsOn = Object.fromEntries(['api', 'audit', 'authenticator'].map(type => ['eks:loggingType/' + type, 'true']));
  const clusterChanges = ['eks:UpdateClusterConfig', 'eks:UpdateClusterVersion', 'eks:DeleteCluster'];
  const nodeChanges = ['eks:UpdateNodegroupConfig', 'eks:UpdateNodegroupVersion', 'eks:DeleteNodegroup'];
  const addonChanges = ['eks:UpdateAddon', 'eks:DeleteAddon'];
  const createChildren = ['eks:CreateNodegroup', 'eks:CreateAddon'];
  const tagActions = ['eks:TagResource', 'eks:UntagResource'];
  const lifecycle = [
    // CreateCluster는 resource-level 권한을 지원하지 않는다. 가짜 cluster ARN 제한을 쓰지 않는다.
    allow('CreateClusterWithReviewedSettings', ['eks:CreateCluster'], '*', {
      StringEquals: {...tags, 'eks:authenticationMode': 'API', 'eks:supportType': 'STANDARD', 'eks:kubernetesVersion': version},
      Bool: {'eks:bootstrapClusterCreatorAdminPermissions': 'false', 'eks:endpointPrivateAccess': 'true', ...logsOn},
      BoolIfExists: autoOff
    }),
    // 갱신 API는 변경한 필드만 보낸다. 생략한 키까지 요구하면 정상 갱신/정리를 막는다.
    allow('UpdateReviewedClusterConfig', ['eks:UpdateClusterConfig'], cluster, {
      StringEqualsIfExists: {'eks:authenticationMode': 'API', 'eks:supportType': 'STANDARD'},
      BoolIfExists: {...autoOff, 'eks:endpointPrivateAccess': 'true', ...logsOn}
    }),
    allow('UpdateReviewedClusterVersion', ['eks:UpdateClusterVersion'], cluster, {StringEquals: {'eks:kubernetesVersion': version}}),
    allow('DeleteProjectCluster', ['eks:DeleteCluster'], cluster),
    // 생성 시에는 nodegroup/addon ARN이 아닌 부모 cluster ARN으로 검사한다.
    allow('CreateTaggedChildrenInProjectCluster', createChildren, cluster, {StringEquals: tags}),
    allow('ManageDefaultNodegroup', nodeChanges, node),
    allow('ManageThreeAddons', addonChanges, addons),
    allow('ReadCluster', ['eks:DescribeCluster'], cluster),
    allow('ReadDefaultNodegroup', ['eks:DescribeNodegroup'], node),
    allow('ReadThreeAddons', ['eks:DescribeAddon'], addons),
    allow('PollUpdatesAndReadTags', ['eks:DescribeUpdate', 'eks:ListTagsForResource'], [cluster, node, ...addons]),
    allow('TagProjectEksResources', tagActions, [cluster, node, ...addons])
  ];
  const writes = ['eks:CreateCluster', ...clusterChanges, ...nodeChanges, ...addonChanges, ...createChildren, ...tagActions];
  const guards = [
    stmt('OnlySeoulEksWrites', 'Deny', writes, '*', {StringNotEquals: {'aws:RequestedRegion': 'ap-northeast-2'}}),
    denyOutside('OnlyProjectClusterChanges', [...clusterChanges, ...createChildren], cluster),
    denyOutside('OnlyDefaultNodegroupChanges', nodeChanges, node),
    denyOutside('OnlyThreeAddonChanges', addonChanges, addons),
    // 별도 IAM 위임 정책에서 관리하는 운영자 Access Entry 태그 경로는 막지 않는다.
    denyOutside('OnlyProjectEksTags', tagActions, [cluster, node, ...addons, entry]),
    stmt('NoExtraIdentityOrComputeModes', 'Deny', ['eks:CreateFargateProfile', 'eks:RegisterCluster', 'eks:AssociateIdentityProviderConfig', 'eks:CreatePodIdentityAssociation', 'eks:UpdatePodIdentityAssociation', 'eks:DeletePodIdentityAssociation'], '*')
  ];
  for (const [index, key] of Object.keys(autoOff).entries()) guards.push(stmt('NoAutoModeFeature' + index, 'Deny', ['eks:CreateCluster', 'eks:UpdateClusterConfig'], '*', {Bool: {[key]: 'true'}}));
  for (const [index, [key, expected]] of Object.entries({'eks:authenticationMode': 'API', 'eks:supportType': 'STANDARD'}).entries()) {
    guards.push(stmt('NoUnsafeClusterSetting' + index, 'Deny', ['eks:CreateCluster', 'eks:UpdateClusterConfig'], '*', {Null: {[key]: 'false'}, StringNotEquals: {[key]: expected}}));
  }
  guards.push(stmt('NoCreatorAdmin', 'Deny', ['eks:CreateCluster'], '*', {Bool: {'eks:bootstrapClusterCreatorAdminPermissions': 'true'}}));
  const files = {}, policies = [];
  for (const [name, Statement] of Object.entries({OrderPageEksServiceLifecycle: lifecycle, OrderPageEksServiceGuardrails: guards})) {
    const document = {Version: '2012-10-17', Statement};
    const compact = JSON.stringify(document);
    if (compact.length > 6144 || compact.includes('{{')) throw Error('EKS 정책 크기·치환 검사를 통과하지 못했습니다.');
    files[name + '.json'] = JSON.stringify(document, null, 2) + '\n';
    policies.push({name, characters: compact.length, sha256: createHash('sha256').update(compact).digest('hex')});
  }
  files['manifest.json'] = JSON.stringify({status: 'REVIEW_ONLY_DO_NOT_ATTACH', readyForApply: false, kubernetesVersion: version, policies,
    limitations: ['CreateCluster requires Resource=*; IAM cannot pin its name.', 'CreateNodegroup/CreateAddon authorize the parent cluster; child names, node count/type and add-on versions require plan review.', 'No guarantee of runtime support, capacity, effective AWS authorization or cost cap.'],
    pending: ['Network/EC2/data/storage/observability lifecycle permissions', 'Combine with all IAM/EKS-access policies and review policy attachment quotas', 'AWS policy validation, current support/price checks, runtime and budget, refreshed plan']}, null, 2) + '\n';
  return files;
}

export function writeEksServicePermissions(accountId, version, repoRoot = root) {
  const files = renderEksServicePermissions(accountId, version);
  const local = path.join(repoRoot, '.local');
  if (fs.existsSync(local) && fs.lstatSync(local).isSymbolicLink()) throw Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local, {recursive: true});
  const output = path.join(local, 'iam-eks-service-review');
  fs.mkdirSync(output);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(output, name), content, {flag: 'wx', mode: 0o600});
  return Object.keys(files);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw Error('사용법: node scripts/prepare-eks-service-permissions.mjs <12자리 계정 ID> <검토한 Kubernetes minor 버전>');
    console.log(`검토 파일 ${writeEksServicePermissions(process.argv[2], process.argv[3]).length}개 생성. AWS 변경 없음. 아직 연결하지 마세요.`);
  } catch (error) {
    console.error(error.code ? '파일 생성 실패: 기존 출력 폴더 또는 경로 권한을 확인하세요.' : error.message);
    process.exitCode = 1;
  }
}
