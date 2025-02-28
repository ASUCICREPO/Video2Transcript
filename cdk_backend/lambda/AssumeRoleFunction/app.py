import os
import json
import boto3

def handler(event, context):
    role_arn = os.environ.get("FRONTEND_ROLE_ARN")
    region = os.environ.get("REGION")
    
    sts_client = boto3.client('sts', region_name=region)
    
    try:
        response = sts_client.assume_role(
            RoleArn=role_arn,
            RoleSessionName='frontendSession'
        )
        credentials = response['Credentials']
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Credentials": "true",
            },
            "body": json.dumps({
                "AccessKeyId": credentials['AccessKeyId'],
                "SecretAccessKey": credentials['SecretAccessKey'],
                "SessionToken": credentials['SessionToken'],
                "Expiration": credentials['Expiration'].isoformat()
            })
        }
    except Exception as e:
        print("Error assuming role:", e)
        return {
            "statusCode": 500,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Credentials": "true",
            },
            "body": json.dumps({"error": str(e)})
        }
