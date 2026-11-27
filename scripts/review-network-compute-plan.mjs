import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {networkTags, validateJenkinsAmi} from './prepare-network-compute-permissions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const networkResourceCounts = {aws_vpc: 1, aws_internet_gateway: 1, aws_subnet: 4, aws_eip: 1, aws_nat_gateway: 1, aws_route_table: 2, aws_route_table_association: 4, aws_vpc_endpoint: 1, aws_security_group: 4, aws_launch_template: 1, aws_instance: 1};
// 설정 검사와 미확정 ID 확인을 구분한다. 원문 값이나 인증 정보를 결과에 복사하지 않는다.
export function reviewNetworkComputePlan(plan, ami) {
  validateJenkinsAmi(ami);
  if (!Array.isArray(plan?.resource_changes)) throw Error('Terraform plan이 필요합니다.');
  const selected = plan.resource_changes.filter(r => r.mode === 'managed' && (r.address?.startsWith('module.vpc.') || Object.hasOwn(networkResourceCounts, r.type)));
  const ofType = type => selected.filter(r => r.type === type);
  const value = type => ofType(type)[0]?.change?.after || {};
  const checks = [], check = (name, ok) => checks.push({name, passed: Boolean(ok)});
  check('reviewed-resource-counts', selected.length === 21 && Object.entries(networkResourceCounts).every(([type, count]) => ofType(type).length === count));
  check('no-delete-or-replacement', selected.every(r => r.change?.actions?.length === 1 && ['create', 'update', 'no-op'].includes(r.change.actions[0])));
  check('known-project-tags', selected.filter(r => r.type !== 'aws_route_table_association').every(r => Object.entries(networkTags).every(([k,v]) => r.change?.after?.tags_all?.[k] === v)));
  const vpc = value('aws_vpc');
  check('vpc-dns-and-default-tenancy', vpc.enable_dns_support === true && vpc.enable_dns_hostnames === true && vpc.instance_tenancy === 'default');
  const subnets = ofType('aws_subnet').map(r => r.change.after);
  check('subnets-no-automatic-public-ip', subnets.length === 4 && subnets.every(s => s.map_public_ip_on_launch === false && s.assign_ipv6_address_on_creation === false));
  check('two-public-two-private-in-seoul', ['public', 'private'].every(tier => {const group = subnets.filter(s => s.tags_all?.Tier === tier); return group.length === 2 && new Set(group.map(s => s.availability_zone)).size === 2 && group.every(s => /^ap-northeast-2[a-d]$/.test(s.availability_zone));}));
  check('one-public-nat-and-eip', ofType('aws_nat_gateway').length === 1 && value('aws_nat_gateway').connectivity_type === 'public' && value('aws_eip').domain === 'vpc');
  const endpoint = value('aws_vpc_endpoint');
  check('s3-gateway-endpoint-only', endpoint.vpc_endpoint_type === 'Gateway' && endpoint.service_name === 'com.amazonaws.ap-northeast-2.s3');
  check('two-default-routes', ofType('aws_route_table').length === 2 && ofType('aws_route_table').every(r => r.change.after.route?.length === 1 && r.change.after.route[0].cidr_block === '0.0.0.0/0'));
  const groups = ofType('aws_security_group');
  const expected = {'module.mariadb.aws_security_group.this': 3306, 'module.redis.aws_security_group.this': 6379, 'module.rabbitmq.aws_security_group.this': 5671};
  const empty = v => Array.isArray(v) && v.length === 0;
  check('jenkins-no-ingress', empty(groups.find(r => r.address === 'module.jenkins[0].aws_security_group.this')?.change.after.ingress));
  check('data-ingress-ports-without-public-cidrs', Object.entries(expected).every(([address, port]) => {
    const rules = groups.find(r => r.address === address)?.change.after.ingress;
    return rules?.length === 1 && rules[0].protocol === 'tcp' && rules[0].from_port === port && rules[0].to_port === port && empty(rules[0].cidr_blocks) && empty(rules[0].ipv6_cidr_blocks) && empty(rules[0].prefix_list_ids) && rules[0].self === false;
  }));
  const j = value('aws_instance'), lt = value('aws_launch_template');
  check('jenkins-size-and-public-ip', j.instance_type === 'm6i.large' && j.associate_public_ip_address === false && j.tags_all?.Name === 'orderpage-dev-jenkins');
  check('jenkins-profile', j.iam_instance_profile === 'orderpage-dev-jenkins');
  const amiUnknown = ofType('aws_instance')[0]?.change?.after_unknown?.ami === true;
  check('jenkins-ami-if-known', amiUnknown ? j.ami === undefined : j.ami === ami);
  const metadata = m => m?.length === 1 && m[0].http_tokens === 'required' && m[0].http_put_response_hop_limit === 1;
  check('imds-v2-hop-one', metadata(j.metadata_options) && metadata(lt.metadata_options));
  // aws_launch_template의 nullable EBS bool은 provider 5.100.0 plan에서 문자열로 표현된다.
  const disk = (d, size, nullable = false) => d?.volume_type === 'gp3' && d.volume_size === size && [true, ...(nullable ? ['true'] : [])].includes(d.encrypted) && [true, ...(nullable ? ['true'] : [])].includes(d.delete_on_termination);
  check('jenkins-encrypted-30gb-root', j.root_block_device?.length === 1 && disk(j.root_block_device[0], 30));
  check('node-encrypted-20gb-root', lt.block_device_mappings?.length === 1 && lt.block_device_mappings[0].device_name === '/dev/xvda' && lt.block_device_mappings[0].ebs?.length === 1 && disk(lt.block_device_mappings[0].ebs[0], 20, true));
  const ltUnknown = ofType('aws_launch_template')[0]?.change?.after_unknown || {};
  check('node-template-no-extra-compute-settings', lt.name_prefix === 'orderpage-dev-node-' && ['image_id', 'instance_type', 'key_name', 'user_data'].every(k => !lt[k] && !ltUnknown[k]) && empty(lt.iam_instance_profile) && empty(lt.network_interfaces) && empty(lt.instance_market_options) && empty(lt.instance_requirements));
  return {resourceCount: selected.length, checks, passed: checks.every(c => c.passed), readyForApply: false,
    unresolved: [...(amiUnknown ? ['Jenkins AMI must resolve and match the approved policy before apply.'] : []), 'Subnet/SG/routing target identities and connections must be checked in the final resolved plan.'],
    limitations: ['Checks known settings only; not an apply gate, AWS policy simulator or spending cap.', 'Service-linked roles create EKS workers independently of these deploy-role EC2 permissions.', 'Creation review rejects delete/replacement plans; cleanup needs separate review.']};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw Error('usage');
    const input = path.resolve(process.argv[2]), dev = path.join(root, 'terraform/envs/dev');
    if (path.dirname(input) !== dev || path.extname(input) !== '.tfplan') throw Error('path');
    const result = spawnSync(process.env.TERRAFORM || 'terraform', ['-chdir=' + dev, 'show', '-json', path.basename(input)], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true});
    if (result.error || result.status !== 0) throw Error('show');
    const report = reviewNetworkComputePlan(JSON.parse(result.stdout), process.argv[3]);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch {
    console.error('네트워크·EC2 plan 검사 실패. 사용법: node scripts/review-network-compute-plan.mjs terraform/envs/dev/<파일>.tfplan <검토 AMI>. 원문은 출력하지 않습니다.');
    process.exitCode = 1;
  }
}
