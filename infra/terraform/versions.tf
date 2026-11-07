terraform {
  # 1.10+ for S3-native state locking (use_lockfile), so no DynamoDB table.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      # aws_ecs_express_gateway_service arrived in 6.23.0.
      source  = "hashicorp/aws"
      version = ">= 6.23.0, < 7.0.0"
    }
    time = {
      source  = "hashicorp/time"
      version = ">= 0.12.0, < 1.0.0"
    }
  }

  # Bucket and region come from the deploy workflow (-backend-config), using
  # the state bucket the bootstrap stack created. CI's validate job runs
  # `terraform init -backend=false` and never touches it.
  backend "s3" {
    key          = "budgetbrain/aws.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "budgetbrain"
      ManagedBy = "terraform"
      Repo      = "nikhilpatil30sept-hash/budgetbrain"
    }
  }
}
