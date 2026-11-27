import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isIPv4} from 'node:net';
import {eksAddons, eksTags, validateEksVersion} from './prepare-eks-service-permissions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// IAM으로 제한하지 못하는 생성 이름·수량·CIDR 등을 보완한다. apply 실행 차단 장치는 아니다.
// 검사 결과는 고정된 항목명과 참/거짓만 반환하며 plan 값을 복사하지 않는다.
export function reviewEksServicePlan(plan, version, stage = 'full') {
  validateEksVersion(version);
  if (!['full', 'bootstrap'].includes(stage) || !Array.isArray(plan?.resource_changes)) throw Error('전체/최초 단계와 Terraform plan을 확인하세요.');
  const resources = plan.resource_changes.filter(r => r.mode === 'managed' && r.type?.startsWith('aws_eks_'));
  const selected = resources.filter(r => ['aws_eks_cluster', 'aws_eks_node_group', 'aws_eks_addon'].includes(r.type));
  const clusters = selected.filter(r => r.type === 'aws_eks_cluster');
  const nodes = selected.filter(r => r.type === 'aws_eks_node_group');
  const addons = selected.filter(r => r.type === 'aws_eks_addon');
  const checks = [];
  const check = (name, ok) => checks.push({name, passed: Boolean(ok)});
  const c = clusters[0]?.change?.after || {};
  check('expected-resource-counts', clusters.length === 1 && nodes.length === (stage === 'full' ? 1 : 0) && addons.length === (stage === 'full' ? 3 : 0));
  check('no-extra-eks-resource-types', resources.every(r => ['aws_eks_cluster', 'aws_eks_node_group', 'aws_eks_addon', 'aws_eks_access_entry', 'aws_eks_access_policy_association'].includes(r.type)));
  check('no-delete-or-replacement', selected.every(r => r.change?.actions?.length === 1 && ['create', 'update', 'no-op'].includes(r.change.actions[0])));
  check('known-project-tags', selected.every(r => Object.entries(eksTags).every(([key, value]) => r.change?.after?.tags_all?.[key] === value)));
  check('cluster-name-and-version', c.name === 'orderpage-dev' && c.version === version);
  check('api-auth-without-creator-admin', c.access_config?.length === 1 && c.access_config[0].authentication_mode === 'API' && c.access_config[0].bootstrap_cluster_creator_admin_permissions === false);
  check('standard-support', c.upgrade_policy?.length === 1 && c.upgrade_policy[0].support_type === 'STANDARD');
  check('required-control-plane-logs', ['api', 'audit', 'authenticator'].every(type => c.enabled_cluster_log_types?.includes(type)));
  const vpc = c.vpc_config?.[0];
  check('private-endpoint-enabled', c.vpc_config?.length === 1 && vpc.endpoint_private_access === true);
  check('public-endpoint-only-ipv4-hosts', typeof vpc?.endpoint_public_access === 'boolean' && (!vpc.endpoint_public_access || (Array.isArray(vpc.public_access_cidrs) && vpc.public_access_cidrs.length > 0 && vpc.public_access_cidrs.every(cidr => typeof cidr === 'string' && cidr.endsWith('/32') && isIPv4(cidr.slice(0, -3))))));
  check('no-explicit-auto-mode', Array.isArray(c.compute_config) && c.compute_config.length === 0 && Array.isArray(c.storage_config) && c.storage_config.length === 0 && !(c.kubernetes_network_config || []).some(v => v.elastic_load_balancing?.some(lb => lb.enabled === true)));
  if (stage === 'full') {
    const n = nodes[0]?.change?.after || {};
    check('default-nodegroup-name-and-version', n.cluster_name === 'orderpage-dev' && n.node_group_name === 'orderpage-dev-default' && n.version === version);
    check('fixed-two-on-demand-m6i-large-nodes', n.capacity_type === 'ON_DEMAND' && JSON.stringify(n.instance_types) === '["m6i.large"]' && n.scaling_config?.length === 1 && ['min_size', 'max_size', 'desired_size'].every(key => n.scaling_config[0][key] === 2));
    check('three-basic-addons-only', JSON.stringify(addons.map(r => r.change?.after?.addon_name).sort()) === JSON.stringify(eksAddons));
    check('explicit-addon-versions', addons.every(r => /^v[0-9]+\.[0-9]+\.[0-9]+-eksbuild\.[0-9]+(?![\s\S])/.test(r.change?.after?.addon_version || '')));
    check('addons-in-project-without-extra-roles', addons.every(r => r.change?.after?.cluster_name === 'orderpage-dev' && !r.change.after.service_account_role_arn && Array.isArray(r.change.after.pod_identity_association) && r.change.after.pod_identity_association.length === 0 && !r.change.after_unknown?.service_account_role_arn && r.change.after_unknown?.pod_identity_association !== true && !r.change.after_unknown?.pod_identity_association?.some?.(Boolean)));
  }
  return {stage, checks, passed: checks.every(c => c.passed), readyForApply: false,
    limitations: ['This review does not prevent direct AWS API calls or invoke apply.', 'Unknown subnet/Role/launch-template identities, provider defaults and actual runtime costs require final plan review.', 'Addon version format is checked; compatibility and Kubernetes standard support require current AWS verification.', 'Delete/replacement plans need a separate cleanup review rather than this creation gate.']};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length < 4 || process.argv.length > 5) throw Error('usage');
    const input = path.resolve(process.argv[2]);
    const dev = path.join(root, 'terraform/envs/dev');
    if (path.dirname(input) !== dev || path.extname(input) !== '.tfplan') throw Error('path');
    const result = spawnSync(process.env.TERRAFORM || 'terraform', ['-chdir=' + dev, 'show', '-json', path.basename(input)], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true});
    if (result.error || result.status !== 0) throw Error('show');
    const report = reviewEksServicePlan(JSON.parse(result.stdout), process.argv[3], process.argv[4] || 'full');
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch {
    console.error('EKS plan 검사 실패. 사용법: node scripts/review-eks-service-plan.mjs terraform/envs/dev/<파일>.tfplan <minor 버전> [full|bootstrap]. 원문은 출력하지 않습니다.');
    process.exitCode = 1;
  }
}
