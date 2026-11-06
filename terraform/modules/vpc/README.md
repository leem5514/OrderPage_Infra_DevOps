# VPC 기반 모듈

두 AZ의 public/private subnet, IGW, zonal NAT 1개, route table, S3 gateway endpoint를 구성한다.
Node에 public IP를 자동 할당하지 않는다. Public subnet도 자동 IP 할당을 끄며 ALB/NAT가 필요한 주소를 직접 관리한다.
같은 리전의 S3 트래픽은 gateway endpoint를 통해 NAT를 우회한다.

NAT 1개는 실습 비용을 위한 선택이다. 다른 AZ의 Node는 교차 AZ 경로를 사용하고 NAT AZ 장애 시 egress 영향을 받는다.
인터넷 전체로 나가는 0.0.0.0/0 route는 인바운드 허용 규칙과 다르다.
[현재 root 입력](../../envs/dev/README.md)
