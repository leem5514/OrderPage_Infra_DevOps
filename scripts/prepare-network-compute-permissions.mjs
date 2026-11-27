import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateAccount} from './deploy-identity-scope.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const networkTags = {Project: 'orderpage', Environment: 'dev', ManagedBy: 'terraform'};
export function validateJenkinsAmi(ami) {
  if (typeof ami !== 'string' || !/^ami-[0-9a-f]{17}(?![\s\S])/.test(ami)) throw Error('검토한 Jenkins AMI ID가 필요합니다.');
}

// 아직 AWS에 연결하지 않는 검토본이다. 새 ARN과 기존 부모 ARN의 태그 조건을 분리한다.
export function renderNetworkComputePermissions(accountId, ami) {
  validateAccount(accountId); validateJenkinsAmi(ami);
  const arn = type => `arn:aws:ec2:ap-northeast-2:${accountId}:${type}/*`;
  const request = Object.fromEntries(Object.entries(networkTags).map(([k,v]) => ['aws:RequestTag/' + k, v]));
  const owned = Object.fromEntries(Object.entries(networkTags).map(([k,v]) => ['aws:ResourceTag/' + k, v]));
  const global = {'aws:RequestedRegion': 'ap-northeast-2', 'aws:PrincipalAccount': accountId};
  const allow = (Sid, actions, types, condition = {}) => ({Sid, Effect: 'Allow', Action: actions.map(a => 'ec2:' + a), Resource: types.map(arn), Condition: {...condition, StringEquals: {...global, ...condition.StringEquals}}});
  const create = [], manage = [], compute = [];
  const newTypes = {CreateVpc: 'vpc', CreateSubnet: 'subnet', CreateInternetGateway: 'internet-gateway', AllocateAddress: 'elastic-ip', CreateNatGateway: 'natgateway', CreateRouteTable: 'route-table', CreateSecurityGroup: 'security-group', CreateVpcEndpoint: 'vpc-endpoint'};
  for (const [action, type] of Object.entries(newTypes)) create.push(allow(action, [action], [type], {StringEquals: {...request, ...(action === 'CreateVpcEndpoint' ? {'ec2:VpceServiceName': 'com.amazonaws.ap-northeast-2.s3'} : {})}}));
  // 부모에는 RequestTag를 요구하지 않는다. API에 함께 등장하는 모든 ARN이 허용돼야 한다.
  create.push(allow('VpcParents', ['CreateSubnet', 'CreateRouteTable', 'CreateSecurityGroup', 'CreateNatGateway', 'CreateVpcEndpoint'], ['vpc'], {StringEquals: owned}));
  create.push(allow('NatParents', ['CreateNatGateway'], ['elastic-ip', 'subnet'], {StringEquals: owned}));
  create.push(allow('EndpointRouteParents', ['CreateVpcEndpoint'], ['route-table'], {StringEquals: owned}));
  for (const [sid, actions, types] of [
    ['VpcLifecycle', ['ModifyVpcAttribute', 'DeleteVpc'], ['vpc']],
    ['SubnetLifecycle', ['ModifySubnetAttribute', 'DeleteSubnet'], ['subnet']],
    ['GatewayAttachment', ['AttachInternetGateway', 'DetachInternetGateway'], ['internet-gateway', 'vpc']],
    ['GatewayDelete', ['DeleteInternetGateway'], ['internet-gateway']],
    ['ReleaseNatAddress', ['ReleaseAddress'], ['elastic-ip']],
    ['NatDelete', ['DeleteNatGateway'], ['natgateway']],
    ['Routes', ['CreateRoute', 'ReplaceRoute', 'DeleteRoute', 'DeleteRouteTable'], ['route-table']],
    ['RouteAssociations', ['AssociateRouteTable', 'ReplaceRouteTableAssociation', 'DisassociateRouteTable'], ['route-table', 'subnet']],
    ['EndpointUpdates', ['ModifyVpcEndpoint'], ['vpc-endpoint', 'route-table']],
    ['EndpointDelete', ['DeleteVpcEndpoints'], ['vpc-endpoint']],
    ['SecurityGroups', ['AuthorizeSecurityGroupIngress', 'AuthorizeSecurityGroupEgress', 'RevokeSecurityGroupIngress', 'RevokeSecurityGroupEgress', 'DeleteSecurityGroup'], ['security-group']]
  ]) manage.push(allow(sid, actions, types, {StringEquals: owned}));
  // inline SG 규칙은 태그 없이 생성된다. 새 rule 허용과 소유 SG 허용을 함께 검사한다.
  manage.push(allow('NewInlineRules', ['AuthorizeSecurityGroupIngress', 'AuthorizeSecurityGroupEgress'], ['security-group-rule']));
  compute.push(allow('CreateNodeTemplate', ['CreateLaunchTemplate'], ['launch-template'], {StringEquals: request}));
  compute.push(allow('ManageNodeTemplate', ['CreateLaunchTemplateVersion', 'ModifyLaunchTemplate', 'DeleteLaunchTemplate'], ['launch-template'], {StringEquals: owned}));
  const image = allow('ReviewedJenkinsImage', ['RunInstances'], []);
  image.Resource = [`arn:aws:ec2:ap-northeast-2::image/${ami}`];
  compute.push(image);
  compute.push(allow('JenkinsInstance', ['RunInstances'], ['instance'], {StringEquals: {...request, 'aws:RequestTag/Name': 'orderpage-dev-jenkins', 'ec2:InstanceType': 'm6i.large', 'ec2:InstanceProfile': `arn:aws:iam::${accountId}:instance-profile/orderpage-dev-jenkins`, 'ec2:MetadataHttpTokens': 'required', 'ec2:Tenancy': 'default'}}));
  // provider 5.100.0은 default_tags를 RunInstances의 volume TagSpecifications에도 전달한다.
  compute.push(allow('JenkinsRootVolume', ['RunInstances'], ['volume'], {StringEquals: {...request, 'ec2:VolumeType': 'gp3'}, Bool: {'ec2:Encrypted': 'true'}, NumericLessThanEquals: {'ec2:VolumeSize': '30'}}));
  compute.push(allow('JenkinsPrivateInterface', ['RunInstances'], ['network-interface'], {Bool: {'ec2:AssociatePublicIpAddress': 'false'}}));
  compute.push(allow('JenkinsPrivateSubnet', ['RunInstances'], ['subnet'], {StringEquals: {...owned, 'aws:ResourceTag/Tier': 'private'}}));
  compute.push(allow('JenkinsSecurityGroup', ['RunInstances'], ['security-group'], {StringEquals: owned}));
  compute.push(allow('JenkinsStopStartDelete', ['StartInstances', 'StopInstances', 'TerminateInstances', 'UnmonitorInstances'], ['instance'], {StringEquals: {...owned, 'aws:ResourceTag/Name': 'orderpage-dev-jenkins'}}));
  // 임의 타입·profile·user data 변경 권한은 추가하지 않는다. 현재 구성의 생성·정리부터 검증한다.
  const types = [...Object.values(newTypes), 'launch-template', 'instance', 'volume'];
  const createActions = [...Object.keys(newTypes), 'CreateLaunchTemplate', 'RunInstances'];
  const tags = [
    allow('TagsDuringReviewedCreate', ['CreateTags'], types, {StringEquals: {...request, 'ec2:CreateAction': createActions}}),
    allow('TagsOnOwnedResources', ['CreateTags', 'DeleteTags'], types, {StringEquals: owned})
  ];
  const resource = `arn:aws:ec2:ap-northeast-2:${accountId}:*`;
  const deny = (Sid, Action, Condition) => ({Sid, Effect: 'Deny', Action: Action.map(a => 'ec2:' + a), Resource: resource, Condition});
  // DeleteTags는 키 목록을 생략하면 모든 사용자 태그를 지운다. 대소문자 변형도 보호한다.
  tags.push(deny('RequireExplicitDeleteTagKeys', ['DeleteTags'], {Null: {'aws:TagKeys': 'true'}}));
  tags.push(deny('KeepOwnershipTagKeys', ['DeleteTags'], {'ForAnyValue:StringEqualsIgnoreCase': {'aws:TagKeys': Object.keys(networkTags)}}));
  for (const [key, value] of Object.entries(networkTags)) {
    tags.push(deny('Keep' + key, ['CreateTags'], {Null: {['aws:RequestTag/' + key]: 'false'}, StringNotEquals: {['aws:RequestTag/' + key]: value}}));
    tags.push(deny('DoNotClaim' + key, ['CreateTags'], {Null: {'ec2:CreateAction': 'true'}, StringNotEquals: {['aws:ResourceTag/' + key]: value}}));
  }
  const writes = [...new Set([...create, ...manage, ...compute, ...tags].flatMap(s => s.Action))];
  tags.push({Sid: 'SeoulWritesOnly', Effect: 'Deny', Action: writes, Resource: '*', Condition: {StringNotEquals: {'aws:RequestedRegion': 'ap-northeast-2'}}});
  const files = {}, policies = [];
  for (const [name, Statement] of Object.entries({OrderPageNetworkCreate: create, OrderPageNetworkManage: manage, OrderPageComputeLifecycle: compute, OrderPageNetworkComputeTags: tags})) {
    const document = {Version: '2012-10-17', Statement}, compact = JSON.stringify(document);
    if (compact.length > 6144 || compact.includes('{{')) throw Error('정책 크기·치환 검사 실패');
    files[name + '.json'] = JSON.stringify(document, null, 2) + '\n';
    policies.push({name, characters: compact.length, sha256: createHash('sha256').update(compact).digest('hex')});
  }
  files['manifest.json'] = JSON.stringify({status: 'REVIEW_ONLY_DO_NOT_ATTACH', readyForApply: false, policies,
    limitations: ['Requires existing read and IAM delegation policies; not standalone.', 'Resource tags are not a complete boundary against other Allow policies or administrators.', 'Counts, routing targets, SG ports and launch-template payload require plan review; no spending cap.', 'EC2 arbitrary in-place changes, secondary NAT addresses and extra endpoint types are not granted.', 'AWS effective authorization, policy attachment quotas and create/destroy execution remain unverified.'],
    pending: ['Data/storage/observability permissions', 'Final combined policies, current plan, budget and runtime review']}, null, 2) + '\n';
  return files;
}

export function writeNetworkComputePermissions(accountId, ami, repoRoot = root) {
  const files = renderNetworkComputePermissions(accountId, ami);
  const local = path.join(repoRoot, '.local');
  if (fs.existsSync(local) && fs.lstatSync(local).isSymbolicLink()) throw Error('.local 링크 경로는 허용하지 않습니다.');
  fs.mkdirSync(local, {recursive: true});
  const output = path.join(local, 'iam-network-compute-review');
  fs.mkdirSync(output);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(output, name), content, {flag: 'wx', mode: 0o600});
  return Object.keys(files);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw Error('사용법: node scripts/prepare-network-compute-permissions.mjs <12자리 계정 ID> <검토한 Jenkins AMI>');
    console.log(`검토 파일 ${writeNetworkComputePermissions(process.argv[2], process.argv[3]).length}개 생성. AWS 변경 없음. 아직 연결하지 마세요.`);
  } catch (error) {
    console.error(error.code ? '파일 생성 실패: 기존 출력 폴더 또는 경로 권한을 확인하세요.' : error.message);
    process.exitCode = 1;
  }
}
