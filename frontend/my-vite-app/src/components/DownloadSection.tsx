import React, { useState, useEffect, useRef } from 'react';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BUCKET_NAME, TRANSCRIPT_FOLDER, REGION } from '../utilities/constants';

interface DownloadSectionProps {
  videoFileName: string;
  tempCreds: {
    AccessKeyId: string;
    SecretAccessKey: string;
    SessionToken: string;
  };
}

const DownloadSection: React.FC<DownloadSectionProps> = ({ videoFileName, tempCreds }) => {
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [downloadFileName, setDownloadFileName] = useState<string>('');
  const [timeElapsed, setTimeElapsed] = useState<number>(0);
  
  // Ref for the polling interval
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  // Ref for the elapsed timer interval
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);

  const s3Client = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: tempCreds.AccessKeyId,
      secretAccessKey: tempCreds.SecretAccessKey,
      sessionToken: tempCreds.SessionToken,
    },
  });

  const getTranscriptKey = (fileName: string) => {
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex !== -1 ? fileName.substring(0, dotIndex) : fileName;
    return `${TRANSCRIPT_FOLDER}${baseName}.json`;
  };

  // Fetch the full transcript JSON and extract the text.
  const parseTranscript = async (jsonUrl: string) => {
    try {
      const response = await fetch(jsonUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch transcript JSON (${response.statusText})`);
      }
      const data = await response.json();
      const transcripts = data?.results?.transcripts || [];
      const fullTranscript = transcripts.map((t: any) => t.transcript).join('\n');
      return fullTranscript;
    } catch (err) {
      console.error('Error processing transcript JSON:', err);
      return '';
    }
  };

  const createTextDownloadUrl = (text: string, baseName: string) => {
    // Revoke previous URL if any
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setDownloadFileName(`${baseName}.txt`);
  };

  // Polling for the transcript file in S3
  useEffect(() => {
    const transcriptKey = getTranscriptKey(videoFileName);

    const pollTranscript = async () => {
      // If transcript is already processed, skip further polling
      if (downloadUrl) return;

      try {
        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: transcriptKey,
        });
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        // Use Range header to check existence (only fetch one byte)
        const rangeCheck = await fetch(signedUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
        });

        if (rangeCheck.ok || rangeCheck.status === 206) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          const fullTranscript = await parseTranscript(signedUrl);
          const dotIndex = videoFileName.lastIndexOf('.');
          const baseName = dotIndex !== -1 ? videoFileName.substring(0, dotIndex) : videoFileName;
          createTextDownloadUrl(fullTranscript, baseName);
        } else {
          console.log('Transcript not available yet.');
        }
      } catch (err) {
        console.error('Error polling transcript:', err);
      }
    };

    // Start polling immediately and then every 15 seconds
    pollTranscript();
    pollRef.current = setInterval(pollTranscript, 15000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [videoFileName, tempCreds, downloadUrl]);

  // Start the elapsed timer on mount
  useEffect(() => {
    elapsedTimerRef.current = setInterval(() => {
      setTimeElapsed((prev) => prev + 1);
    }, 1000);

    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // Stop the elapsed timer once the transcript is ready
  useEffect(() => {
    if (downloadUrl && elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, [downloadUrl]);

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '1rem',
        backgroundColor: '#fff',
        border: '1px solid #ddd',
        borderRadius: '4px',
        textAlign: 'center',
      }}
    >
      {downloadUrl ? (
        <p>
          Transcript available:{' '}
          <a href={downloadUrl} download={downloadFileName}>
            Download Transcript (.txt)
          </a>
        </p>
      ) : (
        <>
          <p>Polling for transcript every 15 seconds...</p>
          <p>Elapsed time: {timeElapsed} seconds</p>
        </>
      )}
    </div>
  );
};

export default DownloadSection;
