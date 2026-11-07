output "service_url" {
  description = "Public HTTPS URL of the app (empty until the service has an endpoint)."
  value       = local.service_url
}

output "service_arn" {
  description = "ARN of the ECS Express Mode service."
  value       = aws_ecs_express_gateway_service.app.service_arn
}

output "image" {
  description = "The image the service is running."
  value       = "${data.aws_ecr_repository.app.repository_url}:${var.image_tag}"
}

output "log_group" {
  description = "CloudWatch log group with the app's stdout and stderr."
  value       = aws_cloudwatch_log_group.app.name
}
