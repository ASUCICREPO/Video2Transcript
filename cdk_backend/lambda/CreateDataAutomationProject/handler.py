import json
import logging
import os
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

PROJECT_NAME = "MeetingSummarizer"

def lambda_handler(event, context):
    """Handle Create/Update/Delete events from CloudFormation custom resource."""
    logger.info("Received event: %s", json.dumps(event))
    
    request_type = event.get('RequestType', 'Create')   # "Create", "Update", or "Delete"
    old_physical_id = event.get('PhysicalResourceId')
    
    # If there's no existing physical_id, let's set a default on 'Create'
    if not old_physical_id or old_physical_id == 'none':
        # Could be anything stable—commonly the project name, or a unique ARN once created
        old_physical_id = PROJECT_NAME

    try:
        aws_region = (event.get('ResourceProperties') or {}).get('REGION') or os.environ.get('REGION')
        if not aws_region:
            raise RuntimeError("AWS_REGION not provided in event or environment.")

        client = boto3.client('bedrock-data-automation', region_name=aws_region)

        if request_type == 'Delete':
            # If you want to actually delete the resource, you can do so here:
            # (Optional) Check if the project exists first
            try:
                _ = client.describe_data_automation_project(projectName=PROJECT_NAME)
                logger.info(f"Deleting BDA project {PROJECT_NAME}")
                client.delete_data_automation_project(projectName=PROJECT_NAME)
            except client.exceptions.ResourceNotFoundException:
                logger.info("Project not found during delete — nothing to do.")
            
            return {
                "Status": "SUCCESS",
                "PhysicalResourceId": old_physical_id,  # Keep the old physical resource ID
                "Data": {}
            }

        # request_type is "Create" or "Update".
        # We'll check if the project already exists. If yes, skip creation.
        try:
            describe_response = client.describe_data_automation_project(projectName=PROJECT_NAME)
            project_arn = describe_response["projectArn"]
            logger.info(f"Project already exists with ARN: {project_arn}")
        except client.exceptions.ResourceNotFoundException:
            # If it doesn't exist, create it
            logger.info("Project not found. Creating BDA project now.")
            create_response = client.create_data_automation_project(
                projectName=PROJECT_NAME,
                projectDescription='Project created at deployment time for meeting summarization',
                projectStage='LIVE',
                standardOutputConfiguration={
                    'video': {
                        'extraction': {
                            'category': {
                                'state': 'ENABLED',
                                'types': ['TEXT_DETECTION', 'TRANSCRIPT']
                            },
                            'boundingBox': {
                                'state': 'ENABLED'
                            }
                        },
                        'generativeField': {
                            'state': 'ENABLED',
                            'types': ['VIDEO_SUMMARY', 'SCENE_SUMMARY']
                        },
                    }
                },
            )
            project_arn = create_response["projectArn"]
            logger.info(f"Created BDA project with ARN: {project_arn}")

        # Return SUCCESS with a stable PhysicalResourceId
        return {
            "Status": "SUCCESS",
            "PhysicalResourceId": project_arn,  # or keep using PROJECT_NAME if you prefer
            "Data": {
                "ProjectArn": project_arn
            }
        }

    except ClientError as ce:
        logger.exception("ClientError encountered while creating/updating the project")
        # Return FAILED but maintain the old PhysicalResourceId
        return {
            "Status": "FAILED",
            "PhysicalResourceId": old_physical_id,
            "Data": {
                "Error": str(ce)
            }
        }
    except Exception as e:
        logger.exception("Unexpected error while creating/updating the project")
        # Return FAILED but maintain the old PhysicalResourceId
        return {
            "Status": "FAILED",
            "PhysicalResourceId": old_physical_id,
            "Data": {
                "Error": str(e)
            }
        }
