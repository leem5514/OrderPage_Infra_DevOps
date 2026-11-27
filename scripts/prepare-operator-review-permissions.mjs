import {validateAccount} from './deploy-identity-scope.mjs';

// Terraform 배포 Role의 통합 정책에 넣지 않는 별도 검토 후보다. 자동 연결하지 않는다.
export function renderAuditPermissions(accountId) {
  validateAccount(accountId);
  const iam=tail=>`arn:aws:iam::${accountId}:${tail}`;
  return {Version:'2012-10-17',Statement:[
    {Sid:'ValidatePoliciesAndReadQuota',Effect:'Allow',Action:['access-analyzer:ValidatePolicy','iam:GetAccountSummary'],Resource:'*'},
    {Sid:'InspectProjectRoles',Effect:'Allow',Action:['iam:GetRole','iam:ListAttachedRolePolicies','iam:ListRolePolicies','iam:GetRolePolicy'],Resource:['orderpage-terraform-bootstrap','orderpage-terraform-deploy','orderpage-eks-operator','orderpage-dev-cluster-role','orderpage-dev-node-role','orderpage-dev-jenkins','orderpage-dev-backend-upload','orderpage-dev-alb-controller'].map(n=>iam('role/'+n))},
    {Sid:'ReadProjectPolicyVersions',Effect:'Allow',Action:['iam:GetPolicy','iam:GetPolicyVersion','iam:ListPolicyVersions'],Resource:[iam('policy/OrderPage*'),iam('policy/orderpage-dev-boundary-*'),iam('policy/orderpage-dev-alb-controller-policy')]},
    {Sid:'SimulateDeploymentRole',Effect:'Allow',Action:'iam:SimulatePrincipalPolicy',Resource:iam('role/orderpage-terraform-deploy')}
  ]};
}

// 비어 있지 않은 ECR/S3 정리 전 내용·증거 보존을 결정한 후에만 별도로 연결한다.
// 일반 배포 정책에는 포함하지 않는다. bucket versioning을 켜면 별도 재검토해야 한다.
export function renderArtifactCleanupPermissions(accountId) {
  validateAccount(accountId);
  return {Version:'2012-10-17',Statement:[
    {Sid:'PurgeReviewedBackendImages',Effect:'Allow',Action:['ecr:ListImages','ecr:BatchDeleteImage'],Resource:`arn:aws:ecr:ap-northeast-2:${accountId}:repository/orderpage-backend`,Condition:{StringEquals:{'aws:RequestedRegion':'ap-northeast-2','aws:PrincipalAccount':accountId}}},
    {Sid:'PurgeReviewedProductObjects',Effect:'Allow',Action:'s3:DeleteObject',Resource:`arn:aws:s3:::orderpage-dev-product-images-${accountId}/*`,Condition:{StringEquals:{'s3:ResourceAccount':accountId,'aws:PrincipalAccount':accountId},Bool:{'aws:SecureTransport':'true'}}}
  ]};
}

// EC2 생성 후 실제 Jenkins instance ID를 확인해 만든다. 임의 instance wildcard를 사용하지 않는다.
export function renderJenkinsTunnelPermissions(accountId,instanceId) {
  validateAccount(accountId);
  if(typeof instanceId!=='string'||!/^i-[a-f0-9]{17}(?![\s\S])/.test(instanceId))throw Error('검증한 Jenkins instance ID가 필요합니다.');
  const region='ap-northeast-2',condition={StringEquals:{'aws:PrincipalAccount':accountId,'aws:RequestedRegion':region}};
  return {Version:'2012-10-17',Statement:[
    {Sid:'ConnectJenkinsOnly',Effect:'Allow',Action:'ssm:StartSession',Resource:`arn:aws:ec2:${region}:${accountId}:instance/${instanceId}`,Condition:{Bool:{'ssm:SessionDocumentAccessCheck':'true'},StringEquals:{...condition.StringEquals,'ssm:resourceTag/Project':'orderpage','ssm:resourceTag/Environment':'dev','ssm:resourceTag/Name':'orderpage-dev-jenkins'}}},
    {Sid:'ReadJenkinsConnection',Effect:'Allow',Action:'ssm:GetConnectionStatus',Resource:`arn:aws:ec2:${region}:${accountId}:instance/${instanceId}`,Condition:condition},
    {Sid:'PortForwardingDocumentOnly',Effect:'Allow',Action:'ssm:StartSession',Resource:`arn:aws:ssm:${region}::document/AWS-StartPortForwardingSession`,Condition:condition},
    // AWS가 세션에 기록하는 소유자·target 태그로 종료 범위를 제한한다. 사용자 지정 태그가 아니다.
    {Sid:'TerminateOwnJenkinsSession',Effect:'Allow',Action:'ssm:TerminateSession',Resource:`arn:aws:ssm:${region}:${accountId}:session/*`,Condition:{StringEquals:{...condition.StringEquals,'ssm:resourceTag/aws:ssmmessages:target-id':instanceId,'ssm:resourceTag/aws:ssmmessages:session-id':'${aws:userid}'}}}
  ]};
}
