import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { repoRoot } from './prepare-deployment.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
export function validateRelease({ repository, digest, sourceCommit, buildUrl }) {
  assert(/^\d{12}\.dkr\.ecr\.ap-northeast-2\.amazonaws\.com\/[a-z0-9/_-]+$/.test(repository), '서울 ECR repository가 필요합니다.');
  assert(/^sha256:[a-f0-9]{64}$/.test(digest), 'sha256 digest가 필요합니다.');
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), 'BE 전체 Git SHA가 필요합니다.');
  assert(/^https?:\/\/[^\s]+$/.test(buildUrl), 'Jenkins build URL이 필요합니다.');
}
export function updatedOverlay(text, release) {
  validateRelease(release);
  const doc = YAML.parse(text);
  assert(doc.images?.length === 1 && doc.images[0].name === 'REPLACE_REQUIRED_IMAGE', '배포 이미지 항목이 예상과 다릅니다.');
  assert(doc.images[0].newName === release.repository, '기존 환경과 다른 ECR 저장소입니다.');
  assert(!doc.images[0].newTag, '태그와 digest를 동시에 사용할 수 없습니다.');
  doc.images[0].digest = release.digest;
  return YAML.stringify(doc);
}
export function ciTarget(text) {
  const doc = YAML.parse(text);
  assert(doc.images?.length === 1 && doc.images[0].name === 'REPLACE_REQUIRED_IMAGE', '단일 백엔드 이미지 설정이 필요합니다.');
  const match = /^(\d{12})\.dkr\.ecr\.ap-northeast-2\.amazonaws\.com\/([a-z0-9/_-]+)$/.exec(doc.images[0].newName);
  assert(match, 'GitOps에 서울 ECR 저장소가 필요합니다.');
  return {accountId:match[1],repositoryName:match[2]};
}
export function checkRendered(text) {
  assert(!text.includes('REPLACE_REQUIRED'), '미완성 배포 설정입니다.');
  const docs = YAML.parseAllDocuments(text).map(d => d.toJSON()).filter(Boolean);
  const allowed = new Set(['Namespace','ServiceAccount','Service','Ingress','ConfigMap','Deployment']);
  assert(docs.length > 0 && docs.every(d => allowed.has(d.kind)), 'GitOps 기본 환경에 허용되지 않은 리소스가 있습니다.');
  assert(docs.filter(d => d.kind === 'Deployment').length === 1, '백엔드 Deployment 하나가 필요합니다.');
  for (const doc of docs) {
    if (doc.kind === 'Namespace') assert(doc.metadata.name === 'orderpage', '다른 Namespace를 만들 수 없습니다.');
    if (doc.kind !== 'Namespace') assert(doc.metadata.namespace === 'orderpage', '다른 namespace를 배포할 수 없습니다.');
    if (doc.kind === 'ConfigMap') assert(!Object.keys(doc.data || {}).some(k => /PASSWORD|TOKEN|SECRET|ACCESS_KEY/i.test(k)), 'ConfigMap에 비밀 키가 있습니다.');
    if (doc.kind === 'Deployment') {
      const container = doc.spec.template.spec.containers[0];
      assert(/@sha256:[a-f0-9]{64}$/.test(container.image), '불변 이미지 digest가 필요합니다.');
      assert(!container.env?.length, '개별 env 추가는 검토가 필요합니다.');
    }
  }
  return docs;
}
export function promote(prepared, destination = path.join(repoRoot, 'gitops/environments/dev')) {
  assert(!fs.existsSync(destination), 'GitOps 환경이 이미 있습니다. 최초 승격은 한 번만 실행합니다.');
  const overlay = YAML.parse(fs.readFileSync(path.join(prepared,'kustomization.yaml'),'utf8'));
  assert(overlay.resources?.length === 1 && path.resolve(prepared,overlay.resources[0]) === path.join(repoRoot,'k8s/base'), '준비 도구가 만든 base 참조만 승격할 수 있습니다.');
  assert(Object.keys(overlay).every(key => ['apiVersion','kind','resources','images','configMapGenerator','patches'].includes(key)), '알 수 없는 overlay 기능은 별도 검토가 필요합니다.');
  assert(overlay.patches?.every(patch => patch.target && typeof patch.patch === 'string' && !patch.path), '외부 patch 파일은 승격할 수 없습니다.');
  const rendered = execFileSync(process.env.KUBECTL || 'kubectl', ['kustomize', prepared], {encoding:'utf8'});
  checkRendered(rendered);
  // local 출력 경로를 Git 안의 상대 경로로 바꾼다. Secret과 kubeconfig는 복사하지 않는다.
  overlay.resources = [path.relative(destination,path.join(repoRoot,'k8s/base')).replaceAll('\\','/')];
  fs.mkdirSync(destination,{recursive:true});
  fs.writeFileSync(path.join(destination,'kustomization.yaml'),YAML.stringify(overlay));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, directory] = process.argv.slice(2);
    if (command === 'promote' && directory) promote(path.resolve(directory));
    else if (command === 'target') {
      const target = ciTarget(fs.readFileSync(path.join(repoRoot,'gitops/environments/dev/kustomization.yaml'),'utf8'));
      console.log(target.accountId+'\n'+target.repositoryName);
    }
    else if (command === 'record' || command === 'update') {
      const release = {repository:process.env.ECR_REPOSITORY,digest:process.env.IMAGE_DIGEST,sourceCommit:process.env.BE_COMMIT,buildUrl:process.env.BUILD_URL};
      validateRelease(release);
      if (command === 'record') {
        fs.writeFileSync(path.join(repoRoot,'.local/ci-image.json'),JSON.stringify({...release,publishedAt:new Date().toISOString()},null,2)+'\n');
      } else {
        const target = path.join(repoRoot,'gitops/environments/dev/kustomization.yaml');
        const previous = fs.readFileSync(target,'utf8');
        try {
          fs.writeFileSync(target,updatedOverlay(previous,release));
          checkRendered(execFileSync(process.env.KUBECTL || 'kubectl',['kustomize',path.dirname(target)],{encoding:'utf8'}));
        } catch (error) { fs.writeFileSync(target,previous); throw error; }
        fs.writeFileSync(path.join(path.dirname(target),'release.json'),JSON.stringify({...release,preparedAt:new Date().toISOString()},null,2)+'\n');
      }
    } else throw new Error('사용법: gitops-release.mjs promote PREPARED_DIRECTORY | target | record | update');
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
