import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyActions,reviewPlan} from '../review-terraform-plan.mjs';

const resource=(address,type,actions,after={})=>({address,type,mode:'managed',change:{actions,after}});
test('계획의 생성·수정·교체·삭제를 분류하고 비밀 값은 결과에 복사하지 않음',()=>{
  const secret='never-copy-this-secret';
  const plan={format_version:'1.2',terraform_version:'1.16.2',resource_changes:[
    resource('module.eks.aws_eks_cluster.this','aws_eks_cluster',['create'],{password:secret}),
    resource('module.vpc.aws_nat_gateway.this','aws_nat_gateway',['update']),
    resource('module.rds.aws_db_instance.this','aws_db_instance',['delete','create']),
    resource('module.old.aws_instance.this','aws_instance',['delete']),
    resource('module.vpc.aws_vpc.this','aws_vpc',['no-op']),
    {address:'data.aws_caller_identity.current',type:'aws_caller_identity',mode:'data',change:{actions:['read']}}
  ]};
  const result=reviewPlan(plan);
  assert.deepEqual(result.counts,{create:1,update:1,delete:1,replace:1,read:1,'no-op':1});
  assert.equal(result.destructive,true);
  assert.equal(result.costDrivers.length,4);
  assert.ok(!JSON.stringify(result).includes(secret));
});
test('실제 Terraform plan 형식과 알려진 action만 허용',()=>{
  assert.equal(classifyActions(['create','delete']),'replace');
  assert.throws(()=>classifyActions(['create','update']));
  assert.throws(()=>reviewPlan({format_version:'1.2',resource_changes:null}));
  assert.throws(()=>reviewPlan({format_version:'2.0',resource_changes:[]}));
});
