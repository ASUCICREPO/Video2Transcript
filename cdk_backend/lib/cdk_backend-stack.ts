import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as os from 'os';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Environment } from 'aws-cdk-lib/aws-appconfig';

export class CdkBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // AWS region should be us-west-2
    const githubToken = this.node.tryGetContext('githubToken');

    
    if (!githubToken) {
      throw new Error(
        'GitHub token is required! Pass them using `-c githubToken=<token>`'
      );
    }

    const aws_region = cdk.Stack.of(this).region;
    const accountId = cdk.Stack.of(this).account;
    const hostArchitecture = os.arch(); 
    console.log(`Host architecture: ${hostArchitecture}`);
    
    const lambdaArchitecture = hostArchitecture === 'arm64'
                                                ? lambda.Architecture.ARM_64
                                                : lambda.Architecture.X86_64;

    const dataBucket = new s3.Bucket(this, 'MeetingRecording', {
  enforceSSL: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  
  cors: [{
    allowedMethods: [
      s3.HttpMethods.PUT,
      s3.HttpMethods.GET,
      s3.HttpMethods.HEAD,
      s3.HttpMethods.POST,
      s3.HttpMethods.DELETE,
      
    ],
    allowedOrigins: ['*'],  
    allowedHeaders: ['*'],
    exposedHeaders: ['ETag'],
    
  }]
});

    const prefixes = ['transcription_results/', 'meeting_videos/', ];

    prefixes.forEach(prefix => {
      new s3deploy.BucketDeployment(this, `Deploy${prefix.replace('/', '')}`, {
        sources: [s3deploy.Source.data(`${prefix.replace('/', '')}.placeholder`, "")],
        destinationBucket: dataBucket,
        destinationKeyPrefix: prefix,
      })
    });

    // Create a role that restricts frontend S3 access
    const frontendRestrictedRole = new iam.Role(this, 'FrontendRestrictedRole', {
      assumedBy: new iam.AccountRootPrincipal(),
      description: 'Role that grants write access to meeting_recordings/ and read access to transcription_results/',
      roleName: 'FrontendRestrictedRole',
    });

    // Grant write permission to the meeting_recordings/ folder
    frontendRestrictedRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`${dataBucket.bucketArn}/meeting_videos/*`],
    }));

    // Grant read permission to the transcription_results/ folder
    frontendRestrictedRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${dataBucket.bucketArn}/transcription_results/*`],
    }));

    const githubToken_secret_manager = new secretsmanager.Secret(this, 'GitHubToken', {
      secretName: 'meeting_summarizer-github-token',
      description: 'GitHub Personal Access Token for Amplify',
      secretStringValue: cdk.SecretValue.unsafePlainText(githubToken)
    });

    // Convert the build spec object to a string (if .toString() produces the YAML string)
    const buildSpecYaml = `
    version: 1.0
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: frontend/dist
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*
    `;



    const assumeRoleLambda = new lambda.Function(this, 'AssumeRoleLambda', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'app.handler',
      code: lambda.Code.fromAsset('lambda/AssumeRoleFunction'),
      environment: {
        FRONTEND_ROLE_ARN: frontendRestrictedRole.roleArn,
        REGION: aws_region,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // Grant the Lambda permission to call STS:AssumeRole
    assumeRoleLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [frontendRestrictedRole.roleArn],
    }));

    // Create an API Gateway REST API for the assumeRole Lambda function
    const assumeRoleApi = new apigateway.LambdaRestApi(this, 'AssumeRoleApi', {
      handler: assumeRoleLambda,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Add a resource and GET method
    const assumeRoleResource = assumeRoleApi.root.addResource('assumerole');
    assumeRoleResource.addMethod('GET'); // GET /assumerole

    
    // Define the Amplify App using the CloudFormation resource type.
    const VideoToTranscriptUI = new cdk.CfnResource(this, 'VideoToTranscriptUI', {
      type: 'AWS::Amplify::App',
      properties: {
        Name: 'VideoToTranscriptUI',
        Description: 'A web application for uploading meeting videos and generating transcripts.',
        Repository: 'https://github.com/ASUCICREPO/Video2Transcript',
        OauthToken: githubToken,
        BuildSpec: buildSpecYaml,
    
        // Must be an array of { Name, Value } pairs:
        EnvironmentVariables: [
          { Name: 'VITE_BUCKET_NAME',         Value: dataBucket.bucketName },
          { Name: 'VITE_REGION',              Value: aws_region },
          { Name: 'VITE_MEETING_VIDEOS_FOLDER', Value: prefixes[1] },
          { Name: 'VITE_TRANSCRIPT_FOLDER',     Value: prefixes[0] },
          { Name: 'VITE_ASSUME_ROLE_API_URL',   Value: assumeRoleApi.url },
        ],
      }
    });

    const shortAppId = VideoToTranscriptUI.getAtt('AppId');

    const mainBranch = new cdk.CfnResource(this, 'MainBranch', {
      type: 'AWS::Amplify::Branch',
      properties: {
        AppId: shortAppId.toString(), // reference to your Amplify App resource
        BranchName: 'main',
        // Optional: additional branch configuration
        Description: 'Main branch for production',
        Stage: 'PRODUCTION',
      },
    });
    

    const transcriptionLambda = new lambda.Function(this, 'TranscriptionLambda', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('lambda/StartTranscriptionJob'),
      environment: {
        BUCKET_NAME: dataBucket.bucketName,
        OUTPUT_FOLDER: prefixes[0],
      },
      architecture: lambdaArchitecture,
      timeout: cdk.Duration.minutes(1),
    });
    
    dataBucket.grantReadWrite(transcriptionLambda);
    transcriptionLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['transcribe:StartTranscriptionJob'],
      resources: ['*'],
    }));
    dataBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(transcriptionLambda), {
      prefix: 'meeting_videos/'
    });

    


    new cdk.CfnOutput(this, 'BucketName', {
      value: dataBucket.bucketName,
      description: 'The name of the S3 bucket',
    });

    new cdk.CfnOutput(this, 'FrontendRestrictedRoleArn', {
      value: frontendRestrictedRole.roleArn,    
      description: 'The ARN of the frontend restricted role',
    });

    new cdk.CfnOutput(this, 'region', {
      value: aws_region,
      description: 'The AWS region',
    });
    new cdk.CfnOutput(this, 'meeting_folder', {
      value: prefixes[0],
      description: 'The folder for meeting videos', 
    });
    new cdk.CfnOutput(this, 'transcript_folder', {
      value: prefixes[1],
      description: 'The folder for transcripts', 
    });
    new cdk.CfnOutput(this, 'AssumeRoleApiUrl', {
      value: assumeRoleApi.url,
      description: 'The URL for the AssumeRole API Gateway',
    });

      
    

    
    
  }
  
}
