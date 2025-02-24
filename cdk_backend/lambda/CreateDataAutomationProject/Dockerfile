# Use the AWS Lambda Python 3.9 base image.
FROM public.ecr.aws/lambda/python:3.9

# Copy requirements.txt and install dependencies.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy your Lambda function code (including handler.py and any other modules) into the container.
COPY . ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler (adjust if your handler file or function name is different).
CMD ["handler.lambda_handler"]
