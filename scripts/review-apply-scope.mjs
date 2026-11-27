import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Terraform 자원 목록을 권한 설계 단위로 분류한다. 실행 가능한 IAM 정책이 아니다.
// 새 유형을 자동 허용하거나 Resource=* 권한으로 대체하지 않고 미분류로 보고한다.
export const groups = {
  network: ['aws_vpc', 'aws_subnet', 'aws_internet_gateway', 'aws_eip', 'aws_nat_gateway', 'aws_route_table', 'aws_route_table_association', 'aws_vpc_endpoint', 'aws_security_group'],
  eks: ['aws_eks_cluster', 'aws_eks_node_group', 'aws_eks_addon'],
  eksAccess: ['aws_eks_access_entry', 'aws_eks_access_policy_association'],
  compute: ['aws_launch_template', 'aws_instance'],
  data: ['aws_db_instance', 'aws_db_parameter_group', 'aws_db_subnet_group', 'aws_elasticache_replication_group', 'aws_elasticache_subnet_group', 'aws_mq_broker'],
  registry: ['aws_ecr_repository', 'aws_ecr_lifecycle_policy'],
  images: ['aws_s3_bucket', 'aws_s3_bucket_ownership_controls', 'aws_s3_bucket_public_access_block', 'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_policy'],
  certificate: ['aws_acm_certificate'],
  observability: ['aws_cloudwatch_log_group', 'aws_cloudwatch_metric_alarm', 'aws_cloudwatch_dashboard', 'aws_sns_topic', 'aws_sns_topic_policy', 'aws_sns_topic_subscription', 'aws_budgets_budget'],
  iam: ['aws_iam_role', 'aws_iam_role_policy', 'aws_iam_role_policy_attachment', 'aws_iam_instance_profile', 'aws_iam_openid_connect_provider', 'aws_iam_policy']
};

export function reviewApplyScope(plan) {
  if (!Array.isArray(plan?.resource_changes)) throw Error('Terraform plan resource_changes가 필요합니다.');
  const managed = plan.resource_changes.filter(r => r.mode === 'managed');
  const grouped = Object.fromEntries(Object.keys(groups).map(g => [g, []]));
  const unmapped = [];
  const rolesWithoutBoundary = [];
  const destructive = [];
  for (const r of managed) {
    if (typeof r.address !== 'string' || typeof r.type !== 'string' || !Array.isArray(r.change?.actions)) throw Error('잘못된 resource change');
    const group = Object.keys(groups).find(g => groups[g].includes(r.type));
    // ARN, 정책 본문, 비밀번호, 환경 변수, 사용자 데이터는 출력하지 않는다.
    const entry = {address: r.address, type: r.type, actions: r.change.actions};
    if (group) grouped[group].push(entry); else unmapped.push(entry);
    if (r.change.actions.includes('delete')) destructive.push(entry);
    if (r.type === 'aws_iam_role' && !r.change.after?.permissions_boundary) rolesWithoutBoundary.push(r.address);
  }
  return {
    scope: 'IAM design inventory; not effective permission simulation or apply authorization',
    managedResourceCount: managed.length,
    classifiedResourceCount: Object.values(grouped).reduce((sum, rows) => sum + rows.length, 0),
    groups: grouped, unmapped, destructive, rolesWithoutBoundary,
    readyForApply: false,
    pending: [
      'Workload Role boundary design and enforcement before delegating IAM mutation',
      'Exact-role PassRole with destination-service conditions',
      'EKS access-entry principal and cluster-admin association restrictions',
      'Per-service create/update/delete and service-linked-role action validation',
      'Protected boundary policies and no self-modification of deployment/operator/bootstrap roles',
      'Review latest costs, duration, account-level Budget and final refreshed plan'
    ]
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const dev = path.join(root, 'terraform/envs/dev');
    if (process.argv.length !== 3) throw Error('사용법: node scripts/review-apply-scope.mjs terraform/envs/dev/<검토용>.tfplan');
    const input = path.resolve(process.argv[2]);
    if (path.dirname(input) !== dev || path.extname(input) !== '.tfplan') throw Error('dev 환경의 .tfplan만 읽습니다.');
    const raw = execFileSync(process.env.TERRAFORM || 'terraform', ['-chdir=' + dev, 'show', '-json', path.basename(input)], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true});
    const summary = reviewApplyScope(JSON.parse(raw));
    const output = path.join(root, '.local/apply-scope-review.json');
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({managed: summary.managedResourceCount, classified: summary.classifiedResourceCount, unmapped: summary.unmapped.length, rolesWithoutBoundary: summary.rolesWithoutBoundary.length, destructive: summary.destructive.length, readyForApply: false}));
    // 성공은 분류 완료일 뿐 apply 허용이 아니다. 실행 차단은 IAM 권한/승인 절차에서 담당한다.
    if (summary.unmapped.length) process.exitCode = 1;
  } catch {
    console.error('plan 분류 실패: 경로·Terraform 실행 환경·plan 형식을 확인하세요. 원문은 출력하지 않습니다.');
    process.exitCode = 1;
  }
}
