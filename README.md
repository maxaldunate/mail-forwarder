# AWS Mails Forwarder

> Based On  
> https://github.com/arithmetric/aws-lambda-ses-forwarder  
> http://www.daniloaz.com/en/use-gmail-with-your-own-domain-for-free-thanks-to-amazon-ses-lambda/  

### AWS Resources Generated
![](icos/Storage_AmazonS3.png) 
**S3-Bucket**  
* aws_s3_bucket.bucket "bucket_name" w/lifecycle_rule = bucket_expiration_days
* aws_s3_bucket_policy.bucket_policy = SES put objetcs

![](icos/Compute_AWSLambda.png) 
**Lambda**  
* aws_lambda_function.mail_forwarder_function
* aws_cloudwatch_log_group.mail-forwarder
* null_resource.zip_lambda
* aws_lambda_permission.allow_ses  
* aws_iam_role.iam_for_lambda
* aws_iam_role_policy.lambda_policy

![](icos/Messaging_AmazonSES.png) 
**SES Rule**  
* aws_ses_receipt_rule.mail-forwarder-rule
  - s3_action
  - lambda_action

### Deployment

* Prerequisites
  - Verify Amazon SES Domains (Adding to hosted zones)
  - Generating DKIM Setting on Route53

* Generate `terraform.tfvars` file
```bash
  access_key_ses_for_gmail = "AKIAT............Q6P"
  secret_key_ses_for_gmail = "BM5............/.................+VdeBw85WYk"
  key_for_route53        = "zVs.................................../m1ZU="

  access_key             = "AK................6Q"
  secret_key             = "vR..../yW..............................i"
  domain_email_name      = "john@aldunate.com"
  to_email               = "..........@gmail.com"
  bucket_name            = "example-com-mail-30-days"
  bucket_expiration_days = "5"
  tag_project            = "max-..."
  tag_project_module     = "mail-forwarder-.........-com"
```

* RUN
```bash
$ ./mail-forwarder.bat   # generates .zip file with .js code for lambda function

$ terraform init         # download plugins and providers
  ...
  Initializing provider plugins...
  - Checking for available provider plugins on https://releases.hashicorp.com...
  - Downloading plugin for provider "null" (1.0.0)...
  - Downloading plugin for provider "aws" (1.30.0)...
  ...


$ terraform apply
  ...
   Plan: 9 to add, 0 to change, 0 to destroy.
  ...

$ terraform show
$ terraform destroy
  ...
  Destroy Resources

  An execution plan has been generated and is shown below.
  Resource actions are indicated with the following symbols:
  - destroy

  Terraform will perform the following actions:
  - aws_cloudwatch_log_group.mail-forwarder
  - aws_iam_role.iam_for_lambda
  - aws_iam_role_policy.lambda_policy
  - aws_lambda_function.mail_forwarder_function
  - aws_lambda_permission.allow_ses
  - aws_s3_bucket.bucket
  - aws_s3_bucket_policy.bucket_policy
  - aws_ses_receipt_rule.mail-forwarder-rule
  - null_resource.zip_lambda  
  ...
```


### Leaving SES sandbox

To remove it from quarantine and allow normal mailing you need to open a support ticket to Amazon and fullfill a request.


The End