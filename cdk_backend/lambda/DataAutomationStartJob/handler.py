import json
import logging
import os
import boto3
from botocore.exceptions import ClientError

# Configure logger
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize the Bedrock Data Automation Runtime client using the REGION environment variable.
data_automation_client = boto3.client(
    'bedrock-data-automation-runtime',
    region_name=os.environ.get('REGION')
)

def lambda_handler(event, context):
    logger.info("Received event: %s", json.dumps(event))
    
    # Retrieve the S3 bucket name from environment and the file name from the event
    bucket_name = os.environ.get('BUCKET_NAME')
    s3_filename = event.get('S3_FILENAME')
    
    if not bucket_name or not s3_filename:
        error_msg = "Missing required parameter(s): BUCKET_NAME (from environment) and s3Filename (from event) must be provided."
        logger.error(error_msg)
        return {
            "statusCode": 400,
            "body": json.dumps({"message": error_msg})
        }
    
    # Retrieve the prefixes from environment variables
    meeting_videos_prefix = os.environ.get('MEETING_VIDEOS_PREFIX', 'meeting_videos/')
    data_automation_result_prefix = os.environ.get('DATA_AUTOMATION_RESULT_PREFIX', 'data_automation_result/')
    bda_project_arn = os.environ.get('BDA_PROJECT_ARN')
    # Construct the input S3 URI using the meeting videos prefix
    input_uri = f"s3://{bucket_name}/{meeting_videos_prefix}{s3_filename}"
    
    # Construct the output S3 URI:
    # Use the data automation result prefix, then use the file name as a folder (with a trailing slash)
    output_uri = f"s3://{bucket_name}/{data_automation_result_prefix}{s3_filename}"
    
    # Define parameters for the Bedrock Data Automation job.
    params = {
        "inputConfiguration": {
            "s3Uri": input_uri
        },
        "outputConfiguration": {
            "s3Uri": output_uri
        },
        "dataAutomationConfiguration": {
            # Set your data automation ARN (could be from an environment variable or config)
            "dataAutomationArn": bda_project_arn,
            # Choose the stage: "LIVE" or "DEVELOPMENT"
            "stage": 'LIVE'
        },
        "notificationConfiguration": {
            "eventBridgeConfiguration": {
                "eventBridgeEnabled": True
            }
        }
    }
    
    try:
        # Start the data automation job.
        response = data_automation_client.invoke_data_automation_async(**params)
        job_id = response.get('JobId')
        logger.info("Started Bedrock Data Automation job successfully. Job ID: %s", job_id)
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Bedrock data automation job started successfully",
                "jobId": job_id
            })
        }
    except ClientError as e:
        logger.exception("ClientError while starting Bedrock Data Automation job")
        return {
            "statusCode": 500,
            "body": json.dumps({
                "message": "Failed to start Bedrock Data Automation job",
                "error": e.response.get('Error', {}).get('Message', str(e))
            })
        }
    except Exception as e:
        logger.exception("Unexpected error while starting Bedrock Data Automation job")
        return {
            "statusCode": 500,
            "body": json.dumps({
                "message": "Unexpected error occurred",
                "error": str(e)
            })
        }
