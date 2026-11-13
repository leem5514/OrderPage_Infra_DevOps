# Cost Anomaly Detection은 사용자 결정에 따라 모든 코드를 주석으로 유지한다.
# 3일 이하 실습에서는 학습 기준/비용 반영 지연으로 탐지 성능을 평가하지 않는다.
# 장기 운영 시 기존 계정 monitor와 중복 여부, 청구 계정 권한, 리전과 임계값을 검토한다.
# 다음은 구조 예시이며 현재 plan/apply에 생성되는 리소스는 0개다.
# provider "aws" {
#   alias  = "cost"
#   region = "us-east-1"
# }
# resource "aws_ce_anomaly_monitor" "service" {
#   provider          = aws.cost
#   name              = "orderpage-service-cost"
#   monitor_type      = "DIMENSIONAL"
#   monitor_dimension = "SERVICE"
# }
# resource "aws_ce_anomaly_subscription" "daily" {
#   provider         = aws.cost
#   name             = "orderpage-daily-cost-anomaly"
#   frequency        = "DAILY"
#   monitor_arn_list = [aws_ce_anomaly_monitor.service.arn]
#   subscriber {
#     type    = "EMAIL"
#     address = var.operations_email
#   }
#   threshold_expression {
#     dimension {
#       key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
#       match_options = ["GREATER_THAN_OR_EQUAL"]
#       values        = ["10"] # 예시값, 승인된 운영 한도 아님
#     }
#   }
# }
