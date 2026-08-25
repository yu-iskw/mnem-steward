variable "project_id" {
  type        = string
  description = "Google Cloud project for the memory gateway"
}

variable "location" {
  type        = string
  description = "Region or multi-region (eu or us). Do not use global for production memory."
  default     = "europe-west1"
}

variable "service_name" {
  type        = string
  default     = "enterprise-memory-gateway"
}

variable "image" {
  type        = string
  description = "Container image for the gateway"
}

variable "public_base_url" {
  type = string
}
