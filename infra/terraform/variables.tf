variable "region" {
  description = "AWS region for the app. Must match the bootstrap stack's region (this account allows only us-east-2)."
  type        = string
  default     = "us-east-2"
}

variable "app_name" {
  description = "Name used for the ECS service, cluster, log group and ECR repository."
  type        = string
  default     = "budgetbrain"
}

variable "image_tag" {
  description = "Tag of the image in ECR to run (the deploy workflow passes the git commit SHA)."
  type        = string

  validation {
    condition     = length(var.image_tag) > 0
    error_message = "image_tag must be set to an image tag that exists in ECR."
  }
}

variable "with_gemini" {
  description = "Pass GEMINI_API_KEY from Parameter Store to the app. Without it the app runs with AI features off."
  type        = bool
  default     = false
}

variable "cpu" {
  description = "Task CPU units (256 = 0.25 vCPU), the smallest Fargate size."
  type        = string
  default     = "256"
}

variable "memory" {
  description = "Task memory in MiB."
  type        = string
  default     = "512"
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the app's logs."
  type        = number
  default     = 14
}
