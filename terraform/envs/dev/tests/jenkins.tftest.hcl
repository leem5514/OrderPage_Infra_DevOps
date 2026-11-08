mock_provider "aws" {
  mock_data "aws_ami" { defaults = { id = "ami-0123456789abcdef0" } }
}
run "jenkins_has_no_inbound_or_eks_credentials" {
  command = plan
  module { source = "../../modules/jenkins" }
  variables {
    name               = "orderpage-dev-jenkins"
    vpc_id             = "vpc-0123456789abcdef0"
    subnet_id          = "subnet-0123456789abcdef0"
    ami_id             = "ami-0123456789abcdef0"
    ecr_repository_arn = "arn:aws:ecr:ap-northeast-2:123456789012:repository/orderpage-backend"
  }
  assert {
    condition = (
      !aws_instance.this.associate_public_ip_address &&
      length(aws_security_group.this.ingress) == 0 &&
      aws_instance.this.metadata_options[0].http_tokens == "required" &&
      aws_instance.this.metadata_options[0].http_put_response_hop_limit == 1 &&
      aws_instance.this.root_block_device[0].encrypted &&
      aws_instance.this.root_block_device[0].volume_size == 30
    )
    error_message = "Jenkins는 공개 IP 없이 IMDSv2/암호화 볼륨을 사용해야 합니다."
  }
  assert {
    condition = (
      jsondecode(aws_iam_role_policy.ecr.policy).Statement[1].Resource == var.ecr_repository_arn &&
      alltrue([for action in jsondecode(aws_iam_role_policy.ecr.policy).Statement[1].Action : startswith(action, "ecr:")]) &&
      !strcontains(aws_iam_role_policy.ecr.policy, "Delete") &&
      jsondecode(aws_iam_role_policy.ecr.policy).Statement[0].Action == ["ecr:GetAuthorizationToken"]
    )
    error_message = "CI IAM은 전용 ECR 업로드/조회만 허용하며 삭제/EKS 권한을 포함하지 않습니다."
  }
}
