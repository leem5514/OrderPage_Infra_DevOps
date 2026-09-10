# AWS Load Balancer Controller IRSA Module

AWS Load Balancer Controller가 AWS API를 호출할 수 있도록 IAM Role for Service Account를 생성합니다.

## Features

- IRSA trust policy
- ServiceAccount subject 제한
- AWS Load Balancer Controller IAM policy attachment

## Required Inputs

- EKS OIDC provider ARN
- EKS OIDC issuer URL
- AWS Load Balancer Controller IAM policy ARN

## Portfolio Point

Ingress manifest만 작성하면 ALB가 생기는 것이 아니라, Controller가 Kubernetes API와 AWS API 사이에서 조정자 역할을 합니다. IRSA는 Pod에 장기 AWS access key를 넣지 않고 필요한 권한만 부여하는 방식이라 보안 설계 설명 포인트가 됩니다.
