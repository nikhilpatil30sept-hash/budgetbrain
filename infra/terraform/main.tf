# BudgetBrain on AWS: one container on ECS Express Mode (Fargate behind an
# HTTPS Application Load Balancer that ECS creates and manages).
#
# Not managed here, on purpose (see infra/bootstrap/bootstrap.yaml):
#   - the ECR repository, Terraform state bucket, GitHub deploy role and the
#     cost budget, which must outlive a `destroy`
#   - the secret values in SSM Parameter Store, which the deploy workflow
#     writes from GitHub environment secrets so they never enter Terraform
#     state or this repo

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_ecr_repository" "app" {
  name = var.app_name
}

# AWS-managed key that encrypts SecureString parameters. AWS creates it the
# first time a SecureString is stored, which the workflow does before apply.
data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

locals {
  secret_prefix = "arn:${data.aws_partition.current.partition}:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.app_name}/aws"

  secret_names = concat(
    ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"],
    var.with_gemini ? ["GEMINI_API_KEY"] : [],
  )

  secrets = { for name in local.secret_names : name => "${local.secret_prefix}/${name}" }

  # ingress_paths holds the HTTPS endpoint ECS assigns. Normalise to a URL
  # whether or not the provider includes the scheme.
  endpoint    = try(tolist(aws_ecs_express_gateway_service.app.ingress_paths)[0].endpoint, "")
  service_url = local.endpoint == "" ? "" : (startswith(local.endpoint, "https://") ? local.endpoint : "https://${local.endpoint}")
}

# ---------------------------------------------------------------- Logging --

resource "aws_cloudwatch_log_group" "app" {
  #checkov:skip=CKV_AWS_158:CloudWatch encrypts logs by default; a customer KMS key costs more than this project's logs are worth.
  #checkov:skip=CKV_AWS_338:Short retention on purpose: a demo environment that is destroyed between uses.
  name              = "/ecs/${var.app_name}"
  retention_in_days = var.log_retention_days
}

# -------------------------------------------------------------- IAM roles --

data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS itself to pull the image, write logs and read the secrets.
resource "aws_iam_role" "execution" {
  name               = "${var.app_name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid       = "ReadOnlyThisAppsSecrets"
    actions   = ["ssm:GetParameters"]
    resources = values(local.secrets)
  }

  statement {
    sid       = "DecryptWithTheSsmManagedKey"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

data "aws_iam_policy_document" "ecs_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs.amazonaws.com"]
    }
  }
}

# Used by ECS Express Mode to create and clean up the load balancer,
# certificate, security groups and auto scaling it manages for the service.
resource "aws_iam_role" "infrastructure" {
  name               = "${var.app_name}-ecs-infrastructure"
  assume_role_policy = data.aws_iam_policy_document.ecs_trust.json
}

resource "aws_iam_role_policy_attachment" "infrastructure" {
  role       = aws_iam_role.infrastructure.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"
}

# ---------------------------------------------------------------- Cluster --

resource "aws_ecs_cluster" "app" {
  #checkov:skip=CKV_AWS_65:Container Insights adds per-metric charges; CloudWatch logs and the deployment tests cover this demo environment.
  name = var.app_name
}

# On destroy, Terraform deletes the service first, but ECS keeps cleaning up
# the load balancer, certificate and security groups for a few minutes after
# that, using the infrastructure role. Deleting the role (or the cluster)
# straight away can leave the service stuck draining and a load balancer
# running, and billing, with nothing left to delete it. This pause sits
# between the service and everything it depends on, so it only runs on destroy.
resource "time_sleep" "let_ecs_clean_up" {
  destroy_duration = "10m"

  depends_on = [
    aws_ecs_cluster.app,
    aws_iam_role_policy_attachment.infrastructure,
    aws_iam_role_policy_attachment.execution,
    aws_iam_role_policy.execution_secrets,
  ]
}

# ---------------------------------------------------------------- Service --

resource "aws_ecs_express_gateway_service" "app" {
  service_name            = var.app_name
  cluster                 = aws_ecs_cluster.app.name
  execution_role_arn      = aws_iam_role.execution.arn
  infrastructure_role_arn = aws_iam_role.infrastructure.arn

  cpu               = var.cpu
  memory            = var.memory
  health_check_path = "/api/health"

  # Apply only returns once the new task is healthy behind the load balancer,
  # so the deployment tests that run next hit the new version.
  wait_for_steady_state = true

  primary_container {
    image          = "${data.aws_ecr_repository.app.repository_url}:${var.image_tag}"
    container_port = 3001

    aws_logs_configuration {
      log_group         = aws_cloudwatch_log_group.app.name
      log_stream_prefix = "app"
    }

    environment {
      name  = "NODE_ENV"
      value = "production"
    }

    environment {
      name  = "PORT"
      value = "3001"
    }

    dynamic "secret" {
      for_each = local.secrets
      content {
        name       = secret.key
        value_from = secret.value
      }
    }
  }

  # Exactly one task. The app's rate limits live in process memory
  # (express-rate-limit's default store), so a second task would quietly
  # split every limit in two. Scaling out needs a shared store first.
  scaling_target {
    min_task_count            = 1
    max_task_count            = 1
    auto_scaling_metric       = "AVERAGE_CPU"
    auto_scaling_target_value = 70
  }

  timeouts {
    create = "30m"
    update = "30m"
    delete = "30m"
  }

  depends_on = [time_sleep.let_ecs_clean_up]
}
