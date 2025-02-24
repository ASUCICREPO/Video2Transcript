import os
import json
import re
import boto3

def count_words(text):
    """Return the number of words in the given text."""
    return len(text.split())

def parse_video_insights(json_data):
    """
    Parses the JSON data to extract:
      1. video_summary (str)
      2. scene_summaries (list of str)
      3. full_transcript (str)
      4. scene_transcripts (list of str)
      5. people_in_call (set of speaker names)
      6. scene_frame_texts (list of str) -- visual text from frames
      
    Speakers are extracted from audio segments; if speaker_name is missing,
    we fallback to speaker_label.
    """
    # Overall video summary and transcript
    video_summary = json_data.get("video", {}).get("summary", "")
    full_transcript = (
        json_data.get("video", {})
        .get("transcript", {})
        .get("representation", {})
        .get("text", "")
    )

    # Initialize lists for scene summaries, scene transcripts, and frame texts
    scene_summaries = []
    scene_transcripts = []
    scene_frame_texts = []
    people_in_call = set()

    scenes = json_data.get("scenes", [])
    for scene in scenes:
        # Extract scene summary
        scene_summary = scene.get("summary", "")
        scene_summaries.append(scene_summary)
        
        # Extract scene transcript
        scene_transcript = (
            scene.get("transcript", {})
                 .get("representation", {})
                 .get("text", "")
        )
        scene_transcripts.append(scene_transcript)

        # Extract frame visual text from the scene
        frames = scene.get("frames", [])
        frame_texts = []
        for frame in frames:
            # Extract text from text_words
            for word in frame.get("text_words", []):
                text = word.get("text", "").strip()
                if text:
                    frame_texts.append(text)
            # Optionally also include text_lines if needed
            for line in frame.get("text_lines", []):
                text = line.get("text", "").strip()
                if text:
                    frame_texts.append(text)
        # Join all frame texts from this scene into one string
        scene_frame_texts.append(" ".join(frame_texts))

        # Gather speaker names from audio segments
        for audio_segment in scene.get("audio_segments", []):
            speaker_info = audio_segment.get("speaker", {})
            # Use speaker_name if available; otherwise, speaker_label
            speaker_name = speaker_info.get("speaker_name") or speaker_info.get("speaker_label")
            if speaker_name:
                people_in_call.add(speaker_name)
    
    return video_summary, scene_summaries, full_transcript, scene_transcripts, people_in_call, scene_frame_texts


def create_extracted_info_message(video_summary, scene_summaries, people_in_call, full_transcript, scene_transcripts, scene_frame_texts):
    """
    Creates a user message containing the extracted information.
    The message lists:
      1. Video Summary
      2. Scene Summaries
      3. People in the Call
      4. Overall Transcript
      5. Scene Transcripts
    """
    # Build formatted lists
    scene_summaries_text = "\n".join(f"- {s}" for s in scene_summaries if s)
    scene_transcripts_text = "\n".join(f"- {st}" for st in scene_transcripts if st)
    frame_texts_text = "\n".join(f"- {ft}" for ft in scene_frame_texts if ft)

    speakers_text = ", ".join(sorted(people_in_call)) if people_in_call else "No named speakers found"

    extracted_info_note = (
        "I have extracted the following information from the video analysis:\n\n"
        "1) **Video Summary**:\n"
        f"{video_summary}\n\n"
        "2) **Scene Summaries**:\n"
        f"{scene_summaries_text}\n\n"
        "3) **Frame Visual Text** (extracted from frames):\n"
        f"{frame_texts_text}\n\n"
        # "4) **People in the Call**:\n"
        # f"{speakers_text}\n\n"
        # "5) **Overall Transcript**:\n"
        # f"{full_transcript}\n\n"
        # "6) **Scene Transcripts**:\n"
        # f"{scene_transcripts_text}\n\n"
        "Please use this information to inform your meeting summary output."
    )
    return {"text": extracted_info_note}

