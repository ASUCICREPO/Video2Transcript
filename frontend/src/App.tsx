import React, { useState } from 'react';
import UploadSection from './components/UploadSection';
import DownloadSection from './components/DownloadSection';

function App() {
  const [videoFileName, setVideoFileName] = useState<string>('');
  const [tempCreds, setTempCreds] = useState<any>(null);
  const [pollingStarted, setPollingStarted] = useState<boolean>(false);

  // Callback from UploadSection with fileName and credentials
  const handleUploadComplete = (fileName: string, creds: any) => {
    setVideoFileName(fileName);
    setTempCreds(creds);
    setPollingStarted(true);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#fff',
        display: 'flex',
        flexDirection: 'column',
        color: '#333',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* Header */}
      <header
        style={{
          backgroundColor: '#f5f5f5',
          padding: '1rem',
          textAlign: 'center',
          borderBottom: '1px solid #ddd',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '2rem' }}>
          Meeting Transcription Portal
        </h1>
      </header>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '2rem 1rem',
        }}
      >
        <UploadSection onUploadComplete={handleUploadComplete} />
        {pollingStarted && (
          <div style={{ marginTop: '2rem', width: '100%', maxWidth: '400px' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
              Polling for Transcript
            </h2>
            <DownloadSection videoFileName={videoFileName} tempCreds={tempCreds} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
