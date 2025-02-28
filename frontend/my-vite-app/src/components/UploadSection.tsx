import React, { useState } from 'react';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getTemporaryCredentials, TempCredentials } from '../aws/getTempCreds';
import { REGION, BUCKET_NAME, MEETING_VIDEOS_FOLDER } from '../utilities/constants';

interface UploadSectionProps {
  onUploadComplete?: (fileName: string, creds: TempCredentials) => void;
}

const UploadSection: React.FC<UploadSectionProps> = ({ onUploadComplete }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Please select a video file first.');
      return;
    }
    setUploading(true);
    try {
      // 1. Get temporary credentials from your API
      const tempCreds: TempCredentials = await getTemporaryCredentials();

      // 2. Create an S3 client with temporary credentials
      const s3Client = new S3Client({
        region: REGION,
        credentials: {
          accessKeyId: tempCreds.AccessKeyId,
          secretAccessKey: tempCreds.SecretAccessKey,
          sessionToken: tempCreds.SessionToken,
        },
      });

      // Add a middleware to remove checksum headers
      s3Client.middlewareStack.add(
        (next) => async (args) => {
          if (args.request.headers && args.request.headers['x-amz-checksum-algorithm']) {
            delete args.request.headers['x-amz-checksum-algorithm'];
          }
          return next(args);
        },
        {
          step: 'build',
          name: 'removeChecksumHeaderMiddleware',
          tags: ['CHECKSUM'],
        }
      );

      // 3. Use the file's stream if available (fallback to file object)
      const fileBody =
        typeof selectedFile.stream === 'function'
          ? selectedFile.stream()
          : selectedFile;

      // 4. Prepare upload parameters
      const params = {
        Bucket: BUCKET_NAME,
        Key: `${MEETING_VIDEOS_FOLDER}${selectedFile.name}`,
        Body: fileBody,
        ContentType: selectedFile.type,
      };

      // 5. Use the Upload utility from @aws-sdk/lib-storage to upload the file
      const parallelUpload = new Upload({
        client: s3Client,
        params,
      });

      await parallelUpload.done();
      // Notify parent component with both file name and credentials
      if (onUploadComplete) {
        onUploadComplete(selectedFile.name, tempCreds);
      }
      setSelectedFile(null);
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('There was an error uploading your file. See console for details.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{
      flex: 1,
      margin: '1rem',
      padding: '1rem',
      backgroundColor: 'rgba(255, 255, 255, 0.85)',
      borderRadius: '8px',
    }}>
      <h2 style={{ marginBottom: '1rem' }}>Upload a Video to Transcribe</h2>
      <input
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        style={{ marginBottom: '1rem' }}
      />
      <br />
      <button
        onClick={handleUpload}
        style={{
          padding: '0.5rem 1rem',
          backgroundColor: '#007BFF',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
        disabled={uploading}
      >
        {uploading ? 'Uploading...' : 'Upload Video'}
      </button>
    </div>
  );
};

export default UploadSection;
