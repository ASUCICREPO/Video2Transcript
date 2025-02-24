import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as os from 'os';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as logs from 'aws-cdk-lib/aws-logs';


export class CdkBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // AWS region should be us-west-2
    const aws_region = cdk.Stack.of(this).region;
    const accountId = cdk.Stack.of(this).account;
    const hostArchitecture = os.arch(); 
    console.log(`Host architecture: ${hostArchitecture}`);
    
    const lambdaArchitecture = hostArchitecture === 'arm64'
                                                ? lambda.Architecture.ARM_64
                                                : lambda.Architecture.X86_64;


    const dataBucket = new s3.Bucket(this, 'MeetingRecording', {
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const prefixes = ['data_automation_result/', 'meeting_videos/', ];

    prefixes.forEach(prefix => {
      new s3deploy.BucketDeployment(this, `Deploy${prefix.replace('/', '')}`, {
        sources: [s3deploy.Source.data(`${prefix.replace('/', '')}.placeholder`, "")],
        destinationBucket: dataBucket,
        destinationKeyPrefix: prefix,
      })
    });

    const createBDAProject = new lambda.DockerImageFunction(this, 'createBDAProject', {
      code: lambda.DockerImageCode.fromImageAsset('lambda/CreateDataAutomationProject/'), 
      architecture: lambdaArchitecture,
      memorySize: 256, 
      timeout: cdk.Duration.seconds(30),
      environment: {
        REGION: aws_region,
      },
    });

    // Create a custom resource provider that wraps the Lambda
    const provider = new cr.Provider(this, 'BDAProjectProvider', {
      onEventHandler: createBDAProject,
     logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Instantiate a custom resource to trigger the Lambda during deployment.
    const bdaProjectResource = new cdk.CustomResource(this, 'TriggerBDAProjectCreation', {
      serviceToken: provider.serviceToken,
      properties: {
        REGION: aws_region,
        Trigger: 'RunOnce',
      },
    });

    const abcdef = bdaProjectResource.toString();
    const projectArn = bdaProjectResource.getAtt('ProjectArn').toString();


    // const projectArn = bdaProjectResource.getAtt('ProjectArn').toString();

    // Grant the Lambda read permissions on the bucket
    dataBucket.grantRead(createBDAProject);
    createBDAProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:*'],
      resources: ['*'],
    }));

    const StartBDAjob = new lambda.Function(this, 'StartBDAjob', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'handler.lambda_handler', // "handler" is the filename, and "lambda_handler" is the function name.
      code: lambda.Code.fromDockerBuild('lambda/DataAutomationStartJob/',
        {
          targetStage: 'builder',
        }
      ), 
      timeout: cdk.Duration.seconds(30), 
      architecture: lambdaArchitecture,
      memorySize: 256, 
      environment: {
        REGION: aws_region,
        MEETING_VIDEOS_PREFIX: prefixes[1],
        DATA_AUTOMATION_RESULT_PREFIX: prefixes[0],
        BUCKET_NAME: dataBucket.bucketName,
        BDA_PROJECT_ARN: projectArn,
      },
    });
    
    // policies
    dataBucket.grantReadWrite(StartBDAjob);
    StartBDAjob.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:*'],
      resources: ['*'],
    }));

    const generate_summary = new lambda.Function(this, 'GenerateSummary', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'handler.lambda_handler', // "handler" is the filename, and "lambda_handler" is the function name.
      code: lambda.Code.fromDockerBuild('lambda/GenerateSummary/',
        {
          targetStage: 'builder',
        }
      ), 
      timeout: cdk.Duration.seconds(30), 
      architecture: lambdaArchitecture,
      memorySize: 256, 
      environment: {
        REGION: aws_region,
        MEETING_VIDEOS_PREFIX: prefixes[1],
        DATA_AUTOMATION_RESULT_PREFIX: prefixes[0],
        BUCKET_NAME: dataBucket.bucketName,
      },
    });

    dataBucket.grantReadWrite(generate_summary);
    generate_summary.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:*'],
      resources: ['*'],
    }));



    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
      description: 'The name of the S3 bucket for video inputs.',
    });

    new cdk.CfnOutput(this, 'BDAProjectArn', {
      value: projectArn,
      description: 'ARN of the created BDA Project',
    });
    
  }
  
}
