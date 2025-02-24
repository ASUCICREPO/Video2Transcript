# ---- Builder Stage ----
    FROM public.ecr.aws/lambda/python:3.9 as builder

    # Set the working directory directly to /asset
    WORKDIR /asset
    
    # Copy all files from the build context into /asset
    COPY . .
    
    # Install Python dependencies into /asset
    RUN pip install --no-cache-dir -r requirements.txt -t .
    
    # Ensure proper permissions
    RUN chmod -R 755 /asset
    
    # Optional: List files in /asset for debugging
    RUN ls -la /asset
    
    # ---- Final Stage ----
    FROM public.ecr.aws/lambda/python:3.9
    
    # Copy the built assets from the builder stage into the Lambda task root
    COPY --from=builder /asset ${LAMBDA_TASK_ROOT}
    
    # Ensure proper permissions in the final stage
    RUN chmod -R 755 ${LAMBDA_TASK_ROOT}
    
    # Set the Lambda handler command
    CMD ["handler.lambda_handler"]
    