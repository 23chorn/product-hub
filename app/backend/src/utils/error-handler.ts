import { APIError } from '@pap/shared';

export function handleIntegrationError(error: any, service: string): never {
  if (error.response) {
    // API returned error response
    const message = error.response.data?.error?.message ||
                   error.response.data?.message ||
                   error.message;
    throw new APIError(
      message,
      error.response.status,
      service
    );
  } else if (error.request) {
    // Request made but no response
    throw new APIError(
      `No response from ${service}`,
      503,
      service
    );
  } else {
    // Something else went wrong
    throw new APIError(
      error.message,
      500,
      service
    );
  }
}

export function formatError(error: any): string {
  if (error instanceof APIError) {
    return `[${error.service}] ${error.statusCode}: ${error.message}`;
  }
  return error.message || 'Unknown error';
}
