import json
import boto3
import datetime
import os
import re

def lambda_handler(event, context):
    # Log the received event for debugging purposes
    print("Received event:", json.dumps(event, indent=2))
    
    # Extract bucket and key from the S3 event
    try:
        record = event['Records'][0]
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
    except Exception as e:
        print("Error parsing event:", e)
        return {
            'statusCode': 400,
            'body': json.dumps('Event parsing error')
        }
    
    # Build a transcription job name using the filename and current timestamp
    base_filename = key.split("/")[-1].split('.')[0]
    raw_job_name = f"{base_filename}"
    # Sanitize the job name to only include allowed characters: 0-9, a-z, A-Z, period, underscore, and hyphen.
    job_name = re.sub(r'[^0-9a-zA-Z._-]', '', raw_job_name)
    
    # Construct the MediaFileUri for the recording
    media_file_uri = f"s3://{bucket}/{key}"
    
    # Use the environment variable OUTPUT_FOLDER for the output location, defaulting to 'transcription_results'
    output_folder = os.environ.get("OUTPUT_FOLDER", "transcription_results").strip("/")
    output_key = f"{output_folder}/{base_filename}.json"
    
    # Initialize the Transcribe client
    client = boto3.client('transcribe')
    
    try:
        response = client.start_transcription_job(
            TranscriptionJobName=job_name,
            IdentifyLanguage=True,  # Enable language identification
            Media={
                'MediaFileUri': media_file_uri
            },
            OutputBucketName=bucket,  # Use the same bucket for output
            OutputKey=output_key
        )
        print("Transcription job started successfully:", response)
    except Exception as e:
        print("Error starting transcription job:", e)
        return {
            'statusCode': 500,
            'body': json.dumps('Error starting transcription job')
        }
    
    return {
        'statusCode': 200,
        'body': json.dumps('Transcription job started successfully')
    }
