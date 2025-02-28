export interface TempCredentials {
    AccessKeyId: string;
    SecretAccessKey: string;
    SessionToken: string;
    Expiration: string;
  }
  
  export async function getTemporaryCredentials(): Promise<TempCredentials> {
    const apiUrl = import.meta.env.VITE_ASSUME_ROLE_API_URL;
    const response = await fetch(`${apiUrl}/assumerole`);
    if (!response.ok) {
      throw new Error('Failed to get temporary credentials');
    }
    return response.json();
  }
  