import json
import boto3
import os
import re
import urllib.parse

def lambda_handler(event, context):
    # Log the received event for debugging purposes
    print("Received event:", json.dumps(event))
    
    # Extract bucket and key from the S3 event
    try:
        record = event['Records'][0]
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
        # URL decode the key to handle any encoded characters
        key = urllib.parse.unquote_plus(key)
    except Exception as e:
        print("Error parsing event:", e)
        return {
            'statusCode': 400,
            'body': json.dumps('Event parsing error')
        }
    
    # Build a transcription job name using the filename and current timestamp
    base_filename = os.path.basename(key).split('.')[0]
    # Sanitize the job name to only include allowed characters: 0-9, a-z, A-Z, period, underscore, and hyphen.
    job_name = re.sub(r'[^0-9a-zA-Z._-]', '-', base_filename)
    
    # If job_name is too long, truncate it (AWS has a limit of 200 characters)
    if len(job_name) > 190:
        job_name = job_name[:190]
    
    # Construct the MediaFileUri for the recording
    media_file_uri = f"s3://{bucket}/{key}"
    
    # Use the environment variable OUTPUT_FOLDER for the output location, defaulting to 'transcription_results'
    output_folder = os.environ.get("OUTPUT_FOLDER", "transcription_results").strip("/")
    output_key = f"{output_folder}/{base_filename}.json"
    
    # Initialize the Transcribe client
    client = boto3.client('transcribe')
    
    try:
        print(f"Starting transcription job for: {media_file_uri}")
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
        print(f"Error starting transcription job: {str(e)}")
        print(f"Details - Bucket: {bucket}, Key: {key}, JobName: {job_name}, MediaFileUri: {media_file_uri}")
        return {
            'statusCode': 500,
            'body': json.dumps('Error starting transcription job')
        }
    
    return {
        'statusCode': 200,
        'body': json.dumps('Transcription job started successfully')
    }