def call_nova_pro_converse(user_message_payload):
    """
    Calls the Amazon Nova Pro model via the Bedrock Runtime Converse API.
    The conversation includes:
      - A system message with strict formatting instructions.
      - A user message with the extracted video details.
    """
    client = boto3.client("bedrock-runtime")
    model_id = "us.amazon.nova-pro-v1:0"  # Update if needed

    # Strict format instructions as a system message
    system_prompt = {
        "text": """You are a meeting summarization assistant. 
    Given the video analysis details provided, produce a concise and structured meeting summary. 
    Your output must exactly adhere to the format below, without any additional commentary or deviations.

    --------------------------------------------------
    **DATE/TIME/LOCATION**
    - [Insert date/time/location]

    **INVITEES**
    - [Insert invitee 1]
    - [Insert invitee 2]
    - [Insert invitee 3]
    - [Additional invitees...]

    **AGENDA**
    - [Insert agenda item 1]
    - [Insert agenda item 2]
    - [Insert agenda item 3]
    - [Additional agenda items...]

    **ACTION ITEMS**
    - [Insert action item 1]
    - [Insert action item 2]
    - [Insert action item 3]
    - [Additional action items...]

    **DECISIONS**
    - [Insert decision 1]
    - [Insert decision 2]
    - [Insert decision 3]
    - [Additional decisions...]

    **MEETING NOTES**
    - [Insert key points, technical requirements, and follow-up items]
    --------------------------------------------------

    Please generate your meeting summary exactly in the above format.

    Guidelines:
    - Populate each section with factual details from the video analysis.
    - Insert the exact date, time, and location in the DATE/TIME/LOCATION section where indicated and can most probably be indicated by frame text and summary, think about what we are presenting today and what the future steps are so you can calculate that with agenda.
    - Adhere strictly to the structure.
    - Ensure that no additional commentary or deviations from the specified format are included in your final output."""
    }




    messages = [
        {"role": "user", "content": [user_message_payload]}
    ]
    
    response = client.converse(
        system=[system_prompt],
        modelId=model_id,
        messages=messages
    )
    
    # Extract and return the generated text.
    output_text = response["output"]["message"]["content"][0]["text"]
    return output_text

def lambda_handler(event, context):
    s3_client = boto3.client('s3')
    
    bucket_name = os.environ['BUCKET_NAME']
    data_automation_result_prefix = os.environ['DATA_AUTOMATION_RESULT_PREFIX']
    s3_filename = event.get('s3_filename', os.environ.get('S3_FILENAME'))
    
    invocation_arn = event.get('invocation_arn')
    uuid = invocation_arn.split('/')[-1] if invocation_arn else None
    if uuid:
        print(f"UUID extracted from invocation ARN: {uuid}")
    
    if not uuid:
        prefix = f"{data_automation_result_prefix}{s3_filename}"
        pattern = re.compile(rf"^{re.escape(prefix)}/+([^/]+)/0/standard_output/0/result\.json$")
        print(f"Listing objects with prefix: {prefix}")
        response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix=prefix)
        if 'Contents' in response:
            for obj in response['Contents']:
                key = obj['Key']
                print(f"Found key: {key}")
                match = pattern.match(key)
                if match:
                    uuid = match.group(1)
                    print(f"UUID extracted via regex: {uuid}")
                    break
        if not uuid:
            error_msg = f"No matching object found under prefix: {prefix}"
            print(error_msg)
            return {
                'statusCode': 404,
                'body': json.dumps({'error': error_msg})
            }
    
    output_uri = f"s3://{bucket_name}/{data_automation_result_prefix}{s3_filename}/"
    result_key = f"{data_automation_result_prefix}{s3_filename}//{uuid}/0/standard_output/0/result.json"
    
    try:
        print(f"Retrieving full object from bucket: {bucket_name}, key: {result_key}")
        response = s3_client.get_object(Bucket=bucket_name, Key=result_key)
        result_content = response['Body'].read().decode('utf-8')
        
        json_data = json.loads(result_content)

        # ------------------------------------------
        # Extract key information from the JSON data
        # ------------------------------------------
        video_summary, scene_summaries, full_transcript, scene_transcripts, people_in_call, scene_frame_texts = parse_video_insights(json_data)

        print("Extracted video analysis details:")
        print(f"Video Summary: {video_summary}")
        print(f"Scene Summaries: {scene_summaries}")
        print(f"Frame Visual Texts: {scene_frame_texts}")
        print(f"Overall Transcript: {full_transcript}")
        print(f"Scene Transcripts: {scene_transcripts}")
        print(f"People in Call: {people_in_call}")

        # ------------------------------------------
        # Create the user message with extracted info
        # ------------------------------------------
        extracted_info_message = create_extracted_info_message(
            video_summary=video_summary,
            scene_summaries=scene_summaries,
            people_in_call=people_in_call,
            full_transcript=full_transcript,
            scene_transcripts=scene_transcripts,
            scene_frame_texts=scene_frame_texts
        )

        print("Extracted info message created:")
        print(json.dumps(extracted_info_message, indent=2))
        
        # ------------------------------------------
        # Get response from Nova Pro model
        # ------------------------------------------
        nova_response = call_nova_pro_converse(extracted_info_message)
        print("Response from Nova Pro model:")
        print(nova_response)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Result processed successfully',
                'output_uri': output_uri,
                'result_key': result_key,
                'retrieved_bytes': len(result_content),
                'nova_response': nova_response
            })
        }
    except Exception as e:
        print("Error processing result:", str(e))
        return {
            'statusCode': 500,
            'body': json.dumps({'error': f"Error processing result: {str(e)}"})
        }
