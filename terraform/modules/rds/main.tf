resource "aws_security_group" "this" {
  name        = "${var.identifier}-sg"
  description = "MariaDB TLS from EKS nodes only"
  vpc_id      = var.vpc_id
  # VPC 전체 CIDR 대신 지정한 EKS SG를 가진 ENI에서 해당 포트로 오는 연결만 받는다.
  ingress {
    description     = "MariaDB TLS from EKS"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [var.allowed_security_group_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}
resource "aws_db_subnet_group" "this" {
  name       = "${var.identifier}-subnet-group"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}
resource "aws_db_parameter_group" "this" {
  name   = "${var.identifier}-parameter-group"
  family = "mariadb10.11"
  # 서버에서 평문 접속을 거부한다. 클라이언트도 CA/호스트명 검증을 켜야 한다.
  parameter {
    name  = "require_secure_transport"
    value = "1" # RDS parameter API의 boolean ON 표현.
  }
  parameter {
    name  = "slow_query_log"
    value = "1"
  }
  parameter {
    name  = "long_query_time"
    value = "1"
  }
  parameter {
    name  = "log_output"
    value = "FILE"
  }
  tags = var.tags
}
# RDS 자동 생성보다 먼저 로그 그룹과 보관 정책을 만든다.
resource "aws_cloudwatch_log_group" "database" {
  for_each          = toset(["error", "slowquery"])
  name              = "/aws/rds/instance/${var.identifier}/${each.key}"
  retention_in_days = 3
  tags              = var.tags
}
resource "aws_db_instance" "this" {
  identifier        = var.identifier
  engine            = "mariadb"
  engine_version    = var.engine_version
  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  # 72시간 이하 실습에서는 예기치 않은 스토리지 자동 확장을 하지 않는다.
  max_allocated_storage           = 0
  storage_type                    = "gp3"
  storage_encrypted               = true
  db_name                         = "ordersystem"
  username                        = "orderadmin"
  password                        = var.master_password
  port                            = 3306
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.this.id]
  parameter_group_name            = aws_db_parameter_group.this.name
  publicly_accessible             = false
  multi_az                        = false
  backup_retention_period         = 1
  backup_window                   = "18:00-18:30"
  maintenance_window              = "sun:19:00-sun:19:30"
  auto_minor_version_upgrade      = true
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["error", "slowquery"]
  performance_insights_enabled    = false
  # 테스트 데이터 전용. 실제 운영 데이터가 있으면 이 삭제 정책을 그대로 쓰면 안 된다.
  deletion_protection      = false
  skip_final_snapshot      = true
  delete_automated_backups = true
  apply_immediately        = false
  tags                     = var.tags
  depends_on               = [aws_cloudwatch_log_group.database]
}
